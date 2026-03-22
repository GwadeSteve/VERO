"""VERO Auto-Pipeline: Background task that chunks + embeds documents on ingest."""

import json
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.database import async_session
from app.models import DocumentModel, ChunkModel, EmbeddingModel

logger = logging.getLogger(__name__)

DEFAULT_EMBED_MODEL = "BAAI/bge-small-en-v1.5"


async def auto_pipeline(doc_id: str):
    """Run chunk → embed pipeline on a document in the background.

    Updates processing_status: pending → processing → ready (or failed).
    """
    async with async_session() as db:
        try:
            # Mark as chunking
            doc = await _get_doc(db, doc_id)
            if doc is None:
                logger.error("Auto-pipeline: document %s not found", doc_id)
                return
            
            doc.processing_status = "chunking"
            await db.commit()
            
            # Step 1: Generate LLM Summary for Contextual Chunks
            if not doc.summary:
                try:
                    from app.llm import get_llm
                    logger.info("Auto-pipeline: generating LLM summary for %s", doc_id)
                    llm = get_llm()
                    system_prompt = (
                        "You are an expert technical summarizer. Provide a concise, highly accurate "
                        "1-3 sentence summary of the following document text. This summary will be "
                        "used to enrich vector embeddings for a Retrieval-Augmented Generation (RAG) system. "
                        "Do not include introductory phrases like 'This document describes...', just provide the facts."
                    )
                    # Use the first 10,000 characters to get the gist without blowing up token limits
                    user_prompt = f"Title: {doc.title}\n\nContent:\n{doc.raw_text[:10000]}"
                    
                    doc.summary = await llm.generate_response(system_prompt, user_prompt)
                    await db.commit()
                    logger.info("Auto-pipeline: generated summary -> %s", doc.summary)
                except Exception as e:
                    logger.warning("Auto-pipeline: Failed to generate summary for %s: %s", doc_id, e)
                    doc.summary = "No summary available."
                    await db.commit()

            # Step 2: Chunk
            logger.info("Auto-pipeline: chunking document %s (%s)", doc_id, doc.title)
            await _chunk_document(db, doc)
            
            # Mark as embedding
            doc = await _get_doc(db, doc_id)
            if doc:
                doc.processing_status = "embedding"
                await db.commit()
                
                # Step 2: Embed
                logger.info("Auto-pipeline: embedding document %s", doc_id)
                await _embed_document(db, doc)
            
            # Mark as ready
            doc = await _get_doc(db, doc_id)
            if doc:
                doc.processing_status = "ready"
                
                # Fetch project and set last_indexed_at
                from app.models import ProjectModel
                project = await db.scalar(select(ProjectModel).where(ProjectModel.id == doc.project_id))
                if project:
                    from app.models import _utcnow
                    project.last_indexed_at = _utcnow()
                
                await db.commit()
                logger.info("Auto-pipeline: document %s is ready for search", doc_id)

                # Invalidate BM25 cache so next search picks up new chunks
                from app.bm25_cache import get_bm25_manager
                get_bm25_manager().invalidate(doc.project_id)
            
        except Exception as e:
            logger.error("Auto-pipeline failed for %s: %s", doc_id, e, exc_info=True)
            try:
                doc = await _get_doc(db, doc_id)
                if doc:
                    doc.processing_status = "failed"
                    await db.commit()
            except Exception:
                pass


async def _get_doc(db: AsyncSession, doc_id: str) -> DocumentModel | None:
    result = await db.execute(
        select(DocumentModel).where(DocumentModel.id == doc_id)
    )
    return result.scalar_one_or_none()


async def _chunk_document(db: AsyncSession, doc: DocumentModel):
    """Generate chunks for the document, replacing any existing ones."""
    from app.chunks import get_chunker_for_source

    # Delete existing chunks
    await db.execute(ChunkModel.__table__.delete().where(ChunkModel.doc_id == doc.id))
    
    # Generate new chunks (CPU-bound)
    chunker = get_chunker_for_source(doc.source_type)
    # Prepare the context header for Metadata-Augmented Ingestion
    context_header = f"{doc.title}"
    if doc.summary and doc.summary != "No summary available.":
        context_header += f" - {doc.summary}"

    # 4. Generate chunks
    chunk_responses = await run_in_threadpool(
        chunker.chunk,
        text=doc.raw_text, 
        doc_id=doc.id, 
        project_id=doc.project_id, 
        doc_title=context_header
    )
    
    for cr in chunk_responses:
        db.add(ChunkModel(
            id=cr.id,
            doc_id=cr.doc_id,
            project_id=cr.project_id,
            text=cr.text,
            start_char=cr.start_char,
            end_char=cr.end_char,
            token_count=cr.token_count,
            strategy=cr.strategy,
            level=cr.level,
            parent_chunk_id=cr.parent_id,
            metadata_json=json.dumps(cr.metadata),
        ))
    
    await db.commit()
    logger.info("Auto-pipeline: created %d chunks for %s", len(chunk_responses), doc.id)


async def _embed_document(db: AsyncSession, doc: DocumentModel):
    """Embed all chunks of a document into the vector store."""
    from app.embeddings import get_embedder
    from app.utils import compute_content_hash
    from app import vectorstore

    # Fetch chunks
    result = await db.execute(
        select(ChunkModel).where(ChunkModel.doc_id == doc.id).order_by(ChunkModel.start_char)
    )
    chunks = result.scalars().all()
    if not chunks:
        return  # Nothing to embed

    # Get embedder
    embedder = get_embedder(DEFAULT_EMBED_MODEL)

    # Compute embeddings (CPU-bound)
    texts = [c.text for c in chunks]
    vectors = await run_in_threadpool(embedder.embed, texts)

    chunk_ids = []
    vectors_for_store = []
    documents_for_store = []
    metadatas_for_store = []

    import uuid
    for chunk, vector in zip(chunks, vectors):
        chunk_hash = compute_content_hash(chunk.text)
        
        # Check for existing embedding
        existing = await db.execute(
            select(EmbeddingModel).where(
                EmbeddingModel.chunk_id == chunk.id,
                EmbeddingModel.model_name == DEFAULT_EMBED_MODEL,
            )
        )
        old_emb = existing.scalar_one_or_none()
        if old_emb:
            await db.delete(old_emb)

        # Create new embedding record
        emb = EmbeddingModel(
            id=uuid.uuid4().hex[:12],
            chunk_id=chunk.id,
            model_name=DEFAULT_EMBED_MODEL,
            dimension=embedder.dimension,
            content_hash=chunk_hash,
        )
        db.add(emb)
        
        chunk_ids.append(chunk.id)
        vectors_for_store.append(vector)
        documents_for_store.append(chunk.text)
        metadatas_for_store.append({
            "doc_id": doc.id,
            "strategy": chunk.strategy,
            "start_char": chunk.start_char,
            "end_char": chunk.end_char,
        })

    # Upsert into vector store (IO-bound / Synchronous)
    await run_in_threadpool(
        vectorstore.upsert_embeddings,
        project_id=doc.project_id,
        chunk_ids=chunk_ids,
        vectors=vectors_for_store,
        documents=documents_for_store,
        metadatas=metadatas_for_store,
    )

    await db.commit()
    logger.info("Auto-pipeline: embedded %d chunks for %s", len(chunks), doc.id)
