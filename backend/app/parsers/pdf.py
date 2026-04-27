"""VERO Parser — PDF: Structure-aware parsing with table extraction and image captioning.

Uses a 3-tool approach:
  1. pymupdf4llm  — converts PDF to structured Markdown (headings, bold, lists, code)
  2. pdfplumber   — precise table extraction → Markdown tables
  3. Gemini Vision — image captioning for figures/diagrams (optional, graceful fallback)

Documents are routed by complexity:
  - text_only:     Simple text PDFs → pymupdf4llm only
  - slide_mode:    Slide-like PDFs (<120 words/page avg) → per-page extraction
  - full_pipeline: Complex docs with images/tables → all 3 tools
"""

import logging
import os
from pathlib import Path

import fitz  # PyMuPDF

from app.parsers.contracts import ParsedDocument, table_to_markdown, has_math_symbols

logger = logging.getLogger(__name__)


# Phase 1: Scan.

def _scan_pdf(path: str) -> dict:
    """Quick scan to determine document complexity and characteristics."""
    doc = fitz.open(path)
    total_images = 0
    table_hints = 0
    words_per_page = []
    has_equations = False

    for page in doc:
        text = page.get_text("text")
        words_per_page.append(len(text.split()))
        total_images += len(page.get_images())

        # Table heuristic: lots of tabs or aligned whitespace
        if text.count("\t") > 4 or text.count("   ") > 15:
            table_hints += 1

        if has_math_symbols(text):
            has_equations = True

    doc.close()

    avg_words = sum(words_per_page) / len(words_per_page) if words_per_page else 0
    is_slide = avg_words < 120

    complexity = (
        "slide_mode" if is_slide
        else "text_only" if not (total_images > 0 or table_hints > 0)
        else "full_pipeline"
    )

    return {
        "page_count": len(words_per_page),
        "has_images": total_images > 0,
        "image_count": total_images,
        "has_tables_hint": table_hints > 0,
        "has_equations": has_equations,
        "is_slide": is_slide,
        "avg_words": round(avg_words),
        "complexity": complexity,
    }


# Phase 2: Image captioning.

def _caption_image(image_bytes: bytes, mime_type: str, page_num: int) -> str | None:
    """Send an image to Gemini Vision for captioning. Returns description or None."""
    # Temporarily disabled to save API resources and speed up ingestion
    return None
    
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=[
                "Describe this figure/diagram from an academic document in 1-2 sentences. "
                "Focus on what information it conveys (data, structure, process), not visual styling. "
                "If it contains a graph, mention axes and trends. If it's a diagram, describe the components.",
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            ],
        )
        if response.text:
            return response.text.strip()
    except Exception as e:
        logger.warning("Gemini Vision captioning failed for page %d: %s", page_num, e)

    return None


def _extract_and_caption_images(path: str) -> tuple[list[str], int]:
    """Extract images from PDF and caption them via Gemini Vision.

    Returns:
        (image_descriptions, total_image_count)
        Each description is a formatted string ready to inject into markdown.
    """
    doc = fitz.open(path)
    descriptions = []
    total = 0

    # Map image extensions to MIME types
    ext_to_mime = {
        "png": "image/png",
        "jpeg": "image/jpeg",
        "jpg": "image/jpeg",
        "jxr": "image/jxr",
        "jpx": "image/jpx",
        "bmp": "image/bmp",
        "tiff": "image/tiff",
    }

    for page_num, page in enumerate(doc):
        for img_info in page.get_images():
            xref = img_info[0]
            try:
                base = doc.extract_image(xref)
                w, h = base["width"], base["height"]

                # Skip tiny images (icons, decorations, bullets)
                if w < 100 or h < 100:
                    continue

                total += 1
                ext = base.get("ext", "png")
                mime = ext_to_mime.get(ext, f"image/{ext}")

                caption = _caption_image(base["image"], mime, page_num + 1)
                if caption:
                    descriptions.append(
                        f'\n> **[Figure, page {page_num + 1}]:** {caption}\n'
                    )
                else:
                    descriptions.append(
                        f"\n> **[Figure, page {page_num + 1}]:** "
                        f"Visual content ({w}×{h}px) — not captioned.\n"
                    )
            except Exception as e:
                logger.warning("Failed to extract image xref=%d on page %d: %s", xref, page_num + 1, e)

    doc.close()
    return descriptions, total


