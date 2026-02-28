"""VERO Chunking: Token-Aware Semantic Chunker."""

import uuid
from langchain_text_splitters import RecursiveCharacterTextSplitter
from app.schema import ChunkResponse
from .base import BaseChunker


class SemanticChunker(BaseChunker):
    """
    SOTA plain-text chunking that relies on syntactic boundaries 
    (Paragraphs -> Sentences -> Words) to ensure thoughts are rarely chopped in half.
    """

    def __init__(self, token_limit: int = 500, overlap: int = 50):
        super().__init__(token_limit=token_limit)
        self.overlap = overlap
        
        # Uses standard LangChain recursive splitter but driven by tiktoken
        # It tries to split on `\n\n` (Paragraph), then `\n`, then ` ` (Word), then `""`
        self.splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
            model_name="gpt-3.5-turbo", # maps to cl100k_base
            chunk_size=self.token_limit,
            chunk_overlap=self.overlap,
        )

    def chunk(self, text: str, doc_id: str, project_id: str) -> list[ChunkResponse]:
        texts = self.splitter.split_text(text)

        response_chunks = []
        for chunk_text in texts:
            # Find accurate character offsets
            # Due to overlapping, `.find()` on the first 100 characters usually locates it precisely, 
            # as long as we keep track of where the last one was found.
            start_idx = text.find(chunk_text[:100])
            end_idx = start_idx + len(chunk_text) if start_idx != -1 else len(text)

            response_chunks.append(ChunkResponse(
                id=uuid.uuid4().hex[:12],
                doc_id=doc_id,
                project_id=project_id,
                text=chunk_text,
                start_char=max(0, start_idx),
                end_char=max(0, end_idx),
                token_count=self.count_tokens(chunk_text),
                strategy="semantic",
                metadata={}
            ))

        return response_chunks
