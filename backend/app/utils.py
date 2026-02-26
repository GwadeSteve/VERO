"""
VERO — Text Utilities
---------------------
Normalization and hashing for deterministic ingestion.
"""

import hashlib
import re


def normalize_text(text: str) -> str:
    """
    Normalize text for consistent hashing.
    - Strip leading/trailing whitespace
    - Collapse multiple whitespace into single spaces
    - Normalize line endings
    """
    text = text.strip()
    text = re.sub(r"\r\n", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def compute_content_hash(text: str) -> str:
    """
    Compute SHA-256 hash of normalized text.
    This is the deduplication key.
    """
    normalized = normalize_text(text)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
