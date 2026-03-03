"""VERO Embedding Base: Abstract interface for embedding providers."""

from abc import ABC, abstractmethod


class BaseEmbedder(ABC):
    """Abstract base class that all embedding providers must implement."""

    def __init__(self, model_name: str):
        self._model_name = model_name

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    @abstractmethod
    def dimension(self) -> int:
        """Return the dimensionality of the embedding vectors."""
        ...

    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts into dense vectors.

        Args:
            texts: List of text strings to embed.

        Returns:
            List of float vectors, one per input text.
        """
        ...

    def embed_single(self, text: str) -> list[float]:
        """Convenience method to embed a single text."""
        return self.embed([text])[0]
