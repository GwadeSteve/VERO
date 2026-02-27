"""VERO Parser — Web URL: Fetches a URL and extracts clean article text using BeautifulSoup."""

import httpx
from bs4 import BeautifulSoup


async def parse_web(url: str) -> dict:
    """Fetch a URL and extract the main text content."""
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        response = await client.get(url)
        response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    # Remove script, style, nav, footer, header elements
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form"]):
        tag.decompose()

    # Try to find the main content area first
    main = soup.find("main") or soup.find("article") or soup.find("body")
    if main is None:
        main = soup

    # Extract text from paragraphs and headings
    text_parts = []
    for element in main.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "pre", "code"]):
        text = element.get_text(strip=True)
        if text:
            text_parts.append(text)

    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else url

    return {
        "text": "\n\n".join(text_parts),
        "metadata": {
            "url": url,
            "title": title,
            "paragraph_count": len(text_parts),
        },
    }
