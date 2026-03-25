"""VERO Query Rewriter: Heuristic query expansion from conversation history.

Improves retrieval for conversational follow-up queries like
"What about the hardware??" by injecting context from previous turns.

This is a ZERO-LLM-CALL module — purely heuristic, fast, and free.
"""

from __future__ import annotations

import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Words that carry no semantic meaning for retrieval
_STOP_WORDS = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "must",
    "i", "me", "my", "we", "our", "you", "your", "he", "she", "it",
    "they", "them", "their", "this", "that", "these", "those",
    "what", "which", "who", "whom", "where", "when", "why", "how",
    "and", "or", "but", "if", "then", "so", "not", "no", "nor",
    "in", "on", "at", "to", "for", "of", "with", "by", "from",
    "about", "also", "tell", "please", "ok", "okay", "thanks",
    "thank", "yes", "yeah", "sure", "know", "think", "like",
    "just", "really", "very", "too", "more", "most", "some",
    "any", "all", "each", "every", "only", "own", "same",
    "than", "other", "such", "into", "over", "after", "before",
    "between", "under", "above", "up", "down", "out",
})


def _extract_key_terms(text: str, max_terms: int = 8) -> list[str]:
    """Extract the most meaningful words from text, skipping stop words."""
    words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
    seen = set()
    key_terms = []
    for w in words:
        if w not in _STOP_WORDS and w not in seen:
            seen.add(w)
            key_terms.append(w)
            if len(key_terms) >= max_terms:
                break
    return key_terms


def _is_vague_query(query: str) -> bool:
    """Detect if a query is too vague to retrieve well on its own.

    Vague queries are short, start with pronouns/references, or are
    conversational follow-ups that lack standalone meaning.
    """
    q = query.strip().lower()

    # Very short queries (< 5 meaningful words) are likely follow-ups
    meaningful = [w for w in re.findall(r'\b[a-zA-Z]{3,}\b', q) if w not in _STOP_WORDS]
    if len(meaningful) <= 2:
        return True

    # Starts with a referential pattern
    referential_starts = [
        "what about", "how about", "tell me more", "and the",
        "what were", "what was", "what is", "what are",
        "can you also", "also", "same for", "and what",
        "regarding", "concerning", "elaborate",
    ]
    for pat in referential_starts:
        if q.startswith(pat):
            return True

    return False


def rewrite_query(
    query: str,
    history: Optional[list[dict]] = None,
    max_history_turns: int = 2,
) -> str:
    """Expand a vague query using conversation history context.

    If the query looks self-contained, it's returned as-is.
    If it's a vague follow-up, key terms from recent history are prepended.

    Args:
        query: The user's raw query.
        history: List of message dicts with 'role' and 'content' keys.
                 Should be in chronological order (oldest first).
        max_history_turns: How many recent turns to pull context from.

    Returns:
        The original or expanded query string.

    Example:
        history = [
            {"role": "user", "content": "What was the training setup?"},
            {"role": "assistant", "content": "The model was trained using AdamW..."},
        ]
        rewrite_query("What about the hardware??", history)
        → "training setup model trained hardware"
    """
    if not history or not _is_vague_query(query):
        return query

    # Pull context from the last N turns (both user and assistant messages)
    recent = history[-(max_history_turns * 2):]

    # Extract key terms from recent history
    history_text = " ".join(msg["content"] for msg in recent if msg.get("content"))
    history_terms = _extract_key_terms(history_text, max_terms=6)

    # Extract the query's own terms
    query_terms = _extract_key_terms(query, max_terms=6)

    if not history_terms:
        return query

    # Combine: history context + original query terms
    # Deduplicate while preserving order
    combined = []
    seen = set()
    for term in history_terms + query_terms:
        if term not in seen:
            seen.add(term)
            combined.append(term)

    expanded = " ".join(combined)
    logger.info(
        "Query rewritten: '%s' → '%s' (injected %d terms from history)",
        query[:60], expanded[:80], len(history_terms),
    )
    return expanded
