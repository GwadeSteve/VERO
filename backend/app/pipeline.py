"""VERO Auto-Pipeline: Background task that chunks + embeds documents on ingest."""

import json
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models import DocumentModel, ChunkModel, EmbeddingModel

logger = logging.getLogger(__name__)

DEFAULT_EMBED_MODEL = "all-MiniLM-L6-v2"


async def auto_pipeline(doc_id: str):
    """Run chunk → embed pipeline on a document in the background.

    Updates processing_status: pending → processing → ready (or failed).
    """
    async with async_session() as db:
        try:
            # Mark as processing
            doc = await _get_doc(db, doc_id)
            if doc is None:
                logger.error("Auto-pipeline: document %s not found", doc_id)
                return
            
            doc.processing_status = "processing"
            await db.commit()
            
            # Step 1: Chunk
            logger.info("Auto-pipeline: chunking document %s (%s)", doc_id, doc.title)
            await _chunk_document(db, doc)
            
            # Step 2: Embed
            logger.info("Auto-pipeline: embedding document %s", doc_id)
            await _embed_document(db, doc)
            
            # Mark as ready
            doc.processing_status = "ready"
            await db.commit()
            logger.info("Auto-pipeline: document %s is ready for search", doc_id)
            
        except Exception as e:
            logger.error("Auto-pipeline failed for %s: %s", doc_id, e)
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
    
    # Generate new chunks
    chunker = get_chunker_for_source(doc.source_type)
    chunk_responses = chunker.chunk(text=doc.raw_text, doc_id=doc.id, project_id=doc.project_id)
    
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

    # Compute embeddings
    texts = [c.text for c in chunks]
    vectors = embedder.embed(texts)

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

    # Upsert into vector store
    vectorstore.upsert_embeddings(
        project_id=doc.project_id,
        chunk_ids=chunk_ids,
        vectors=vectors_for_store,
        documents=documents_for_store,
        metadatas=metadatas_for_store,
    )

    await db.commit()
    logger.info("Auto-pipeline: embedded %d chunks for %s", len(chunks), doc.id)
