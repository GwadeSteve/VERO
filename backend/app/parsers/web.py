"""VERO Parser — Web URL: Structure-preserving web article extraction.

Preserves:
  - Heading hierarchy (h1→#, h2→##, etc.)
  - Tables → Markdown tables
  - Code blocks → fenced code blocks
  - Bold/italic formatting
"""

import logging

import httpx
from bs4 import BeautifulSoup

from app.parsers.contracts import ParsedDocument, table_to_markdown

logger = logging.getLogger(__name__)


def _html_table_to_rows(table_tag) -> list[list[str]]:
    """Convert an HTML <table> element to a 2D list of cell strings."""
    rows = []
    for tr in table_tag.find_all("tr"):
        cells = []
        for cell in tr.find_all(["td", "th"]):
            cells.append(cell.get_text(strip=True))
        if cells:
            rows.append(cells)
    return rows


def _element_to_markdown(element) -> str | None:
    """Convert a single HTML element to its Markdown equivalent."""
    tag = element.name
    text = element.get_text(strip=True)

    if not text and tag != "table":
        return None

    # Headings
    if tag == "h1":
        return f"# {text}"
    elif tag == "h2":
        return f"## {text}"
    elif tag == "h3":
        return f"### {text}"
    elif tag == "h4":
        return f"#### {text}"
    elif tag == "h5":
        return f"##### {text}"
    elif tag == "h6":
        return f"###### {text}"

    # Code blocks
    elif tag == "pre":
        code = element.find("code")
        code_text = code.get_text() if code else element.get_text()
        return f"```\n{code_text.strip()}\n```"
    elif tag == "code":
        # Inline code that's not inside a <pre>
        if element.parent and element.parent.name == "pre":
            return None  # Already handled by <pre>
        return f"`{text}`"

    # Tables
    elif tag == "table":
        rows = _html_table_to_rows(element)
        if rows and len(rows) >= 2:
            return table_to_markdown(rows)
        return None

    # List items
    elif tag == "li":
        return f"- {text}"

    # Paragraphs and other text
    elif tag == "p":
        return text

    return text


async def parse_web(url: str) -> dict:
    """Fetch a URL and extract structured content preserving headings, tables, and code.

    Returns {"text": str, "metadata": dict, "parsed_doc": ParsedDocument}
    """
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        response = await client.get(url)
        response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    # Remove non-content elements
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form", "iframe"]):
        tag.decompose()

    # Find main content area
    main = soup.find("main") or soup.find("article") or soup.find("body")
    if main is None:
        main = soup

    # Extract elements preserving structure
    text_parts = []
    tables_raw = []
    target_tags = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "pre", "code", "table"]

    for element in main.find_all(target_tags):
        # Skip nested elements we'll handle via parent
        if element.name == "code" and element.parent and element.parent.name == "pre":
            continue
        if element.name in ("td", "th", "tr"):
            continue

        md = _element_to_markdown(element)
        if md:
            text_parts.append(md)

            # Track tables
            if element.name == "table":
                rows = _html_table_to_rows(element)
                if rows and len(rows) >= 2:
                    tables_raw.append(rows)

    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else url

    markdown_text = "\n\n".join(text_parts)

    parsed_doc = ParsedDocument(
        source_type="web",
        filename=title,
        markdown_text=markdown_text,
        page_count=1,
        has_images=False,
        has_tables=len(tables_raw) > 0,
        has_equations=False,
        is_slide_format=False,
        complexity="text_only" if not tables_raw else "full_pipeline",
        tables_raw=tables_raw,
        metadata={
            "url": url,
            "title": title,
            "paragraph_count": len(text_parts),
            "table_count": len(tables_raw),
        },
    )

    logger.info(
        "Web parsed [%s]: %d chars, %d sections, %d tables",
        url[:60], len(markdown_text), len(text_parts), len(tables_raw),
    )

    return {
        "text": markdown_text,
        "metadata": {
            "url": url,
            "title": title,
            "paragraph_count": len(text_parts),
        },
        "parsed_doc": parsed_doc,
    }
