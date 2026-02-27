"""VERO Parsers: Dispatcher that routes files to the correct parser based on source type."""

from pathlib import Path
from app.schema import SourceType

from app.parsers.pdf import parse_pdf
from app.parsers.docx import parse_docx
from app.parsers.text import parse_text
from app.parsers.web import parse_web


def detect_source_type(filename: str) -> SourceType:
    """Infer source type from file extension."""
    ext = Path(filename).suffix.lower()
    mapping = {
        ".pdf": SourceType.PDF,
        ".docx": SourceType.DOCX,
        ".md": SourceType.MARKDOWN,
        ".txt": SourceType.TEXT,
    }
    if ext not in mapping:
        raise ValueError(f"Unsupported file extension: {ext}")
    return mapping[ext]


async def parse_file(filepath: str, source_type: SourceType) -> dict:
    """
    Parse a file and return {"text": str, "metadata": dict}.
    """
    parsers = {
        SourceType.PDF: parse_pdf,
        SourceType.DOCX: parse_docx,
        SourceType.MARKDOWN: parse_text,
        SourceType.TEXT: parse_text,
    }
    parser = parsers.get(source_type)
    if parser is None:
        raise ValueError(f"No parser for source type: {source_type}")
    return await parser(filepath)
