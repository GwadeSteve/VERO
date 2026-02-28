"""VERO Chunking: Fallback Recursive Chunker."""

import uuid
from langchain_text_splitters import RecursiveCharacterTextSplitter
from app.schema import ChunkResponse
from .base import BaseChunker


class RecursiveChunker(BaseChunker):
    """
    Standard token-aware fallback chunker for when we don't know the document structure.
    """

    def __init__(self, token_limit: int = 500, overlap: int = 50):
        super().__init__(token_limit=token_limit)
        self.overlap = overlap
        
        self.splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
            model_name="gpt-3.5-turbo",
            chunk_size=self.token_limit,
            chunk_overlap=self.overlap,
        )

    def chunk(self, text: str, doc_id: str, project_id: str) -> list[ChunkResponse]:
        texts = self.splitter.split_text(text)

        response_chunks = []
        for chunk_text in texts:
            start_idx = text.find(chunk_text[:100])
            end_idx = start_idx + len(chunk_text) if start_idx != -1 else -1

            response_chunks.append(ChunkResponse(
                id=uuid.uuid4().hex[:12],
                doc_id=doc_id,
                project_id=project_id,
                text=chunk_text,
                start_char=max(0, start_idx),
                end_char=max(0, end_idx),
                token_count=self.count_tokens(chunk_text),
                strategy="recursive",
                metadata={}
            ))

        return response_chunks
