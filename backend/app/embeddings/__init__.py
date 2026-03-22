"""VERO Embedding Provider Registry: Resolve an embedder by model name."""

from app.embeddings.local import LocalEmbedder

# Default model for VERO
DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"

# Registry of available embedding providers
_REGISTRY = {
    "BAAI/bge-small-en-v1.5": LocalEmbedder,
}


def get_embedder(model_name: str = DEFAULT_MODEL):
    """Return an embedder instance for the given model name.

    Raises KeyError if the model is not registered.
    """
    cls = _REGISTRY.get(model_name)
    if cls is None:
        raise KeyError(
            f"Unknown embedding model '{model_name}'. "
            f"Available: {list(_REGISTRY.keys())}"
        )
    return cls(model_name=model_name)
