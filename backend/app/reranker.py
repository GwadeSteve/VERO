"""VERO Cross-Encoder Reranker: Second-stage precision reranking.

Uses a cross-encoder model to rerank initial retrieval candidates by
evaluating (query, chunk) pairs together, producing dramatically more
accurate relevance scores than independent vector comparisons.
"""

from __future__ import annotations

import logging
import math
import threading
from typing import Optional

logger = logging.getLogger(__name__)

# Thread-safe singleton for the cross-encoder model
_lock = threading.Lock()
_model: Optional[object] = None

RERANKER_MODEL = "BAAI/bge-reranker-base"


def _get_model():
    """Lazy-load the cross-encoder model (thread-safe singleton)."""
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from sentence_transformers import CrossEncoder
                logger.info("Loading cross-encoder model: %s", RERANKER_MODEL)
                _model = CrossEncoder(RERANKER_MODEL)
                logger.info("Cross-encoder model loaded.")
    return _model


def rerank(
    query: str,
    chunks: list[dict],
    top_k: int = 5,
) -> list[dict]:
    """Rerank candidate chunks using the cross-encoder.

    Args:
        query: The user's search query.
        chunks: List of dicts, each must have a "text" key and any
                other metadata to preserve.
        top_k: Number of results to return after reranking.

    Returns:
        Top-k chunks reranked by cross-encoder score, with a
        "rerank_score" field added to each.
    """
    if not chunks:
        return []

    model = _get_model()

    # Build (query, chunk_text) pairs for the cross-encoder
    pairs = [(query, c["text"]) for c in chunks]

    # Score all pairs at once (batch inference)
    raw_scores = model.predict(pairs)

    # Scale the cross-encoder logits to a 0-1 range using a sigmoid function.
    # BGE reranker outputs raw logits. Sigmoid is mathematically robust.
    for chunk, raw in zip(chunks, raw_scores):
        # Clip to prevent overflow in math.exp
        clipped = max(-20.0, min(20.0, float(raw)))
        chunk["rerank_score"] = 1.0 / (1.0 + math.exp(-clipped))

    reranked = sorted(chunks, key=lambda x: x["rerank_score"], reverse=True)

    return reranked[:top_k]
