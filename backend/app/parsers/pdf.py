"""
VERO Parser — PDF
-----------------
Extracts text from PDF files using PyMuPDF.
"""

import fitz  # PyMuPDF


async def parse_pdf(filepath: str) -> dict:
    """Extract text and per-page metadata from a PDF."""
    doc = fitz.open(filepath)
    pages = []
    full_text_parts = []

    for i, page in enumerate(doc):
        text = page.get_text("text")
        pages.append({"page": i + 1, "char_count": len(text)})
        full_text_parts.append(text)

    doc.close()

    return {
        "text": "\n\n".join(full_text_parts),
        "metadata": {
            "page_count": len(pages),
            "pages": pages,
        },
    }
