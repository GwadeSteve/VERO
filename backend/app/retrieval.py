"""VERO Retrieval Engine: Hybrid Search (Semantic + BM25 Keyword).

Combines dense vector search (ChromaDB) with sparse keyword search (BM25)
using Reciprocal Rank Fusion (RRF) for maximum retrieval quality.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from rank_bm25 import BM25Okapi
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.embeddings import get_embedder
from app.models import ChunkModel, DocumentModel
from app.schema import SearchResultItem

logger = logging.getLogger(__name__)


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
    chunks: list[ChunkModel],
    query: str,
    top_k: int,
) -> dict[str, float]:
    """Run BM25 keyword search over chunk texts. Returns {chunk_id: score}."""
    if not chunks:
        return {}

    corpus = [_tokenize(c.text) for c in chunks]
    bm25 = BM25Okapi(corpus)
    query_tokens = _tokenize(query)
    raw_scores = bm25.get_scores(query_tokens)

    # Pair scores with chunk IDs and sort descending
    scored = sorted(
        zip(chunks, raw_scores),
        key=lambda x: x[1],
        reverse=True,
    )

    # Normalize scores to [0, 1] range
    max_score = scored[0][1] if scored and scored[0][1] > 0 else 1.0
    scores: dict[str, float] = {}
    for chunk, score in scored[:top_k]:
        if score > 0:
            scores[chunk.id] = score / max_score

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
    top_k: int = 5,
    mode: str = "hybrid",
    min_score: float = 0.01,
) -> list[SearchResultItem]:
    """Execute a two-stage search with cross-encoder reranking.

    Stage 1: Fast candidate retrieval (semantic, keyword, or hybrid).
    Stage 2: Cross-encoder reranking for precision.

    Args:
        db: Database session.
        project_id: Project to search within.
        query: User's natural language query.
        top_k: Maximum number of results to return.
        mode: "semantic", "keyword", or "hybrid".
        min_score: The absolute minimum rerank score (0-1) to be considered relevant.

    Returns:
        List of SearchResultItem, sorted by cross-encoder relevance.
    """
    from app.reranker import rerank

    chunks = await _fetch_project_chunks(db, project_id)
    if not chunks:
        logger.warning(f"Search failed: Project {project_id} has NO chunks in database.")
        return []

    doc_map = await _fetch_doc_map(db, project_id)

    # Build chunk lookup
    chunk_map = {c.id: c for c in chunks}

    # Stage 1: Over-fetch candidates (4x top_k for reranking headroom)
    candidate_k = min(top_k * 4, len(chunks))

    if mode == "semantic":
        final_scores = _semantic_search(project_id, query, candidate_k)
    elif mode == "keyword":
        final_scores = _keyword_search(chunks, query, candidate_k)
    else:
        # Hybrid: combine both using RRF
        sem_scores = _semantic_search(project_id, query, candidate_k)
        kw_scores = _keyword_search(chunks, query, candidate_k)
        final_scores = _reciprocal_rank_fusion(sem_scores, kw_scores)

    if not final_scores:
        logger.warning(f"Search failed: Stage 1 [{mode}] returned 0 candidates for query '{query[:50]}'")
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
            "text": chunk.text,
            "start_char": chunk.start_char,
            "end_char": chunk.end_char,
            "strategy": chunk.strategy,
            "doc_title": doc.title,
            "source_type": doc.source_type,
            "source_url": doc.source_url,
            "confidence_level": doc.confidence_level,
            "stage1_score": stage1_score,
        })

    # Stage 2: Cross-encoder reranking
    reranked = rerank(query, candidate_dicts, top_k=top_k)

    # Build response items with reranked scores, filtering out irrelevant noise
    results: list[SearchResultItem] = []
    for item in reranked:
        score = round(item["rerank_score"], 6)
        if score < min_score:
            continue
            
        results.append(SearchResultItem(
            chunk_id=item["chunk_id"],
            doc_id=item["doc_id"],
            text=item["text"],
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
        "Search [%s+rerank] in project %s: query='%s' → %d candidates → %d results.",
        mode, project_id, query[:50], len(candidate_dicts), len(results),
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