# Phase 3: Table extraction.

def _extract_tables(path: str) -> tuple[str, list]:
    """Extract tables using pdfplumber and convert to Markdown.

    Returns:
        (markdown_tables_text, raw_tables_list)
    """
    import pdfplumber

    tables_md_parts = []
    tables_raw = []

    try:
        with pdfplumber.open(path) as pdf:
            for page_num, page in enumerate(pdf.pages):
                page_tables = page.extract_tables()
                for table in page_tables:
                    if not table or len(table) < 2:
                        continue

                    tables_raw.append(table)
                    md = table_to_markdown(table)
                    if md:
                        tables_md_parts.append(
                            f"\n**Table (page {page_num + 1}):**\n\n{md}\n"
                        )
    except Exception as e:
        logger.warning("pdfplumber table extraction failed: %s", e)

    return "\n".join(tables_md_parts), tables_raw


# Fast text extraction.

def _fast_extract_text(filepath: str) -> str:
    """Extract text page-by-page using PyMuPDF (instant, no ONNX model).

    Returns clean text with page markers for structure.
    """
    doc = fitz.open(filepath)
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text("text").strip()
        if text:
            pages.append(f"## Page {i + 1}\n\n{text}")
    doc.close()
    return "\n\n---\n\n".join(pages)


# Main parser.

async def parse_pdf(filepath: str) -> dict:
    """Parse a PDF using fast extraction + pdfplumber tables.

    Returns {"text": str, "metadata": dict, "parsed_doc": ParsedDocument}
    """
    filename = Path(filepath).name
    scan = _scan_pdf(filepath)

    logger.info(
        "PDF scan [%s]: %s, %d pages, avg %d words/page, images=%s, tables=%s, equations=%s",
        filename, scan["complexity"], scan["page_count"], scan["avg_words"],
        scan["has_images"], scan["has_tables_hint"], scan["has_equations"],
    )

    tables_raw = []
    image_descriptions = []
    image_count = 0

    if scan["complexity"] == "slide_mode":
        # Slide-like PDF: extract per-page with slide markers
        doc = fitz.open(filepath)
        pages_md = []
        for i, page in enumerate(doc):
            text = page.get_text("text").strip()
            if text:
                pages_md.append(f"## Slide {i + 1}\n\n{text}")
        doc.close()
        markdown_text = "\n\n---\n\n".join(pages_md)

    else:
        # Fast text extraction (no ONNX model, works in seconds not minutes)
        markdown_text = _fast_extract_text(filepath)

        # Extract tables via pdfplumber (precise, fast)
        tables_text, tables_raw = _extract_tables(filepath)
        if tables_text:
            markdown_text += f"\n\n---\n\n## Extracted Tables\n{tables_text}"

        # Caption images via Gemini Vision (currently disabled)
        image_descriptions, image_count = _extract_and_caption_images(filepath)
        if image_descriptions:
            markdown_text += "\n\n---\n\n## Figures\n" + "\n".join(image_descriptions)

    parsed_doc = ParsedDocument(
        source_type="pdf",
        filename=filename,
        markdown_text=markdown_text,
        page_count=scan["page_count"],
        has_images=scan["has_images"],
        has_tables=len(tables_raw) > 0 or scan["has_tables_hint"],
        has_equations=scan["has_equations"],
        is_slide_format=scan["is_slide"],
        complexity=scan["complexity"],
        image_descriptions=image_descriptions,
        tables_raw=tables_raw,
        metadata={
            "avg_words_per_page": scan["avg_words"],
            "image_count": image_count,
            "tables_extracted": len(tables_raw),
        },
    )

    logger.info(
        "PDF parsed [%s]: %d chars, %d tables, %d images captioned",
        filename, len(markdown_text), len(tables_raw), len(image_descriptions),
    )

    return {
        "text": markdown_text,
        "metadata": {
            "page_count": scan["page_count"],
            "complexity": scan["complexity"],
            "has_tables": parsed_doc.has_tables,
            "has_images": parsed_doc.has_images,
            "has_equations": parsed_doc.has_equations,
            "tables_extracted": len(tables_raw),
            "images_captioned": len(image_descriptions),
        },
        "parsed_doc": parsed_doc,
    }
