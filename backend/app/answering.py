"""VERO Answering Engine: Synthesizes search results into grounded answers."""

import re
import logging
from typing import List

from app.llm import get_llm
from app.schema import SearchResultItem, GroundedAnswer

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are VERO, a sharp and knowledgeable research assistant.

Your job is to answer the user's question using the sources provided below. Think of yourself as a helpful colleague who has read the documents and is explaining what they say in plain language.

How to answer:
- Write naturally, like you're explaining to a smart person. Avoid stiff, robotic language.
- Back up every key claim with a citation like [Source 1] or [Source 3]. Weave them into your sentences naturally.
- If the sources cover the topic well, give a thorough answer. Summarize, synthesize, and connect the dots across sources.
- If the sources don't cover the question at all, say something like "I don't have enough information in the provided documents to answer that." Don't guess or make things up.
- Keep it concise but complete. No filler, no disclaimers about being an AI.
"""


async def generate_answer(
    query: str,
    results: List[SearchResultItem],
) -> GroundedAnswer:
    """Generate a synthesized answer from search results."""
    
    if not results:
        return GroundedAnswer(
            answer="I don't have any relevant information in the provided documents to answer that question.",
            citations=[],
            found_sufficient_info=False
        )
        
    # Build context block
    context_lines = ["--- SOURCES ---"]
    for i, r in enumerate(results, 1):
        source_header = f"[Source {i}] {r.doc_title}"
        if r.source_url:
            source_header += f" ({r.source_url})"
        context_lines.append(f"{source_header}:\n{r.text}\n")
    
    context_block = "\n".join(context_lines)
    
    # User prompt
    user_prompt = f"Question: {query}\n\n{context_block}"
    
    try:
        llm = get_llm()
        raw_answer = await llm.generate_response(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=user_prompt
        )
        
        # Determine if sufficient info was found
        refusal_phrases = [
            "cannot answer", "do not know", "don't know",
            "don't have enough information", "not enough information",
            "no relevant information", "insufficient",
            "unable to answer", "not found in",
            "cannot find", "no information", "not contain",
            "don't have any relevant",
        ]
        sufficient = not any(p in raw_answer.lower() for p in refusal_phrases)
        
        # Only return citations that were actually referenced in the answer
        used_citations = []
        if sufficient:
            referenced = set(int(m) for m in re.findall(r'\[Source\s*(\d+)\]', raw_answer))
            for i, r in enumerate(results, 1):
                if i in referenced:
                    used_citations.append(r)
            # If the LLM didn't use [Source N] format but still answered, return all
            if not used_citations:
                used_citations = results
        
        return GroundedAnswer(
            answer=raw_answer.strip(),
            citations=used_citations,
            found_sufficient_info=sufficient
        )
        
    except Exception as e:
        logger.error(f"Failed to generate answer: {e}")
        return GroundedAnswer(
            answer=f"Error generating answer: {str(e)}",
            citations=[],
            found_sufficient_info=False
        )
