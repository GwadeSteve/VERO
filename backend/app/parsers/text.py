"""
VERO Parser — Text / Markdown
------------------------------
Reads plain text and markdown files as-is.
"""


async def parse_text(filepath: str) -> dict:
    """Read a text or markdown file as raw UTF-8."""
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    return {
        "text": content,
        "metadata": {
            "char_count": len(content),
            "line_count": content.count("\n") + 1,
        },
    }
