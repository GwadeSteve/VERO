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


TOOL_DESCRIPTIONS = """You have access to these tools:

1. search_docs("query") — Search the user's uploaded documents. Returns relevant text passages with source numbers.
2. read_document("doc_id") — Fetch a document's summary and metadata.

To use a tool, output EXACTLY this on its own line:
Action: tool_name("argument")

IMPORTANT: Only ONE Action per response. Never write multiple Action lines."""


# ── Agent system prompt ──────────────────────────────────────────


AGENT_SYSTEM_PROMPT = """You are VERO, a precise AI research assistant.

You answer questions using the user's uploaded documents. You work in a loop:
- First, decide what information you need and call a tool.
- After receiving results, decide if you need more info or can answer.
- When ready, write your answer directly (no Action line).

{tool_descriptions}

STRICT RULES:
- Output ONE Action per turn. After writing an Action line, STOP. Do not write anything after it.
- Do NOT write "Think:", "Act:", "Observe:", or numbered steps. Just reason briefly, then either call a tool OR write your answer.
- For simple greetings or follow-ups that don't need documents, answer directly.
- For document questions, search first. Never guess.
- Do NOT repeat the same search query you already used.
- Maximum 3 tool calls per question. Synthesize what you have.
- Cite sources as [Source N] matching the numbers from search results.
- Do NOT include file names next to citations.
- Do NOT generate a "References" list at the end.
- Keep answers under 300 words unless asked for detail.
- Use Markdown formatting: **bold**, headers, lists, code blocks.
- Use LaTeX for math: $E = mc^2$ (inline), $$formula$$ (block).
- Start your response directly with content. No preamble like "Sure!" or "Great question!"."""

AGENT_SYSTEM_PROMPT_AUGMENTED = AGENT_SYSTEM_PROMPT + """
If you provide information from your own knowledge beyond the documents, mention it naturally."""


# ── The Research Agent ───────────────────────────────────────────


_ACTION_RE = re.compile(
    r'^Action:\s*(\w+)\s*\(\s*"(.+?)"\s*\)\s*$',
    re.MULTILINE,
)

# Patterns to strip from final answers
_REASONING_PATTERNS = [
    re.compile(r'^\d+\.\s*\*{0,2}(Think|Act|Observe|Thought|Action|Step|Plan)\*{0,2}\s*:?\s*', re.MULTILINE | re.IGNORECASE),
    re.compile(r'^(Think|Act|Observe|Thought|Action|Step|Plan)\s*:\s*', re.MULTILINE | re.IGNORECASE),
    re.compile(r'Action:\s*\w+\s*\(".*?"\)\s*', re.IGNORECASE),
    re.compile(r'Observation:\s*', re.IGNORECASE),
]


