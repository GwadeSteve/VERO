"""VERO Chunking Base: Abstract class for token-aware chunking strategies."""

import tiktoken
from app.schema import ChunkResponse

# We use OpenAI's cl100k_base tokenizer (used for GPT-3.5, GPT-4, and most modern embedding models)
# This ensures our chunks precisely map to token windows for embedding generation in Layer 3.
_TOKENIZER = tiktoken.get_encoding("cl100k_base")


class BaseChunker:
    """Abstract base class for chunking strategies."""

    def __init__(self, token_limit: int = 500):
        self.token_limit = token_limit

    def count_tokens(self, text: str) -> int:
        """Count the number of tokens in a string."""
        return len(_TOKENIZER.encode(text, disallowed_special=()))

    def chunk(self, text: str, doc_id: str, project_id: str) -> list[ChunkResponse]:
        """
        Split text into chunks. Must be implemented by subclasses.
        Subclasses should return a list of ChunkResponse models.
        """
        raise NotImplementedError("Subclasses must implement chunk()")
