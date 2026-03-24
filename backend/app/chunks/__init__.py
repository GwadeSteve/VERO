"""
VERO Chunking: Strategy initialization and dynamic registry.
"""

from app.schema import SourceType
from .markdown import MarkdownChunker
from .recursive import RecursiveChunker


def get_chunker_for_source(source_type: SourceType | str, token_limit: int = 500):
    """
    Dynamic Strategy Registry:
    All structured sources (PDF, DOCX, PPTX, Web, MD, Repo) now output Markdown
    from the hardened parsers → route them all to MarkdownChunker.
    
    Only plain text with no structure uses the recursive fallback.
    """
    stype = source_type.value if isinstance(source_type, SourceType) else source_type

    # Plain text has no structure — use recursive fallback
    if stype == SourceType.TEXT.value:
        return RecursiveChunker(token_limit=token_limit)

    # Everything else outputs structured Markdown → MarkdownChunker
    return MarkdownChunker(token_limit=token_limit)
