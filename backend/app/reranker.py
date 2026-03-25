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

RERANKER_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"


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


def _sigmoid(x: float) -> float:
    """Numerically stable sigmoid for converting logits to probabilities."""
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    else:
        exp_x = math.exp(x)
        return exp_x / (1.0 + exp_x)


def rerank(
    query: str,
    chunks: list[dict],
    top_k: int | None = None,
) -> list[dict]:
    """Rerank candidate chunks using the cross-encoder.

    Args:
        query: The user's search query.
        chunks: List of dicts, each must have a "text" key and any
                other metadata to preserve.
        top_k: Optional hard cap on results. If None, returns ALL scored
               candidates (caller handles adaptive cutoff).

    Returns:
        Chunks sorted by cross-encoder score (descending), with a
        "rerank_score" field (sigmoid-normalized, 0-1) added to each.
    """
    if not chunks:
        return []

    model = _get_model()

    # Build (query, chunk_text) pairs for the cross-encoder
    pairs = [(query, c["text"]) for c in chunks]

    # Score all pairs at once (batch inference)
    raw_scores = model.predict(pairs)

    # Sigmoid-normalize: converts raw logits to proper probabilities [0, 1]
    # This makes the min_score threshold meaningful (0.5 = neutral relevance)
    for chunk, raw in zip(chunks, raw_scores):
        chunk["rerank_score"] = _sigmoid(float(raw))

    reranked = sorted(chunks, key=lambda x: x["rerank_score"], reverse=True)

    if top_k is not None:
        return reranked[:top_k]
    return reranked

