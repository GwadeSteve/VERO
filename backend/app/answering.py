"""VERO Answering Engine: One-shot grounded answer generation (no history).

Used by the /projects/{id}/answer endpoint in search.py.
For multi-turn chat, see routers/chat.py.
"""

import logging

from app.llm import get_llm
from app.prompts import get_oneshot_prompt
from app.postprocess import (
    build_source_context,
    extract_and_rewrite_citations,
    sanitize_answer,
)
from app.schema import GroundedAnswer, SearchResultItem

logger = logging.getLogger(__name__)


async def generate_answer(
    query: str,
    results: list[SearchResultItem],
    allow_model_knowledge: bool = False,
) -> GroundedAnswer:
    """Generate a synthesized answer from search results (one-shot, no history)."""

    if not results:
        return GroundedAnswer(
            answer="I don't have any relevant information in the provided documents to answer that question.",
            citations=[],
            found_sufficient_info=False,
        )

    # Build context and prompt
    context_block = build_source_context(results)
    system_prompt = get_oneshot_prompt(allow_model_knowledge=allow_model_knowledge)
    user_prompt = f"Question: {query}\n\n{context_block}"

    try:
        llm = get_llm()
        raw_answer = await llm.generate_response(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
        )

        # Clean and rewrite citations
        answer = sanitize_answer(raw_answer)
        answer, used_citations, sufficient = extract_and_rewrite_citations(answer, results)

        return GroundedAnswer(
            answer=answer,
            citations=used_citations,
            found_sufficient_info=sufficient,
        )

    except Exception as exc:
        logger.error("Failed to generate answer: %s", exc)
        return GroundedAnswer(
            answer=f"Error generating answer: {exc}",
            citations=[],
            found_sufficient_info=False,
        )
