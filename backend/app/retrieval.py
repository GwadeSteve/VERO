"""VERO Retrieval Engine: Hybrid Search (Semantic + BM25 Keyword).

Combines dense vector search (ChromaDB) with sparse keyword search (BM25)
using Reciprocal Rank Fusion (RRF) for maximum retrieval quality.
"""

from __future__ import annotations

import logging
import re
from typing import Optional


from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.embeddings import get_embedder
from app.models import ChunkModel, DocumentModel
from app.schema import SearchResultItem

logger = logging.getLogger(__name__)


def _strip_context_prefix(text: str) -> str:
    """Remove the [Source: ...] contextual header added during chunking.

    The prefix enriches vector embeddings but confuses the cross-encoder
    reranker (and pollutes the UI). We strip it to reveal clean, natural text.
    """
    if text.startswith("[Source:"):
        # The header is typically "[Source: Title - Summary]\nChunk Text"
        # We need to find the first closing bracket ']' that matches the opening
        # and then strip the rest.
        end_idx = text.find("]\n")
        if end_idx != -1:
            return text[end_idx + 2:].lstrip()
        
        # Fallback if '\n' is missing for some reason
        newline_idx = text.find("\n")
        if newline_idx != -1:
            return text[newline_idx + 1:].lstrip()
            
    return text


def _tokenize(text: str) -> list[str]:
    """Simple whitespace + punctuation tokenizer for BM25."""
    return re.findall(r"\w+", text.lower())


async def _fetch_project_chunks(
    db: AsyncSession,
    project_id: str,
) -> list[ChunkModel]:
    """Fetch all chunks belonging to a project."""
    result = await db.execute(
        select(ChunkModel)
        .where(ChunkModel.project_id == project_id)
        .order_by(ChunkModel.doc_id, ChunkModel.start_char)
    )
    return list(result.scalars().all())


async def _fetch_doc_map(
    db: AsyncSession,
    project_id: str,
) -> dict[str, DocumentModel]:
    """Build a doc_id -> DocumentModel lookup for a project."""
    result = await db.execute(
        select(DocumentModel).where(DocumentModel.project_id == project_id)
    )
    return {doc.id: doc for doc in result.scalars().all()}


def _semantic_search(
    project_id: str,
    query: str,
    top_k: int,
) -> dict[str, float]:
    """Run vector similarity search via ChromaDB. Returns {chunk_id: score}."""
    from app import vectorstore

    embedder = get_embedder()
    query_vector = embedder.embed_single(query)

    results = vectorstore.query_similar(
        project_id=project_id,
        query_vector=query_vector,
        top_k=top_k,
    )

    scores: dict[str, float] = {}
    if results and results.get("ids") and results["ids"][0]:
        ids = results["ids"][0]
        distances = results["distances"][0] if results.get("distances") else [0.0] * len(ids)
        for chunk_id, distance in zip(ids, distances):
            # ChromaDB cosine distance: 0 = identical, 2 = opposite
            # Convert to similarity score: 1 - (distance / 2)
            scores[chunk_id] = 1.0 - (distance / 2.0)

    return scores


def _keyword_search(
    project_id: str,
    chunks: list[ChunkModel],
    query: str,
    top_k: int,
    last_indexed_at: Optional[str] = None,
) -> dict[str, float]:
    """Run BM25 keyword search over chunk texts. Returns {chunk_id: score}.

    Uses the BM25Manager cache to avoid rebuilding the index on every query.
    """
    if not chunks:
        return {}

    from app.bm25_cache import get_bm25_manager

    manager = get_bm25_manager()
    bm25, chunk_ids = manager.get_or_build(project_id, chunks, _tokenize, last_indexed_at)

    if not chunk_ids:
        return {}

    query_tokens = _tokenize(query)
    raw_scores = bm25.get_scores(query_tokens)

    # Pair scores with chunk IDs and sort descending
    scored = sorted(
        zip(chunk_ids, raw_scores),
        key=lambda x: x[1],
        reverse=True,
    )

    # Normalize scores to [0, 1] range
    max_score = float(scored[0][1]) if scored and scored[0][1] > 0 else 1.0
    scores: dict[str, float] = {}
    for chunk_id, score in scored[:top_k]:
        if score > 0:
            scores[chunk_id] = float(score) / max_score

    return scores


