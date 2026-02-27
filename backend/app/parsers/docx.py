"""VERO Parser — DOCX: Extracts text from Word documents using python-docx."""

from docx import Document as DocxDocument


async def parse_docx(filepath: str) -> dict:
    """Extract paragraph text from a DOCX file."""
    doc = DocxDocument(filepath)
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]

    return {
        "text": "\n\n".join(paragraphs),
        "metadata": {
            "paragraph_count": len(paragraphs),
        },
    }
