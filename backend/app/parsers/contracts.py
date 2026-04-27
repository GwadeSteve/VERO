"""VERO Parser Contracts: Shared data structures and helpers for all parsers."""

from dataclasses import dataclass, field


@dataclass
class ParsedDocument:
    """Standardized output from all VERO parsers.

    Every parser (PDF, DOCX, PPTX, Web, TXT, MD) returns this contract.
    The pipeline reads `markdown_text` as the canonical text to chunk + embed.
    """

    source_type: str
    filename: str
    markdown_text: str          # The final text stored in DB (markdown-formatted)
    page_count: int
    has_images: bool
    has_tables: bool
    has_equations: bool
    is_slide_format: bool
    complexity: str             # text_only | slide_mode | full_pipeline
    image_descriptions: list = field(default_factory=list)   # Vision-captioned descriptions
    tables_raw: list = field(default_factory=list)           # Raw table data for verification
    metadata: dict = field(default_factory=dict)             # Extra metadata (url, title, etc.)


# Shared helpers.

MATH_SYMBOLS = set("∫∑∏√∂∇∆λμσπαβγδεζηθ²³°±×÷≤≥≠∈⊂∞")


def table_to_markdown(table: list[list]) -> str:
    """Convert a 2D list of cells into a Markdown table string.

    First row is treated as the header. Handles None cells gracefully.
    """
    if not table or not table[0]:
        return ""

    def clean(cell):
        return str(cell).strip().replace("\n", " ") if cell is not None else ""

    header = "| " + " | ".join(clean(c) for c in table[0]) + " |"
    separator = "| " + " | ".join("---" for _ in table[0]) + " |"
    rows = ["| " + " | ".join(clean(c) for c in row) + " |" for row in table[1:]]
    return "\n".join([header, separator] + rows)


def has_math_symbols(text: str) -> bool:
    """Check if text contains mathematical Unicode symbols (detection only, no wrapping)."""
    return any(sym in text for sym in MATH_SYMBOLS)
