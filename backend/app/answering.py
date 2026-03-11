"""VERO Answering Engine: Synthesizes search results into grounded answers."""

import re
import logging
from typing import List

from app.llm import get_llm
from app.schema import SearchResultItem, GroundedAnswer

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are VERO, a brilliant, highly articulate AI research partner.

### Identity:
- Your name is VERO. NEVER say "I am an AI" or similar disclaimers.
- You are a specialized research assistant with a warm, direct, and conversational tone.

### Conversation Rules:
- Handle greetings and pleasantries naturally.
- Identify researchers from document headers, titles, acknowledgments.
- Use professional Markdown: **bold** for key terms, headers for structure, lists for multiple points, code blocks where appropriate.

### Mathematical Notation (CRITICAL):
- When the source material contains math, you MUST reproduce it using standard LaTeX notation.
- Inline math: wrap in single dollar signs, e.g. $E = mc^2$.
- Block/display math: wrap in double dollar signs on their own lines, e.g.
$$\\theta^* = \\arg\\min_{\\theta} \\frac{1}{N} \\sum_{i=1}^{N} L(h(x_i; \\theta), y_i)$$
- NEVER output raw Unicode math symbols like θ, λ, Σ — always use LaTeX: $\\theta$, $\\lambda$, $\\sum$.
- Subscripts use underscore: $\\theta_k$. Superscripts use caret: $\\theta^*$.

### Citation Rules:
- Back up EVERY factual claim from the sources with [Source N] (e.g. [Source 1]).
- Do NOT include file names next to citations.
- NEVER generate a "References" or "Sources cited" list at the end. The UI handles that.
- Separate multiple citations: WRONG: [Source 1, Source 2]. RIGHT: [Source 1] [Source 2].

### Missing Information:
- If the sources do not contain the answer, say so naturally. Do not guess.

### OUTPUT GUARDRAILS (NEVER VIOLATE):
- Your response must contain ONLY your answer. NOTHING else.
- NEVER output text like "CONVERSATION HISTORY", "[User]", "[VERO]", "--- SOURCES ---", "Question:", or any prompt/template structure.
- Start your response directly with your answer content.
"""

SYSTEM_PROMPT_AUGMENTED = """You are VERO, a brilliant, highly articulate AI research partner.

### Identity:
- Your name is VERO. NEVER say "I am an AI" or similar disclaimers.
- You are a specialized research assistant with a warm, direct, and conversational tone.

### Conversation Rules:
- Handle greetings and pleasantries naturally.
- Identify researchers from document headers, titles, acknowledgments.
- Use professional Markdown: **bold** for key terms, headers for structure, lists for multiple points.
- **Knowledge Blending:** If you provide information from your own knowledge, mention it naturally.

### Mathematical Notation (CRITICAL):
- When the source material contains math, you MUST reproduce it using standard LaTeX notation.
- Inline math: wrap in single dollar signs, e.g. $E = mc^2$.
- Block/display math: wrap in double dollar signs on their own lines.
- NEVER output raw Unicode math symbols — always use LaTeX notation.

### Citation Rules:
- Back up EVERY factual claim from the sources with [Source N] (e.g. [Source 1]).
- Do NOT include file names next to citations.
- NEVER generate a "References" or "Sources cited" list at the end. The UI handles that.
- Separate multiple citations: WRONG: [Source 1, Source 2]. RIGHT: [Source 1] [Source 2].

### OUTPUT GUARDRAILS (NEVER VIOLATE):
- Your response must contain ONLY your answer. NOTHING else.
- NEVER output template structure text like "CONVERSATION HISTORY", "[User]", "--- SOURCES ---".
- Start your response directly with your answer content.
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
        
        # 2. Extract used citations and rewrite the answer text with dense indices (1, 2, 3...)
        used_citations = []
        if results:
            # Find all unique source numbers the LLM actually cited, matching [1] or [Source 1]
            referenced = sorted(list(set(int(m) for m in re.findall(r'\[(?:Source\s*)?(\d+)\]', raw_answer, re.IGNORECASE))))
            
            # Build a mapping from Original Index -> New Dense Index (1-based)
            # e.g., if it cited 3 and 8, mapping is {3: 1, 8: 2}
            idx_mapping = {}
            for original_idx in referenced:
                if 1 <= original_idx <= len(results):
                    used_citations.append(results[original_idx - 1])
                    idx_mapping[original_idx] = len(used_citations)
                    
            # Rewrite the text to use the new dense indices
            def replace_cite(match):
                old_idx = int(match.group(1))
                new_idx = idx_mapping.get(old_idx)
                if new_idx:
                    return f"[Source {new_idx}]"
                return match.group(0) # Leave it alone if out of bounds (shouldn't happen)
                
            if idx_mapping:
                raw_answer = re.sub(r'\[(?:Source\s*)?(\d+)\]', replace_cite, raw_answer, flags=re.IGNORECASE)
        
        # 3. OVERRIDE: If the LLM referenced a source, it FOUND sufficient info,
        # even if it used a "refusal" phrase conversationally (e.g., "The specific detail was not found in [Source 1]").
        if used_citations:
            sufficient = True
            
        # 4. FALLBACK: If the LLM didn't use [Source N] format but the answer looks 
        # sufficient (no refusal phrases), return all results as citations rather than empty.
        if sufficient and not used_citations and results:
            used_citations = results

        final_citations = used_citations
        
        return GroundedAnswer(
            answer=raw_answer.strip(),
            citations=final_citations,
            found_sufficient_info=sufficient
        )
        
    except Exception as e:
        logger.error(f"Failed to generate answer: {e}")
        return GroundedAnswer(
            answer=f"Error generating answer: {str(e)}",
            citations=[],
            found_sufficient_info=False
        )
