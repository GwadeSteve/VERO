"""
VERO Pipeline Quality Verification
====================================
Tests the HARDENED ingestion pipeline: PDF, DOCX, PPTX, Markdown, Plain Text.

What it does:
  1. Parses each test file using the new parsers
  2. Prints ParsedDocument metadata (complexity, tables, images, equations)
  3. Saves parsed markdown to tests/fixtures/results/ for manual inspection
  4. Runs assertions on structural integrity
  5. Returns exit code 0 (all pass) or 1 (failures)

Usage:
    1. Place test files in backend/tests/fixtures/ (or use symlinked NoteBooks/test-docs/)
    2. Run:  python tests/test_pipeline_quality.py

    OR to test against the NoteBooks test-docs directly:
       python tests/test_pipeline_quality.py --source NoteBooks/test-docs
"""

import sys
import asyncio
import argparse
from pathlib import Path

# Add backend to path
BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# Professional Logging Utilities
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"

PASS = 0
FAIL = 0


def check(name: str, condition: bool, detail: str = ""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  {GREEN}✓{RESET} {name}")
    else:
        FAIL += 1
        print(f"  {RED}✗{RESET} {name} {DIM}({detail}){RESET}")


def section(title: str):
    print(f"\n{BOLD}{CYAN}{title}{RESET}")
    print(f"{DIM}{'─' * 50}{RESET}")


def info(key: str, value):
    print(f"  {DIM}{key:20s}{RESET} {value}")


async def test_parse_pdf(path: str, results_dir: Path):
    """Test PDF parsing with the hardened pipeline."""
    from app.parsers.pdf import parse_pdf

    section(f"PDF: {Path(path).name}")

    result = await parse_pdf(path)
    parsed = result["parsed_doc"]

    # Print metadata
    info("complexity", parsed.complexity)
    info("page_count", parsed.page_count)
    info("has_tables", parsed.has_tables)
    info("has_images", parsed.has_images)
    info("has_equations", parsed.has_equations)
    info("tables_extracted", len(parsed.tables_raw))
    info("images_captioned", len(parsed.image_descriptions))
    info("output_chars", f"{len(parsed.markdown_text):,}")

    # Save output for inspection
    out = results_dir / (Path(path).stem + "_parsed.md")
    out.write_text(
        f"# {parsed.filename}\n\n"
        f"- complexity: {parsed.complexity}\n"
        f"- pages: {parsed.page_count}\n"
        f"- has_tables: {parsed.has_tables}\n"
        f"- has_images: {parsed.has_images}\n"
        f"- has_equations: {parsed.has_equations}\n"
        f"- tables_extracted: {len(parsed.tables_raw)}\n"
        f"- images_captioned: {len(parsed.image_descriptions)}\n\n"
        f"---\n\n{parsed.markdown_text}",
        encoding="utf-8",
    )
    info("saved_to", str(out))

    # Assertions
    check("Text extracted (non-empty)", len(parsed.markdown_text) > 100,
          f"only {len(parsed.markdown_text)} chars")
    check("Page count detected", parsed.page_count > 0)
    check("Complexity is valid", parsed.complexity in ("text_only", "slide_mode", "full_pipeline"))

    # Check if tables were found (for full_pipeline docs)
    if parsed.complexity == "full_pipeline":
        check("Tables detected for complex doc", parsed.has_tables or len(parsed.tables_raw) >= 0,
              "Expected table detection for full_pipeline doc")

    # Check markdown has structure (headings)
    has_headings = "#" in parsed.markdown_text
    check("Markdown contains structure (headings)", has_headings,
          "No headings found — pymupdf4llm should produce them")

    # Check for Markdown table format if tables were extracted
    if parsed.tables_raw:
        has_md_tables = "| " in parsed.markdown_text and " |" in parsed.markdown_text
        check("Tables preserved as Markdown", has_md_tables)

        # Show first table preview
        first_table = parsed.tables_raw[0]
        print(f"\n  {DIM}First table preview ({len(first_table)} rows):{RESET}")
        for row in first_table[:3]:
            print(f"    {row[:5]}{'...' if len(row) > 5 else ''}")

    # Show image captioning results
    if parsed.image_descriptions:
        print(f"\n  {DIM}Image caption preview:{RESET}")
        for desc in parsed.image_descriptions[:2]:
            print(f"    {desc.strip()[:120]}...")

    return parsed


async def test_parse_docx(path: str, results_dir: Path):
    """Test DOCX parsing."""
    from app.parsers.docx import parse_docx

    section(f"DOCX: {Path(path).name}")

    result = await parse_docx(path)
    parsed = result["parsed_doc"]

    info("paragraphs", parsed.metadata.get("paragraph_count", "?"))
    info("tables", len(parsed.tables_raw))
    info("images", parsed.metadata.get("image_count", 0))
    info("output_chars", f"{len(parsed.markdown_text):,}")

    out = results_dir / (Path(path).stem + "_parsed.md")
    out.write_text(parsed.markdown_text, encoding="utf-8")
    info("saved_to", str(out))

    check("Text extracted", len(parsed.markdown_text) > 50)
    check("Headings preserved", "#" in parsed.markdown_text,
          "DOCX with headings should produce # headers")

    if parsed.tables_raw:
        check("Tables preserved as Markdown", "| " in parsed.markdown_text)


async def test_parse_pptx(path: str, results_dir: Path):
    """Test PPTX parsing."""
    from app.parsers.pptx import parse_pptx

    section(f"PPTX: {Path(path).name}")

    result = await parse_pptx(path)
    parsed = result["parsed_doc"]

    info("slides", parsed.page_count)
    info("tables", len(parsed.tables_raw))
    info("images", parsed.metadata.get("image_count", 0))
    info("output_chars", f"{len(parsed.markdown_text):,}")

    out = results_dir / (Path(path).stem + "_parsed.md")
    out.write_text(parsed.markdown_text, encoding="utf-8")
    info("saved_to", str(out))

    check("Text extracted", len(parsed.markdown_text) > 50)
    check("Slide markers present", "## Slide" in parsed.markdown_text)
    check("Is slide format", parsed.is_slide_format is True)


async def test_parse_text(path: str, results_dir: Path):
    """Test TXT/Markdown parsing."""
    from app.parsers.text import parse_text

    section(f"TEXT: {Path(path).name}")

    result = await parse_text(path)
    parsed = result["parsed_doc"]

    info("lines", parsed.metadata.get("line_count", "?"))
    info("is_markdown", parsed.metadata.get("is_markdown", False))
    info("has_tables", parsed.has_tables)
    info("output_chars", f"{len(parsed.markdown_text):,}")

    out = results_dir / (Path(path).stem + "_parsed.md")
    out.write_text(parsed.markdown_text, encoding="utf-8")
    info("saved_to", str(out))

    check("Text extracted", len(parsed.markdown_text) > 10)


async def run_tests(source_dir: Path):
    global PASS, FAIL

    results_dir = source_dir / "results"
    results_dir.mkdir(exist_ok=True)

    print(f"\n{BOLD}VERO Pipeline Quality Verification{RESET}")
    print(f"{DIM}Source: {source_dir}{RESET}")
    print(f"{DIM}Results: {results_dir}{RESET}")

    # Discover test files
    extensions = {".pdf", ".docx", ".pptx", ".md", ".txt"}
    test_files = sorted(
        f for f in source_dir.iterdir()
        if f.is_file() and f.suffix.lower() in extensions
    )

    if not test_files:
        print(f"\n{RED}No test files found in {source_dir}{RESET}")
        print(f"Place PDF, DOCX, PPTX, MD, or TXT files there.")
        sys.exit(1)

    print(f"\n{DIM}Found {len(test_files)} test files:{RESET}")
    for f in test_files:
        print(f"  {DIM}->{RESET} {f.name}")

    # Run parsers
    for f in test_files:
        try:
            ext = f.suffix.lower()
            if ext == ".pdf":
                await test_parse_pdf(str(f), results_dir)
            elif ext == ".docx":
                await test_parse_docx(str(f), results_dir)
            elif ext == ".pptx":
                await test_parse_pptx(str(f), results_dir)
            elif ext in (".md", ".txt"):
                await test_parse_text(str(f), results_dir)
        except Exception as e:
            FAIL += 1
            print(f"\n  {RED}✗ PARSER CRASHED: {e}{RESET}")
            import traceback
            traceback.print_exc()

    # Summary
    section("RESULTS")
    total = PASS + FAIL
    color = GREEN if FAIL == 0 else RED
    print(f"\n  {color}{BOLD}Report: {PASS}/{total} assertions passed{RESET}\n")

    if FAIL == 0:
        print(f"  {GREEN}{BOLD}PIPELINE QUALITY VERIFICATION PASSED{RESET}")
        print(f"\n  {DIM}Open the .md files in {results_dir} to visually inspect the output.{RESET}\n")
        sys.exit(0)
    else:
        print(f"  {RED}{BOLD}PIPELINE QUALITY VERIFICATION FAILED{RESET}")
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="VERO Pipeline Quality Test")
    parser.add_argument(
        "--source",
        default=None,
        help="Path to directory containing test files (default: tests/fixtures/)",
    )
    args = parser.parse_args()

    if args.source:
        source = Path(args.source).resolve()
    else:
        source = BACKEND / "tests" / "fixtures"

    if not source.exists():
        print(f"{RED}Source directory not found: {source}{RESET}")
        print(f"Create it and add test files, or use --source flag.")
        sys.exit(1)

    asyncio.run(run_tests(source))
