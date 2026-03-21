"""VERO Research Agent — ReAct Reasoning Loop.

Implements the Think → Act → Observe → Repeat pattern over VERO's
existing retrieval tools.  Any LLM provider (Groq / Gemini / Ollama)
works — intelligence lives in the orchestration, not the model.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import AsyncGenerator, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ── Event types streamed to the frontend ──────────────────────────


class EventType(str, Enum):
    THINKING = "thinking"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    ANSWER = "answer"
    ERROR = "error"


@dataclass
class AgentEvent:
    type: EventType
    content: str
    metadata: dict = field(default_factory=dict)

    def to_sse(self) -> str:
        """Serialize as a Server-Sent Event line."""
        payload = {
            "type": self.type.value,
            "content": self.content,
            "metadata": self.metadata,
        }
        return f"data: {json.dumps(payload)}\n\n"


# ── Tool definitions ──────────────────────────────────────────────


TOOL_DESCRIPTIONS = """You have access to the following tools to research the user's questions:

1. search_docs(query: str)
   Search the user's uploaded documents using hybrid semantic + keyword search.
   Returns the most relevant text passages with source information.
   Use this when you need to find specific information in the documents.

2. read_document(doc_id: str)
   Fetch the summary and metadata of a specific document.
   Use this when you want broader context about a document found in search results.

To use a tool, output EXACTLY this format on its own line:
Action: tool_name("argument")

Examples:
Action: search_docs("attention mechanism in transformers")
Action: read_document("abc123")

After receiving tool results in an Observation, continue reasoning.
When you have enough information, write your final answer directly (no Action line).
"""


# ── Agent system prompt ──────────────────────────────────────────


AGENT_SYSTEM_PROMPT = """You are VERO, a brilliant AI research partner with access to the user's documents.

### How you work:
You solve questions step-by-step using a Think → Act → Observe loop:
1. **Think**: Reason about what information you need.
2. **Act**: Use a tool to retrieve information.
3. **Observe**: Read the results and decide if you need more info.
4. Repeat until you can write a confident, grounded answer.

{tool_descriptions}

### Rules:
- For simple greetings or follow-ups that don't need document search, answer directly without using tools.
- For questions about the user's documents, ALWAYS search first. Never guess.
- If a question is complex (comparing concepts, connecting ideas), decompose it into sub-searches.
- Cite sources as [Source N] in your final answer, matching the source numbers from search results.
- Keep your thinking concise — focus on what you need, not lengthy analysis.
- When you have enough information, write your final answer. Do NOT keep searching unnecessarily.
- Maximum 5 tool calls per question. After 5, synthesize what you have.

### Citation Rules (CRITICAL):
- Back up EVERY factual claim with [Source N].
- Do NOT include file names next to citations.
- NEVER generate a "References" list at the end.

### Mathematical Notation:
- Inline math: $E = mc^2$
- Block math: $$\\theta^* = \\arg\\min ...$$
- NEVER use raw Unicode math symbols.

