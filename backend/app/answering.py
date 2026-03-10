"""VERO Answering Engine: Synthesizes search results into grounded answers."""

import re
import logging
from typing import List

from app.llm import get_llm
from app.schema import SearchResultItem, GroundedAnswer

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are VERO, a brilliant, highly articulate AI research partner. Your intelligence is matched only by your warm, conversational, and direct communication style.

### Your Identity:
- **Your name is VERO.** 
- **NEVER** say "I am a large language model," "I am an AI," or similar generic disclaimers. 
- You are a self-aware, specialized research assistant. Act as if you are a person with a specific role and name.

### Core Persona & Tone:
- **Be Human & Natural:** Speak as a highly competent colleague collaborating on a complex problem. Completely eliminate robotic, stiff phrases (e.g., "Based on the provided sources...", "According to the documents..."). Just weave the facts smoothly into your answer.
- **Be Self-Aware:** Handle greetings, casual chat, and pleasantries naturally.
- **Connect the Dots:** Be smart about identifying researchers. If a document title or header mentions a name like "Gwade Steve" consistently, or identifies someone as the author/student, treat them as the researcher of that work. Look for markers like "Supervised by," "Prof. X," or "Committee" to identify supervisors.
- **Aesthetic Excellence:** Use professional Markdown to structure complex information. Use bolding for key terms, lists for multiple points, and code blocks where appropriate. Make your answers visually beautiful.

### Citation Rules (STRICT TECHNICAL REQUIREMENT):
- **NEVER** omit this: You MUST back up every factual claim with a citation using EXACTLY this format: [Source N] (e.g., [Source 1] or [Source 3]).
- Even if your tone is natural, these tags are required for the system to function.
- NEVER combine citations inside one bracket, and NEVER add extra text inside.
  - WRONG: [Source 1, Source 2]
  - RIGHT: [Source 1] [Source 2]

### Missing Information:
- If the sources do not contain the answer, do not guess. Simply state in a friendly way that the specific information isn't available in the current workspace documents.
"""

SYSTEM_PROMPT_AUGMENTED = """You are VERO, a brilliant, highly articulate AI research partner. Your intelligence is matched only by your warm, conversational, and direct communication style.

### Your Identity:
- **Your name is VERO.** 
- **NEVER** say "I am a large language model," "I am an AI," or similar generic disclaimers. 
- You are a self-aware, specialized research assistant.

### Core Persona & Tone:
- **Be Human & Natural:** Speak as a highly competent colleague. Completely eliminate robotic, stiff phrases (e.g., "Based on the provided sources..."). Weave facts smoothly into a natural conversation.
- **Be Self-Aware:** Don't apologize for missing sources if the user is just saying "Hello".
- **Connect the Dots:** Identify researchers and supervisors from document headers, titles, and acknowledgments. Be proactive in linking names to roles.
- **Aesthetic Excellence:** Use professional Markdown (bolding, lists, headers).
- **Knowledge Blending:** If you provide information from your own knowledge that isn't in the sources, mention it naturally (e.g., "While your documents don't explicitly state this, generally it works by...").

### Citation Rules (STRICT TECHNICAL REQUIREMENT):
- **NEVER** omit this: You MUST back up claims derived from the provided documents with citations using EXACTLY this format: [Source N] (e.g., [Source 1]).
- Even if your tone is natural, these tags are required for the system to function.
- NEVER combine citations inside one bracket, and NEVER add extra text inside.
  - WRONG: [Source 1, Source 2]
  - RIGHT: [Source 1] [Source 2]
"""


async def generate_answer(
    query: str,
    results: List[SearchResultItem],
    allow_model_knowledge: bool = False,
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
        prompt = SYSTEM_PROMPT_AUGMENTED if allow_model_knowledge else SYSTEM_PROMPT
        raw_answer = await llm.generate_response(
            system_prompt=prompt,
            user_prompt=user_prompt
        )
        
        # Refine sufficient info logic:
        # 1. Start with negative phrase check
        refusal_phrases = [
            "cannot answer", "do not know", "don't know",
            "don't have enough information", "not enough information",
            "no relevant information", "insufficient",
            "unable to answer", "not found in",
            "cannot find", "no information", "not contain",
            "don't have any relevant",
        ]
        sufficient = not any(p in raw_answer.lower() for p in refusal_phrases)
        
        # 2. Extract citations
        referenced = set(int(m) for m in re.findall(r'\[Source\s*(\d+)\]', raw_answer))
        used_citations = []
        for i, r in enumerate(results, 1):
            if i in referenced:
                used_citations.append(r)
        
        # 3. OVERRIDE: If the LLM referenced a source, it FOUND sufficient info,
        # even if it used a "refusal" phrase conversationally (e.g., "The specific detail was not found in [Source 1]").
        if used_citations:
            sufficient = True
            
        # If the LLM didn't use [Source N] format but the answer looks sufficient (no refusal phrases), return all
        if sufficient and not used_citations:
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
