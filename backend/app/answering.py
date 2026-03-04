"""VERO Answering Engine: Synthesizes search results into grounded answers."""

import logging
from typing import List

from app.llm import get_llm
from app.schema import SearchResultItem, GroundedAnswer

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are VERO, an elite research assistant.
Your task is to answer the user's query STRICTLY based on the provided context.

RULES:
1. Grounding: You must ONLY use the information presented in the Context block. Do not use outside knowledge.
2. Citations: Every single factual claim must be followed by a citation in the format [Source N]. 
3. Sufficiency: If the context does not contain the answer, you MUST state "I cannot answer this based on the provided context" and nothing else.
4. Tone: Professional, objective, and concise.
"""


async def generate_answer(
    query: str,
    results: List[SearchResultItem],
) -> GroundedAnswer:
    """Generate a synthesized answer from search results."""
    
    if not results:
        return GroundedAnswer(
            answer="I cannot answer this based on the provided context (no context found).",
            citations=[],
            found_sufficient_info=False
        )
        
    # Build context block
    context_lines = ["--- CONTEXT ---"]
    for i, r in enumerate(results, 1):
        # We only pass title, url, and text to the LLM to keep token usage clean
        source_header = f"[Source {i}] {r.doc_title}"
        if r.source_url:
            source_header += f" ({r.source_url})"
        context_lines.append(f"{source_header}:\n{r.text}\n")
    
    context_block = "\n".join(context_lines)
    
    # User prompt
    user_prompt = f"USER QUERY: {query}\n\n{context_block}"
    
    try:
        llm = get_llm()
        raw_answer = await llm.generate_response(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=user_prompt
        )
        
        # Determine if sufficient info was found
        refusal_phrases = ["cannot answer this based on the provided context", "do not know"]
        sufficient = not any(p in raw_answer.lower() for p in refusal_phrases)
        
        # Citations are just the results passed in
        # (Could be optimized later to only return citations actually used in the text)
        
        return GroundedAnswer(
            answer=raw_answer.strip(),
            citations=results,
            found_sufficient_info=sufficient
        )
        
    except Exception as e:
        logger.error(f"Failed to generate answer: {e}")
        return GroundedAnswer(
            answer=f"Error generating answer: {str(e)}",
            citations=[],
            found_sufficient_info=False
        )