class ResearchAgent:
    """ReAct agent that reasons over VERO's document corpus."""

    MAX_ITERATIONS = 4

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
        self._used_queries: set[str] = set()  # Dedup search queries

    async def run(
        self,
        query: str,
        history_messages: list[dict] | None = None,
    ) -> AsyncGenerator[AgentEvent, None]:
        """Execute the ReAct loop, yielding events as we go."""
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
            # Yield an initial thinking event for immediate UI feedback
            yield AgentEvent(
                type=EventType.THINKING,
                content=f"Analyzing {'query' if iteration == 0 else 'results'}...",
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

            # Guard against None responses
            if not response_text:
                logger.warning("LLM returned empty/None on iteration %d", iteration)
                yield AgentEvent(
                    type=EventType.THINKING,
                    content="Retrying — received an empty response...",
                )
                continue

            # Find the FIRST Action: line only
            action_match = _ACTION_RE.search(response_text)

            if not action_match:
                # No tool call — this is the final answer. Clean it up.
                clean_answer = self._sanitize_answer(response_text)
                yield AgentEvent(type=EventType.ANSWER, content=clean_answer)
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

            # Dedup: skip if we already searched this exact query
            normalized_query = tool_arg.strip().lower()
            if tool_name == "search_docs" and normalized_query in self._used_queries:
                logger.info("Skipping duplicate search: %s", tool_arg)
                # Tell the LLM to use what it already has
                messages.append({"role": "assistant", "content": response_text})
                messages.append({
                    "role": "user",
                    "content": f"You already searched for \"{tool_arg}\". Use the results you already have. Write your answer now.",
                })
                yield AgentEvent(
                    type=EventType.THINKING,
                    content="Already searched this — synthesizing existing results...",
                )
                continue

            if tool_name == "search_docs":
                self._used_queries.add(normalized_query)

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
            # Only include text up to and including the Action line to avoid hallucinated content after it
            clean_assistant_text = response_text[:action_match.end()].strip()
            messages.append({"role": "assistant", "content": clean_assistant_text})
            messages.append({
                "role": "user",
                "content": f"Observation:\n{observation['detail']}",
            })

        # Max iterations reached — force an answer
        logger.warning("Agent hit max iterations (%d) for query: %s", self.MAX_ITERATIONS, query[:80])
        messages.append({
            "role": "user",
            "content": (
                "You have used all available tool calls. Write your final answer now "
                "using the information you've gathered. Be concise and cite sources."
            ),
        })

        try:
            final_response = await llm.generate_response(
                system_prompt=system_prompt,
                user_prompt=query,
                messages=messages,
            )
            clean_answer = self._sanitize_answer(final_response or "")
            yield AgentEvent(type=EventType.ANSWER, content=clean_answer)
        except Exception as e:
            yield AgentEvent(
                type=EventType.ERROR,
                content=f"Error generating final answer: {str(e)}",
            )

    @staticmethod
    def _clean_thinking_text(raw: str) -> str:
        """Strip verbose LLM chain-of-thought formatting into a clean UI string."""
        text = raw.strip()

        # Remove numbered list prefixes: "1. ", "2. "
        text = re.sub(r'^\d+\.\s*', '', text, flags=re.MULTILINE)

        # Remove **Think**: / **Act**: / **Thought**: style prefixes
        text = re.sub(
            r'\*{0,2}(Think|Act|Thought|Reasoning|Step|Plan|Observe)\s*:?\*{0,2}\s*:?\s*',
            '', text, flags=re.IGNORECASE
        )

        # Remove any hallucinated Action: lines
        text = re.sub(r'Action:\s*\w+\s*\(".*?"\)', '', text, flags=re.IGNORECASE)

        # Strip remaining markdown bold markers
        text = re.sub(r'\*{1,2}', '', text)

        # Collapse multiple whitespace/newlines into single spaces
        text = ' '.join(text.split())

        # Truncate to keep the UI clean
        if len(text) > 200:
            cutoff = text[:200].rfind('. ')
            if cutoff > 80:
                text = text[:cutoff + 1]
            else:
                text = text[:197] + '...'

        return text.strip()

    @staticmethod
    def _sanitize_answer(text: str) -> str:
        """Remove reasoning artifacts that leaked into the final answer."""
        if not text:
            return text

        # Strip all reasoning pattern lines
        for pattern in _REASONING_PATTERNS:
            text = pattern.sub('', text)

        # Remove any hallucinated Action: lines
        text = re.sub(r'Action:\s*\w+\s*\(".*?"\)\s*', '', text, flags=re.IGNORECASE)

        # Remove "Observe:" / "Observation:" blocks
        text = re.sub(r'Observ(?:e|ation):\s*.*?(?=\n\n|\Z)', '', text, flags=re.DOTALL | re.IGNORECASE)

        # Remove duplicate paragraphs (exact match)
        paragraphs = text.split('\n\n')
        seen = set()
        unique = []
        for p in paragraphs:
            normalized = p.strip()
            if normalized and normalized not in seen:
                seen.add(normalized)
                unique.append(p)
        text = '\n\n'.join(unique)

        # Clean up excess whitespace
        text = re.sub(r'\n{3,}', '\n\n', text)

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
                f"Status: {doc.processing_status}\n"
                f"Chunks: {doc.chunk_count or 'N/A'}\n"
            ),
            "metadata": {"tool_name": "read_document", "doc_id": doc_id, "title": doc.title},
        }

    def get_all_search_results(self) -> list:
        """Return all accumulated search results across iterations."""
        return self._all_results
