"""Background model warmup for startup readiness and cold-start reduction."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
import time

logger = logging.getLogger(__name__)

_task: asyncio.Task | None = None
_state_lock = threading.Lock()
_state = {
    "status": "idle",
    "started_at": None,
    "completed_at": None,
    "duration_seconds": None,
    "error": None,
}


def _set_state(**updates) -> None:
    with _state_lock:
        _state.update(updates)


def get_warmup_status() -> dict:
    """Return a copy of the current warmup state."""
    with _state_lock:
        return dict(_state)


def models_ready() -> bool:
    """Return True when the background warmup completed successfully."""
    return get_warmup_status()["status"] == "ready"


def start_model_warmup() -> asyncio.Task | None:
    """Start the background warmup task once per process."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_run_model_warmup(), name="vero-model-warmup")
    return _task


async def wait_for_model_warmup() -> None:
    """Wait for the current warmup task if it is still running."""
    task = _task
    if task is None or task.done():
        return
    await task


async def stop_model_warmup() -> None:
    """Cancel the background warmup task if it is still pending."""
    global _task
    if _task is None or _task.done():
        return

    _task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await _task


async def _run_model_warmup() -> None:
    started_at = time.time()
    _set_state(
        status="warming",
        started_at=started_at,
        completed_at=None,
        duration_seconds=None,
        error=None,
    )

    try:
        timing = await asyncio.to_thread(_warmup_sync)
    except Exception as exc:
        logger.exception("Background model warmup failed.")
        _set_state(
            status="failed",
            completed_at=time.time(),
            duration_seconds=round(time.time() - started_at, 3),
            error=str(exc),
        )
        return

    total = round(time.time() - started_at, 3)
    _set_state(
        status="ready",
        completed_at=time.time(),
        duration_seconds=total,
        error=None,
    )
    logger.info(
        "Background model warmup completed in %.2fs (embedder=%.2fs, reranker=%.2fs).",
        total,
        timing["embedder_seconds"],
        timing["reranker_seconds"],
    )


def _warmup_sync() -> dict[str, float]:
    from app.embeddings.local import warmup_embedding_model
    from app.reranker import warmup_reranker

    embedder_started = time.perf_counter()
    warmup_embedding_model()
    embedder_elapsed = time.perf_counter() - embedder_started

    reranker_started = time.perf_counter()
    warmup_reranker()
    reranker_elapsed = time.perf_counter() - reranker_started

    return {
        "embedder_seconds": round(embedder_elapsed, 3),
        "reranker_seconds": round(reranker_elapsed, 3),
    }
