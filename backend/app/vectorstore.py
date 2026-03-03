"""VERO Vector Store: ChromaDB integration for persistent local vector storage.

Each project gets its own ChromaDB collection, keeping vectors isolated.
Stored in backend/data/chromadb/ for persistence across server restarts.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import chromadb

logger = logging.getLogger(__name__)

# Persistent storage directory
_CHROMA_DIR = Path(__file__).resolve().parent.parent / "data" / "chromadb"
_CHROMA_DIR.mkdir(parents=True, exist_ok=True)

# Singleton client
_client: Optional[chromadb.PersistentClient] = None


def _get_client() -> chromadb.PersistentClient:
    """Return the singleton ChromaDB client."""
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(path=str(_CHROMA_DIR))
        logger.info("ChromaDB client initialized at %s", _CHROMA_DIR)
    return _client


def get_collection(project_id: str):
    """Get or create a ChromaDB collection for a project.

    Collection names are prefixed with 'vero_' and use the project ID.
    """
    client = _get_client()
    name = f"vero_{project_id}"
    return client.get_or_create_collection(
        name=name,
        metadata={"hnsw:space": "cosine"},
    )


def upsert_embeddings(
    project_id: str,
    chunk_ids: list[str],
    vectors: list[list[float]],
    documents: list[str],
    metadatas: Optional[list[dict]] = None,
):
    """Insert or update embeddings in the project's ChromaDB collection.

    Uses chunk_id as the unique identifier, making this operation idempotent.
    """
    collection = get_collection(project_id)
    collection.upsert(
        ids=chunk_ids,
        embeddings=vectors,
        documents=documents,
        metadatas=metadatas or [{} for _ in chunk_ids],
    )
    logger.info("Upserted %d vectors into collection 'vero_%s'.", len(chunk_ids), project_id)


def query_similar(
    project_id: str,
    query_vector: list[float],
    top_k: int = 5,
) -> dict:
    """Find the most similar chunks to a query vector.

    Returns ChromaDB query results with ids, distances, documents, and metadatas.
    """
    collection = get_collection(project_id)
    return collection.query(
        query_embeddings=[query_vector],
        n_results=top_k,
    )


def delete_chunk_vectors(project_id: str, chunk_ids: list[str]):
    """Remove specific chunk vectors from a collection."""
    collection = get_collection(project_id)
    collection.delete(ids=chunk_ids)
    logger.info("Deleted %d vectors from collection 'vero_%s'.", len(chunk_ids), project_id)
