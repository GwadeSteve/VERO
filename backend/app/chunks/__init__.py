"""
VERO Chunking: Strategy initialization and dynamic registry.
"""

from app.schema import SourceType
from .markdown import MarkdownChunker
from .semantic import SemanticChunker
from .recursive import RecursiveChunker


def get_chunker_for_source(source_type: SourceType | str, token_limit: int = 500):
    """
    SOTA Dynamic Strategy Registry:
    Auto-selects the absolute best chunker strategy based on the document source type.
    """
    stype = source_type.value if isinstance(source_type, SourceType) else source_type
    
    # Markdown files and GitHub repositories are rich in headers. 
    # The MarkdownChunker perfectly preserves their context hierarchy.
    if stype in [SourceType.MARKDOWN.value, SourceType.REPOSITORY.value]:
        return MarkdownChunker(token_limit=token_limit)
        
    # Web articles and PDFs are unstructured visually but have strong grammatical bounds.
    # Semantic chunking relies on paragraphs and sentences perfectly.
    elif stype in [SourceType.WEB.value, SourceType.PDF.value, SourceType.DOCX.value]:
        return SemanticChunker(token_limit=token_limit)

    # Plain text or unknown falls back to standard recursive tokenizer.
    return RecursiveChunker(token_limit=token_limit)
