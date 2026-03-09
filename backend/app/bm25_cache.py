"""VERO BM25 Cache: Thread-safe singleton for per-project keyword search indices.

Eliminates the O(n) per-query cost of rebuilding BM25 indices from scratch.
The cache auto-invalidates when the chunk count for a project changes, or
when explicitly invalidated after new documents are ingested.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Optional

from rank_bm25 import BM25Okapi

logger = logging.getLogger(__name__)


@dataclass
class _CachedIndex:
    """A cached BM25 index for a single project."""
    index: BM25Okapi
    chunk_ids: list[str]
    chunk_count: int
    last_indexed_at: Optional[str]
    corpus: list[list[str]] = field(repr=False)


class BM25Manager:
    """Thread-safe per-project BM25 index cache.

    Usage:
        manager = get_bm25_manager()
        index, chunk_ids = manager.get_or_build(project_id, chunks, tokenizer)

    The index is cached in memory and reused across queries. It auto-rebuilds
    when the chunk count changes or when invalidate() is called.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._cache: dict[str, _CachedIndex] = {}

    def get_or_build(
        self,
        project_id: str,
        chunks: list,
        tokenizer,
        last_indexed_at: Optional[str] = None,
    ) -> tuple[BM25Okapi, list[str]]:
        """Get the cached BM25 index or build a new one.

        Args:
            project_id: Project to get index for.
            chunks: List of ChunkModel objects (must have .id and .text).
            tokenizer: A callable that takes a string and returns list[str].
            last_indexed_at: Optional timestamp string from the project.

        Returns:
            Tuple of (BM25Okapi index, list of chunk_ids in corpus order).
        """
        chunk_count = len(chunks)

        # Helper to check if cache is valid
        def _is_valid(c: Optional[_CachedIndex]) -> bool:
            if c is None:
                return False
            if c.chunk_count != chunk_count:
                return False
            # Check timestamp if provided (handles re-embedding without chunk count change)
            if last_indexed_at is not None and c.last_indexed_at != last_indexed_at:
                return False
            return True

        # Fast path: check cache without lock
        cached = self._cache.get(project_id)
        if _is_valid(cached):
            return cached.index, cached.chunk_ids

        # Slow path: rebuild under lock
        with self._lock:
            # Double-check after acquiring lock
            cached = self._cache.get(project_id)
            if _is_valid(cached):
                return cached.index, cached.chunk_ids

            if not chunks:
                # Empty project — return a dummy index
                dummy = BM25Okapi([[""]])
                self._cache[project_id] = _CachedIndex(
                    index=dummy,
                    chunk_ids=[],
                    chunk_count=0,
                    last_indexed_at=last_indexed_at,
                    corpus=[[""]],
                )
                return dummy, []

            # Build the index
            chunk_ids = [c.id for c in chunks]
            corpus = [tokenizer(c.text) for c in chunks]
            index = BM25Okapi(corpus)

            self._cache[project_id] = _CachedIndex(
                index=index,
                chunk_ids=chunk_ids,
                chunk_count=chunk_count,
                last_indexed_at=last_indexed_at,
                corpus=corpus,
            )

            logger.info(
                "BM25 index built for project %s: %d chunks indexed.",
                project_id, chunk_count,
            )
            return index, chunk_ids

    def invalidate(self, project_id: str) -> None:
        """Remove the cached index for a project, forcing a rebuild on next query."""
        with self._lock:
            removed = self._cache.pop(project_id, None)
            if removed:
                logger.info("BM25 cache invalidated for project %s.", project_id)

    def invalidate_all(self) -> None:
        """Clear the entire cache (useful for testing or model changes)."""
        with self._lock:
            self._cache.clear()
            logger.info("BM25 cache fully cleared.")


# Module-level singleton
_manager: Optional[BM25Manager] = None
_init_lock = threading.Lock()


def get_bm25_manager() -> BM25Manager:
    """Return the global BM25Manager singleton."""
    global _manager
    if _manager is None:
        with _init_lock:
            if _manager is None:
                _manager = BM25Manager()
    return _manager
