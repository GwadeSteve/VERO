"""VERO Parser — Plain Text & Markdown: Simple text extraction."""

import logging
from pathlib import Path

from app.parsers.contracts import ParsedDocument, has_math_symbols

logger = logging.getLogger(__name__)


def _extract_md_tables(text: str) -> list:
    """Extract Markdown tables from text as a list of 2D lists."""
    tables, current = [], []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            cells = [c.strip() for c in stripped.split("|") if c.strip()]
            # Skip separator rows (|---|---|)
            if cells and not all(set(c) <= {"-", ":"} for c in cells):
                current.append(cells)
        else:
            if current and len(current) >= 2:
                tables.append(current)
            current = []
    if current and len(current) >= 2:
        tables.append(current)
    return tables


async def parse_text(filepath: str) -> dict:
    """Parse a plain text or Markdown file.

    For Markdown files, the text is already in the right format.
    For plain text, paragraphs are preserved as-is.

    Returns {"text": str, "metadata": dict, "parsed_doc": ParsedDocument}
    """
    path = Path(filepath)
    filename = path.name
    is_markdown = path.suffix.lower() in (".md", ".markdown")

    text = path.read_text(encoding="utf-8", errors="ignore")

    # Detect features
    tables_raw = _extract_md_tables(text) if is_markdown else []
    has_images = "![" in text if is_markdown else False
    has_equations = ("$$" in text or "$" in text) if is_markdown else has_math_symbols(text)

    if not is_markdown:
        # For plain text, ensure paragraph separation
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        markdown_text = "\n\n".join(paragraphs)
    else:
        markdown_text = text

    parsed_doc = ParsedDocument(
        source_type="markdown" if is_markdown else "text",
        filename=filename,
        markdown_text=markdown_text,
        page_count=max(1, len(text.splitlines()) // 50),
        has_images=has_images,
        has_tables=len(tables_raw) > 0,
        has_equations=has_equations,
        is_slide_format=False,
        complexity="text_only",
        tables_raw=tables_raw,
        metadata={
            "line_count": len(text.splitlines()),
            "is_markdown": is_markdown,
        },
    )

    logger.info("Text parsed [%s]: %d chars, %d lines", filename, len(markdown_text), len(text.splitlines()))

    return {
        "text": markdown_text,
        "metadata": parsed_doc.metadata,
        "parsed_doc": parsed_doc,
    }
