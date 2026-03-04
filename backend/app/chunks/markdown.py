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
            
            # Step 3: Find the starting character in the ORIGINAL text.
            # Robust mapping: LangChain modifies internal whitespace/newlines.
            # We use a dual-anchor approach: match the first line to find start, match the last line to find end.
            norm_text = text.replace("\r\n", "\n")
            lines = [line.strip() for line in chunk_text.strip().split("\n") if line.strip()]
            
            if lines:
                first_line = lines[0][:60]
                start_idx_norm = norm_text.find(first_line)
                
                if start_idx_norm != -1:
                    # Find end anchor using the last line
                    last_line = lines[-1][-60:]
                    end_idx_norm_search = norm_text.find(last_line, start_idx_norm)
                    
                    if end_idx_norm_search != -1:
                        end_idx_norm = end_idx_norm_search + len(last_line)
                    else:
                        end_idx_norm = start_idx_norm + len(chunk_text) # Fallback

                    # Map back to original indices counting \r\n expansion
                    prefix_norm = norm_text[:start_idx_norm]
                    start_idx = start_idx_norm + (prefix_norm.count("\n") if "\r\n" in text else 0)
                    
                    text_up_to_end_norm = norm_text[:end_idx_norm]
                    end_idx = end_idx_norm + (text_up_to_end_norm.count("\n") if "\r\n" in text else 0)
                else:
                    start_idx = -1
                    end_idx = -1
            else:
                start_idx = -1
                end_idx = -1

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