### Output:
- Use professional Markdown: **bold**, headers, lists, code blocks.
- Keep answers concise — under 300 words unless asked for detail.
- Start your response directly with content. No preamble.
"""

AGENT_SYSTEM_PROMPT_AUGMENTED = AGENT_SYSTEM_PROMPT + """
### Knowledge Blending:
If you provide information from your own knowledge beyond the documents, mention it naturally
(e.g., "While your documents don't cover this, generally...").
"""


# ── The Research Agent ───────────────────────────────────────────


_ACTION_RE = re.compile(
    r'^Action:\s*(\w+)\s*\(\s*"(.+?)"\s*\)\s*$',
    re.MULTILINE,
)


class ResearchAgent:
    """ReAct agent that reasons over VERO's document corpus."""

    MAX_ITERATIONS = 5

    def __init__(
        self,
        db: AsyncSession,
        project_id: str,
        allow_model_knowledge: bool = False,
        top_k: int = 5,
        mode: str = "hybrid",
        min_score: float = 0.01,
    ):
        self.db = db
        self.project_id = project_id
        self.allow_model_knowledge = allow_model_knowledge
        self.top_k = top_k
        self.mode = mode
        self.min_score = min_score

        # Accumulated search results across iterations
        self._all_results: list = []
        self._source_counter = 0
        self._thought_steps: list[str] = []

    async def run(
        self,
        query: str,
        history_messages: list[dict] | None = None,
    ) -> AsyncGenerator[AgentEvent, None]:
        """Execute the ReAct loop, yielding events as we go.

        Args:
            query: The user's question.
            history_messages: Prior conversation messages [{role, content}, ...].

        Yields:
            AgentEvent objects for each step (thinking, tool calls, final answer).
        """
        from app.llm import get_llm

        llm = get_llm()

        # Build the system prompt
        base_prompt = (
            AGENT_SYSTEM_PROMPT_AUGMENTED if self.allow_model_knowledge
            else AGENT_SYSTEM_PROMPT
        )
        system_prompt = base_prompt.format(tool_descriptions=TOOL_DESCRIPTIONS)

        # Build messages
        messages: list[dict] = [{"role": "system", "content": system_prompt}]

        # Conversation history (already sanitized by caller)
        if history_messages:
            messages.extend(history_messages)

        # Current query
        messages.append({"role": "user", "content": query})

        # ReAct Loop
        for iteration in range(self.MAX_ITERATIONS):
            # Yield an initial thinking event to immediately show activity in the UI
            yield AgentEvent(
                type=EventType.THINKING,
                content=f"Analyzing { 'query' if iteration == 0 else 'results' }...",
                metadata={"iteration": iteration + 1}
            )

            try:
                response_text = await llm.generate_response(
                    system_prompt=system_prompt,
                    user_prompt=query,
                    messages=messages,
                )
            except Exception as e:
                logger.error("Agent LLM error on iteration %d: %s", iteration, e)
                yield AgentEvent(
                    type=EventType.ERROR,
                    content=f"Error generating response: {str(e)}",
                )
                return

            # Guard against None responses (rate limits, empty replies, etc.)
            if not response_text:
                logger.warning("LLM returned empty/None on iteration %d", iteration)
                yield AgentEvent(
                    type=EventType.THINKING,
                    content="Retrying — received an empty response...",
                )
                continue

            # Check if the LLM wants to use a tool
            action_match = _ACTION_RE.search(response_text)

            if not action_match:
                # No tool call — this is the final answer
                yield AgentEvent(type=EventType.ANSWER, content=response_text)
                return

            # Extract reasoning before the Action line
            action_start = action_match.start()
            thinking_text = response_text[:action_start].strip()
            if thinking_text:
                clean_thought = self._clean_thinking_text(thinking_text)
                if clean_thought:
                    self._thought_steps.append(clean_thought)
                    yield AgentEvent(
                        type=EventType.THINKING,
                        content=clean_thought,
                    )

            # Parse the tool call
            tool_name = action_match.group(1)
            tool_arg = action_match.group(2)

            yield AgentEvent(
                type=EventType.TOOL_CALL,
                content=f"{tool_name}(\"{tool_arg}\")",
                metadata={"tool_name": tool_name, "argument": tool_arg},
            )

            # Execute the tool
            observation = await self._execute_tool(tool_name, tool_arg)

            yield AgentEvent(
                type=EventType.TOOL_RESULT,
                content=observation["summary"],
                metadata=observation.get("metadata", {}),
            )

            # Append the assistant's response + observation to messages
            messages.append({"role": "assistant", "content": response_text})
            messages.append({
                "role": "user",
                "content": f"Observation:\n{observation['detail']}",
            })

        # Max iterations reached — force an answer
        logger.warning("Agent hit max iterations (%d) for query: %s", self.MAX_ITERATIONS, query[:80])
        messages.append({
            "role": "user",
            "content": (
                "You have used all available tool calls. Based on what you've found so far, "
                "write your final answer now. Synthesize all the information gathered."
            ),
        })

        try:
            final_response = await llm.generate_response(
                system_prompt=system_prompt,
                user_prompt=query,
                messages=messages,
            )
            yield AgentEvent(type=EventType.ANSWER, content=final_response)
        except Exception as e:
            yield AgentEvent(
                type=EventType.ERROR,
                content=f"Error generating final answer: {str(e)}",
            )

    @staticmethod
    def _clean_thinking_text(raw: str) -> str:
        """Strip verbose LLM chain-of-thought formatting into a clean UI string."""
        import re as _re

        text = raw.strip()

        # Remove numbered list prefixes: "1. ", "2. ", etc.
        text = _re.sub(r'^\d+\.\s*', '', text, flags=_re.MULTILINE)

        # Remove **Think**: / **Act**: / **Thought**: style prefixes
        text = _re.sub(
            r'\*{0,2}(Think|Act|Thought|Reasoning|Step|Plan|Observe)\s*:?\*{0,2}\s*:?\s*',
            '', text, flags=_re.IGNORECASE
        )

        # Strip remaining markdown bold markers
        text = _re.sub(r'\*{1,2}', '', text)

        # Collapse multiple whitespace/newlines into single spaces
        text = ' '.join(text.split())

        # Truncate overly long thoughts to keep the UI clean
        if len(text) > 200:
            # Try to cut at a sentence boundary
            cutoff = text[:200].rfind('. ')
            if cutoff > 80:
                text = text[:cutoff + 1]
            else:
                text = text[:197] + '...'

        return text.strip()

    async def _execute_tool(self, tool_name: str, argument: str) -> dict:
        """Dispatch a tool call and return the observation."""
        if tool_name == "search_docs":
            return await self._tool_search_docs(argument)
        elif tool_name == "read_document":
            return await self._tool_read_document(argument)
        else:
            return {
                "summary": f"Unknown tool: {tool_name}",
                "detail": f"Tool '{tool_name}' is not available. Use search_docs or read_document.",
            }

    async def _tool_search_docs(self, query: str) -> dict:
        """Execute hybrid search over the project's documents."""
        from app.retrieval import search as retrieval_search

        results = await retrieval_search(
            db=self.db,
            project_id=self.project_id,
            query=query,
            top_k=self.top_k,
            mode=self.mode,
            min_score=self.min_score,
        )

        if not results:
            return {
                "summary": "No relevant passages found.",
                "detail": f"Search for \"{query}\" returned no results in this project's documents.",
                "metadata": {"result_count": 0},
            }

        # Format results with source numbers (continuing from previous searches)
        formatted_lines = []
        new_results_info = []
        for r in results:
            self._source_counter += 1
            src_num = self._source_counter
            self._all_results.append({"source_num": src_num, "result": r})

            header = f"[Source {src_num}] {r.doc_title}"
            if r.source_url:
                header += f" ({r.source_url})"
            formatted_lines.append(f"{header}\n{r.text}")
            new_results_info.append({"source_num": src_num, "title": r.doc_title})

        return {
            "summary": f"Found {len(results)} relevant passages.",
            "detail": "\n\n---\n\n".join(formatted_lines),
            "metadata": {
                "tool_name": "search_docs",
                "result_count": len(results),
                "sources": new_results_info,
                "results": [r.model_dump() for r in results]
            },
        }

    async def _tool_read_document(self, doc_id: str) -> dict:
        """Fetch a document's summary and metadata."""
        from sqlalchemy import select
        from app.models import DocumentModel

        result = await self.db.execute(
            select(DocumentModel).where(
                DocumentModel.id == doc_id,
                DocumentModel.project_id == self.project_id,
            )
        )
        doc = result.scalar_one_or_none()

        if not doc:
            return {
                "summary": f"Document '{doc_id}' not found.",
                "detail": f"No document with ID '{doc_id}' exists in this project.",
            }

        return {
            "summary": f"Read document: {doc.title}",
            "detail": (
                f"Title: {doc.title}\n"
                f"Type: {doc.source_type}\n"
                f"Summary: {doc.summary or 'No summary available.'}\n"
                f"Characters: {len(doc.raw_text or '')}\n"
                f"Source URL: {doc.source_url or 'N/A'}"
            ),
            "metadata": {"doc_id": doc.id, "title": doc.title},
        }

    def get_all_search_results(self):
        """Return all accumulated search results for citation extraction."""
        return self._all_results

    def get_thought_steps(self) -> list[str]:
        """Return all thinking steps for inclusion in the response."""
        return self._thought_steps
