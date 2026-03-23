"""VERO Embedding Provider: Local sentence-transformers model.

Uses all-MiniLM-L6-v2 by default (~80MB, 384 dimensions).
The model is lazy-loaded on first embed() call to avoid slowing server startup.
"""

from __future__ import annotations

import logging
import threading

from sentence_transformers import SentenceTransformer

from app.embeddings.base import BaseEmbedder

logger = logging.getLogger(__name__)

# Thread-safe singleton cache for loaded models
_model_cache: dict[str, SentenceTransformer] = {}
_lock = threading.Lock()


def _get_model(model_name: str) -> SentenceTransformer:
    """Load a sentence-transformers model, caching it across calls."""
    if model_name not in _model_cache:
        with _lock:
            if model_name not in _model_cache:
                try:
                    logger.info("Loading embedding model '%s' (local files only)...", model_name)
                    _model_cache[model_name] = SentenceTransformer(model_name, local_files_only=True)
                except Exception as e:
                    logger.warning("Local cache missing. Downloading '%s' from HuggingFace...", model_name)
                    _model_cache[model_name] = SentenceTransformer(model_name, local_files_only=False)
                logger.info("Model '%s' loaded successfully.", model_name)
    return _model_cache[model_name]
    

class LocalEmbedder(BaseEmbedder):
    """Local embedding provider using sentence-transformers.

    Lazy-loads the model on first use. Thread-safe via singleton pattern.
    """

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        super().__init__(model_name=model_name)
        self._dimension: int | None = None

    @property
    def dimension(self) -> int:
        if self._dimension is None:
            model = _get_model(self._model_name)
            self._dimension = model.get_sentence_embedding_dimension()
        return self._dimension

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts using the local model.

        Args:
            texts: List of text strings to embed.

        Returns:
            List of float vectors (each of length `self.dimension`).
        """
        if not texts:
            return []

        model = _get_model(self._model_name)
        embeddings = model.encode(texts, show_progress_bar=False, convert_to_numpy=True)

        return [vec.tolist() for vec in embeddings]
