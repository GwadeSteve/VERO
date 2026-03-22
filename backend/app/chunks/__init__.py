"""
VERO Chunking: Strategy initialization and dynamic registry.
"""

from app.schema import SourceType
from .hierarchical import HierarchicalChunker
from .markdown import MarkdownChunker
from .semantic import SemanticChunker
from .recursive import RecursiveChunker


def get_chunker_for_source(source_type: SourceType | str, token_limit: int = 500):
    """
    SOTA Dynamic Strategy Registry:
    Auto-selects the best chunker strategy based on document source type.

    All types now default to the hierarchical chunker for parent-child
    chunk relationships. Falls back to specialized chunkers only where
    the hierarchical approach doesn't apply.
    """
    stype = source_type.value if isinstance(source_type, SourceType) else source_type

    # Markdown and repos: hierarchical chunker detects headings natively
    if stype in [SourceType.MARKDOWN.value, SourceType.REPO.value]:
        return HierarchicalChunker(token_limit=token_limit)

    # PDFs, web, docx: hierarchical with paragraph grouping
    elif stype in [SourceType.WEB.value, SourceType.PDF.value, SourceType.DOCX.value]:
        return HierarchicalChunker(token_limit=token_limit)

    # Unknown/plain text: still hierarchical (paragraph grouping mode)
    return HierarchicalChunker(token_limit=token_limit)
