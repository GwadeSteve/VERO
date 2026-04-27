"""VERO Post-Processing: Shared answer sanitization and citation rewriting.

Eliminates duplication between answering.py and chat.py by providing
a single, reusable pipeline for cleaning LLM output.
"""

from __future__ import annotations

import re

from app.schema import SearchResultItem

_LEAK_PATTERNS = [
    re.compile(r'<\|.*?\|>', re.IGNORECASE),                    # <|end_header_id|> etc.
    re.compile(r'^assistant\s*:', re.IGNORECASE | re.MULTILINE),
    re.compile(r'\[INST\].*?\[/INST\]', re.IGNORECASE | re.DOTALL),
    re.compile(r'CONVERSATION HISTORY', re.IGNORECASE),
    re.compile(r'---\s*CONVERSATION HISTORY\s*---', re.IGNORECASE),
    re.compile(r'---\s*SOURCES\s*---', re.IGNORECASE),
    re.compile(r'^\[User\]\s*$', re.IGNORECASE | re.MULTILINE),
    re.compile(r'^\[VERO\]\s*$', re.IGNORECASE | re.MULTILINE),
    re.compile(r'^\[User\]\s', re.IGNORECASE | re.MULTILINE),
    re.compile(r'^\[VERO\]\s', re.IGNORECASE | re.MULTILINE),
    re.compile(r'^Question:\s', re.IGNORECASE | re.MULTILINE),
    re.compile(r'Please answer this question with proper Markdown.*', re.IGNORECASE | re.DOTALL),
    re.compile(r'^\[Source \d+\]\s+[\w/]+\.\w+:.*$', re.MULTILINE),  # Source header lines
]

# Phrases that indicate the LLM refused to answer
REFUSAL_PHRASES = [
    "cannot answer", "do not know", "don't know",
    "don't have enough information", "not enough information",
    "no relevant information", "insufficient",
    "unable to answer", "not found in",
    "cannot find", "no information", "not contain",
    "don't have any relevant",
]


def sanitize_answer(text: str) -> str:
    """Strip leaked prompt artifacts and remove duplicate paragraphs from model output."""
    # Step 1: Remove leaked prompt patterns
    for pattern in _LEAK_PATTERNS:
        text = pattern.sub('', text)

    # Step 2: Remove near-duplicate paragraphs (fixes repeated sections)
    paragraphs = text.split('\n\n')
    seen_paragraphs: list[set] = []
    unique_paragraphs = []
    for para in paragraphs:
        stripped = para.strip()
        if not stripped:
            continue
        # Skip very short paragraphs (headers, single lines) — dedup only content blocks
        if len(stripped) < 80:
            unique_paragraphs.append(para)
            continue
        para_words = set(re.findall(r'\w+', stripped.lower()))
        is_dup = False
        for seen_words in seen_paragraphs:
            if not para_words or not seen_words:
                continue
            overlap = len(para_words & seen_words) / min(len(para_words), len(seen_words))
            if overlap > 0.80:
                is_dup = True
                break
        if not is_dup:
            seen_paragraphs.append(para_words)
            unique_paragraphs.append(para)
    text = '\n\n'.join(unique_paragraphs)

    # Step 3: Collapse excessive blank lines
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def extract_and_rewrite_citations(
    answer: str,
    search_results: list[SearchResultItem],
) -> tuple[str, list[SearchResultItem], bool]:
    """Extract cited sources, rewrite to dense indices, and determine sufficiency.

    Returns:
        (rewritten_answer, used_citations, found_sufficient_info)
    """
    # 1. Check for refusal
    sufficient = not any(p in answer.lower() for p in REFUSAL_PHRASES)

    # 2. Extract used citations and rewrite with dense indices
    used_citations: list[SearchResultItem] = []

    if search_results:
        # Find all unique source numbers the LLM actually cited
        referenced = sorted(list(set(
            int(m) for m in re.findall(r'\[(?:Source\s*)?(\d+)\]', answer, re.IGNORECASE)
        )))

        # Build mapping: Original Index → New Dense Index (1-based)
        idx_mapping: dict[int, int] = {}
        for original_idx in referenced:
            if 1 <= original_idx <= len(search_results):
                used_citations.append(search_results[original_idx - 1])
                idx_mapping[original_idx] = len(used_citations)

        # Rewrite citations to dense indices
        def replace_cite(match):
            old_idx = int(match.group(1))
            new_idx = idx_mapping.get(old_idx)
            if new_idx:
                return f"[Source {new_idx}]"
            return match.group(0)

        if idx_mapping:
            answer = re.sub(
                r'\[(?:Source\s*)?(\d+)\]', replace_cite,
                answer, flags=re.IGNORECASE,
            )

    # 3. Override: if LLM cited a source, it found info (even if it used refusal language)
    if used_citations:
        sufficient = True

    # 4. Fallback: if no citations but no refusal, return all as citations
    if sufficient and not used_citations and search_results:
        used_citations = list(search_results)

    return answer, used_citations, sufficient


def build_source_context(
    search_results: list[SearchResultItem],
) -> str:
    """Build the source context block for LLM injection."""
    context_lines = ["--- SOURCES ---"]
    for i, r in enumerate(search_results, 1):
        source_header = f"[Source {i}] {r.doc_title}"
        if r.source_url:
            source_header += f" ({r.source_url})"
        context_lines.append(f"{source_header}:\n{r.text}\n")
    return "\n".join(context_lines)
