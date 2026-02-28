"""VERO Chunking: Context-Preserving Markdown Chunker."""

import uuid
from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter
from app.schema import ChunkResponse
from .base import BaseChunker


class MarkdownChunker(BaseChunker):
    """
    State-of-the-Art Markdown chunking: splits strictly by headers (#, ##, etc)
    and retains parent hierarchy in the chunk's metadata (Context-Preservation).
    """

    def __init__(self, token_limit: int = 500, overlap: int = 50):
        super().__init__(token_limit=token_limit)
        self.overlap = overlap
        
        # We split on H1, H2, and H3 to maintain structural sanity
        self.headers_to_split_on = [
            ("#", "Header 1"),
            ("##", "Header 2"),
            ("###", "Header 3"),
        ]

    def chunk(self, text: str, doc_id: str, project_id: str) -> list[ChunkResponse]:
        # Step 1: Split strictly by headers. 
        # This groups logical sections together (e.g. all of "Installation" is one doc)
        md_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=self.headers_to_split_on)
        splits = md_splitter.split_text(text)
        
        # Step 2: Since a single header section might STILL exceed our token limit,
        # we fall back to a token-aware recursive character splitter for big sections.
        fallback_splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
            model_name="gpt-3.5-turbo", # Same cl100k_base encoding as BaseChunker
            chunk_size=self.token_limit,
            chunk_overlap=self.overlap,
        )
        
        final_chunks = fallback_splitter.split_documents(splits)

        response_chunks = []
        for doc in final_chunks:
            chunk_text = doc.page_content
            # To ensure the LLM knows *what* it's reading, we inject the markdown hierarchy
            # back into the text. e.g. "Header 1 -> Header 2 | The text..."
            breadcrumbs = " > ".join(doc.metadata.values()) if doc.metadata else "Root"
            
            # The search index will get this full context
            contextualized_text = f"[{breadcrumbs}]\n{chunk_text}"
            
            # calculate char offsets (approximate based on text find vs raw original string is tricky 
            # with multiple overlapping structures, but since we modify text with breadcrumbs, 
            # offset maps to original text start if possible, otherwise -1)
            # Find the starting character in the ORIGINAL text
            start_idx = text.find(chunk_text[:50]) # find first 50 chars to locate start
            end_idx = start_idx + len(chunk_text) if start_idx != -1 else -1

            response_chunks.append(ChunkResponse(
                id=uuid.uuid4().hex[:12],
                doc_id=doc_id,
                project_id=project_id,
                text=contextualized_text,
                start_char=max(0, start_idx),
                end_char=max(0, end_idx),
                token_count=self.count_tokens(contextualized_text),
                strategy="markdown",
                metadata={"breadcrumbs": doc.metadata}
            ))

        return response_chunks
