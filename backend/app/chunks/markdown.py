"""VERO Chunking: Context-Preserving Markdown Chunker with Table Integrity."""

import logging
import re
import uuid
from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter
from app.schema import ChunkResponse
from .base import BaseChunker

logger = logging.getLogger(__name__)

# Loosened table regex: matches pipe-delimited rows where the second line
# contains at least one separator cell (dashes, optionally with colons).
# This catches tables from pdfplumber, pymupdf4llm, and hand-written Markdown.
_TABLE_PATTERN = re.compile(
    r'(\|[^\n]+\|\n'           # Header row: | ... |
    r'\|[\s\-:|]+\|\n'        # Separator row: |---|---| or | :---: | etc.
    r'(?:\|[^\n]*\|\n?)+)',   # Data rows (1 or more): | ... |
    re.MULTILINE
)

# Explicit heading key order for breadcrumb construction (Gap 3)
_HEADING_KEYS = ["Header 1", "Header 2", "Header 3"]

# Minimum word count to keep a chunk (Gap 2: filter degenerate chunks)
_MIN_WORDS = 15


def _protect_tables(text: str) -> tuple[str, dict[str, str]]:
    """Replace Markdown tables with placeholders to prevent mid-row splitting.
    
    Returns (modified_text, {placeholder: original_table})
    """
    table_map = {}
    
    def replace_table(match):
        table_text = match.group(0)
        placeholder = f"__TABLE_{len(table_map)}__"
        table_map[placeholder] = table_text
        return placeholder
    
    protected = _TABLE_PATTERN.sub(replace_table, text)
    
    if table_map:
        logger.info("Table protection: %d tables shielded from splitting", len(table_map))
    
    return protected, table_map


def _restore_tables(text: str, table_map: dict[str, str]) -> str:
    """Restore table placeholders back to actual Markdown tables."""
    for placeholder, table_text in table_map.items():
        text = text.replace(placeholder, table_text)
    return text


def _build_breadcrumbs(metadata: dict) -> str:
    """Build breadcrumb string from heading metadata in explicit key order.
    
    Uses explicit key lookup over _HEADING_KEYS so heading order never
    silently breaks even if dict iteration order changes. (Gap 3)
    """
    parts = []
    for key in _HEADING_KEYS:
        if key in metadata:
            parts.append(metadata[key])
    return " > ".join(parts) if parts else "Root"


class MarkdownChunker(BaseChunker):
    """
    Markdown-aware chunking that:
    1. Splits on heading boundaries (#, ##, ###) to keep sections coherent
    2. Protects Markdown tables from being split mid-row
    3. Preserves parent heading hierarchy as breadcrumbs in each chunk
    4. Falls back to token-aware recursive splitting for oversized sections
    5. Filters degenerate chunks (heading-only, < 15 words)
    
    Note on tokenizer (Gap 5): We use tiktoken's cl100k_base encoding
    (via "gpt-3.5-turbo" model name) for token counting. Our actual LLMs
    are Gemini and Groq models which use different tokenizers. cl100k_base
    is used as a universal approximation — it slightly over-counts vs Gemini's
    tokenizer, which is safe (we'd rather have slightly smaller chunks than
    chunks that overflow the context window).
    """

    def __init__(self, token_limit: int = 500, overlap: int = 50):
        super().__init__(token_limit=token_limit)
        self.overlap = overlap
        
        self.headers_to_split_on = [
            ("#", "Header 1"),
            ("##", "Header 2"),
            ("###", "Header 3"),
        ]

    def chunk(self, text: str, doc_id: str, project_id: str, doc_title: str = "") -> list[ChunkResponse]:
        # Step 1: Protect tables from being split
        protected_text, table_map = _protect_tables(text)
        
        # Step 2: Split by headers
        md_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=self.headers_to_split_on)
        splits = md_splitter.split_text(protected_text)
        
        # Step 3: Sub-split oversized sections (token-aware)
        # Note (Gap 5): "gpt-3.5-turbo" maps to cl100k_base tokenizer.
        # This is an approximation — see class docstring for rationale.
        fallback_splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
            model_name="gpt-3.5-turbo",
            chunk_size=self.token_limit,
            chunk_overlap=self.overlap,
        )
        
        final_chunks = fallback_splitter.split_documents(splits)

        # Step 4: Build response chunks with restored tables and breadcrumbs
        response_chunks = []
        search_start = 0  # Track position for sequential start_char mapping
        norm_text = text.replace("\r\n", "\n")
        
        for doc in final_chunks:
            # Restore any protected tables in this chunk
            chunk_text = _restore_tables(doc.page_content, table_map)
            
            # Gap 2: Filter degenerate chunks (heading-only, whitespace-only)
            word_count = len(chunk_text.split())
            if word_count < _MIN_WORDS:
                continue
            
            # Build breadcrumb from heading hierarchy (Gap 3: explicit key order)
            breadcrumbs = _build_breadcrumbs(doc.metadata)
            
            # Contextualized text for embedding: source + section path + content
            if doc_title:
                contextualized_text = f"[Source: {doc_title}]\n[Section: {breadcrumbs}]\n{chunk_text}"
            else:
                contextualized_text = f"[Section: {breadcrumbs}]\n{chunk_text}"
            
            # Gap 4: Warn about oversized chunks (usually a large table kept intact)
            token_count = self.count_tokens(contextualized_text)
            if token_count > self.token_limit * 1.5:
                logger.warning(
                    "Oversized chunk (%d tokens, limit %d) in [%s > %s] — likely a large table kept intact",
                    token_count, self.token_limit, doc_title or "unknown", breadcrumbs,
                )
            
            # Find character offsets using sequential search
            lines = [l.strip() for l in chunk_text.strip().split("\n") if l.strip()]
            if lines:
                anchor = lines[0][:80]
                start_idx = norm_text.find(anchor, search_start)
                if start_idx == -1:
                    start_idx = norm_text.find(anchor)  # Retry from beginning
                
                if start_idx != -1:
                    end_idx = start_idx + len(chunk_text)
                    search_start = end_idx  # Advance past this chunk's content
                else:
                    start_idx = 0
                    end_idx = 0
            else:
                start_idx = 0
                end_idx = 0

            response_chunks.append(ChunkResponse(
                id=uuid.uuid4().hex[:12],
                doc_id=doc_id,
                project_id=project_id,
                text=contextualized_text,
                start_char=start_idx,
                end_char=end_idx,
                token_count=token_count,
                strategy="markdown",
                metadata={"breadcrumbs": breadcrumbs}
            ))

        return response_chunks