def _reciprocal_rank_fusion(
    *score_dicts: dict[str, float],
    k: int = 60,
) -> dict[str, float]:
    """Combine multiple ranked lists using Reciprocal Rank Fusion (RRF).

    RRF is the SOTA method for merging heterogeneous ranking signals.
    Each item's final score = sum(1 / (k + rank_i)) across all lists.
    """
    fused: dict[str, float] = {}

    for scores in score_dicts:
        # Sort by score descending to get rank
        ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        for rank, (chunk_id, _score) in enumerate(ranked, start=1):
            fused[chunk_id] = fused.get(chunk_id, 0.0) + 1.0 / (k + rank)

    return fused


async def search(
    db: AsyncSession,
    project_id: str,
    query: str,
    top_k: int = 10,
    mode: str = "hybrid",
    min_score: float = 0.01,
    context_budget: int = 10000,
) -> list[SearchResultItem]:
    """Execute a two-stage search with cross-encoder reranking.

    Stage 1: Fast candidate retrieval (semantic, keyword, or hybrid).
    Stage 2: Cross-encoder reranking with adaptive result selection.

    The result count is NO LONGER fixed. The system adaptively selects
    results based on the reranker's score distribution:
      - Keeps all results with score >= min_score (default 0.35 sigmoid)
      - Detects score gaps: stops if next result drops >50% vs previous
      - Respects a total context character budget
      - Clamps to [1, top_k] range

    Args:
        db: Database session.
        project_id: Project to search within.
        query: User's natural language query.
        top_k: Maximum number of results (hard cap).
        mode: "semantic", "keyword", or "hybrid".
        min_score: Minimum sigmoid-normalized rerank score (0-1). 0.5 = neutral.
        context_budget: Maximum total characters across all returned chunks.

    Returns:
        List of SearchResultItem, sorted by cross-encoder relevance.
    """
    from app.reranker import rerank

    chunks = await _fetch_project_chunks(db, project_id)
    if not chunks:
        logger.info(f"Search skipped: Project {project_id} is empty (NO chunks).")
        return []

    # Get project to read last_indexed_at timestamp for cache validation
    from app.models import ProjectModel
    project = await db.scalar(select(ProjectModel).where(ProjectModel.id == project_id))
    last_indexed_at_str = project.last_indexed_at.isoformat() if project and project.last_indexed_at else None

    doc_map = await _fetch_doc_map(db, project_id)

    # Build chunk lookup
    chunk_map = {c.id: c for c in chunks}

    # Stage 1: Over-fetch candidates (6x top_k for better reranking coverage)
    candidate_k = min(top_k * 6, len(chunks))

    if mode == "semantic":
        final_scores = _semantic_search(project_id, query, candidate_k)
    elif mode == "keyword":
        final_scores = _keyword_search(project_id, chunks, query, candidate_k, last_indexed_at_str)
    else:
        # Hybrid: combine both using RRF
        sem_scores = _semantic_search(project_id, query, candidate_k)
        kw_scores = _keyword_search(project_id, chunks, query, candidate_k, last_indexed_at_str)
        final_scores = _reciprocal_rank_fusion(sem_scores, kw_scores)

    if not final_scores:
        logger.info(f"Search finished: Stage 1 [{mode}] found 0 candidates for query '{query[:50]}'")
        return []

    # Sort by Stage 1 score and take candidates
    ranked_candidates = sorted(
        final_scores.items(), key=lambda x: x[1], reverse=True
    )[:candidate_k]

    # Build candidate dicts for the reranker
    candidate_dicts: list[dict] = []
    for chunk_id, stage1_score in ranked_candidates:
        chunk = chunk_map.get(chunk_id)
        if not chunk:
            continue
        doc = doc_map.get(chunk.doc_id)
        if not doc:
            continue
        candidate_dicts.append({
            "chunk_id": chunk.id,
            "doc_id": doc.id,
            "text": _strip_context_prefix(chunk.text),
            "start_char": chunk.start_char,
            "end_char": chunk.end_char,
            "strategy": chunk.strategy,
            "doc_title": doc.title,
            "source_type": doc.source_type,
            "source_url": doc.source_url,
            "confidence_level": doc.confidence_level,
            "stage1_score": stage1_score,
        })

    # Stage 2: Cross-encoder reranking (returns ALL scored, sorted descending)
    reranked = rerank(query, candidate_dicts)

    # ── Adaptive Result Selection ──────────────────────────────
    # Instead of blindly taking top_k, we use the score distribution
    # to determine how many results are actually relevant.
    MAX_CHUNK_CHARS = 1500   # ~375 tokens - truncate oversized chunks
    total_chars = 0

    results: list[SearchResultItem] = []
    seen_texts: list[set] = []  # Store word sets for near-duplicate detection
    prev_score: float = 1.0

    for item in reranked:
        score = round(item["rerank_score"], 6)

        # ① Hard floor: skip anything below min_score
        if score < min_score:
            logger.debug("Adaptive cutoff: score %.4f < min_score %.4f, stopping", score, min_score)
            break

        # ② Score gap detection: if score drops >50% relative to previous, stop
        #    (but always keep at least 1 result)
        if results and prev_score > 0:
            relative_drop = (prev_score - score) / prev_score
            if relative_drop > 0.50:
                logger.debug(
                    "Adaptive cutoff: score gap %.0f%% (%.4f → %.4f), stopping at %d results",
                    relative_drop * 100, prev_score, score, len(results),
                )
                break

        # ③ Hard cap
        if len(results) >= top_k:
            break

        # Strip context prefix and truncate oversized chunks
        clean_text = _strip_context_prefix(item["text"]).strip()
        if len(clean_text) > MAX_CHUNK_CHARS:
            truncated = clean_text[:MAX_CHUNK_CHARS]
            last_period = truncated.rfind('.')
            if last_period > MAX_CHUNK_CHARS // 2:
                clean_text = truncated[:last_period + 1]
            else:
                clean_text = truncated + "..."

        # Near-duplicate detection: skip chunks that overlap >70%
        chunk_words = set(re.findall(r'\w+', clean_text.lower()))
        is_near_dup = False
        for seen_words in seen_texts:
            if not chunk_words or not seen_words:
                continue
            overlap = len(chunk_words & seen_words) / min(len(chunk_words), len(seen_words))
            if overlap > 0.70:
                is_near_dup = True
                break
        if is_near_dup:
            logger.debug("Skipping near-duplicate chunk: %.0f%% overlap", overlap * 100)
            continue
        seen_texts.append(chunk_words)

        # ④ Context budget: stop when total chars would exceed budget
        if total_chars + len(clean_text) > context_budget and results:
            logger.info("Context budget reached (%d/%d chars), stopping at %d results", total_chars, context_budget, len(results))
            break
        total_chars += len(clean_text)

        prev_score = score
        results.append(SearchResultItem(
            chunk_id=item["chunk_id"],
            doc_id=item["doc_id"],
            text=clean_text,
            score=score,
            start_char=item["start_char"],
            end_char=item["end_char"],
            strategy=item["strategy"],
            doc_title=item["doc_title"],
            source_type=item["source_type"],
            source_url=item.get("source_url"),
            confidence_level=item["confidence_level"],
        ))

    logger.info(
        "Search [%s+rerank] in project %s: query='%s' → %d candidates → %d results (adaptive, budget %d/%d chars).",
        mode, project_id, query[:50], len(candidate_dicts), len(results), total_chars, context_budget,
    )
    return results


def build_context_window(
    query: str,
    results: list[SearchResultItem],
) -> str:
    """Format search results into a structured context window for LLM consumption.

    Produces a markdown-like block with source citations and chunk text.
    """
    if not results:
        return f"No relevant information found for: {query}"

    sections: list[str] = []
    for i, r in enumerate(results, 1):
        header = f"[Source {i}] {r.doc_title}"
        if r.source_url:
            header += f" ({r.source_url})"
        header += f" | chars {r.start_char}-{r.end_char} | score: {r.score}"

        sections.append(f"{header}\n{r.text}")

    return "\n\n---\n\n".join(sections)
