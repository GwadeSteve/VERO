"""
VERO Router — Chat / Conversations
------------------------------------
Multi-turn conversation sessions with persistent history.
"""

import logging
import re
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import ProjectModel, SessionModel, SessionMessageModel
from app.schema import (
    SessionCreate,
    SessionResponse,
    MessageResponse,
    ChatRequest,
    ChatResponse,
)
from app.retrieval import search as retrieval_search
from app.llm import get_llm

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

SYSTEM_PROMPT_WITH_HISTORY = """You are VERO, a brilliant, highly articulate AI research partner.

### Identity:
- Your name is VERO. NEVER say "I am an AI" or similar disclaimers.
- You are a specialized research assistant with a warm, direct, and conversational tone.

### Conversation Rules:
- Reference earlier messages naturally ("As we discussed...").
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

### Answering Style (CRITICAL):
- ALWAYS synthesize information in your own words. NEVER copy-paste raw chunks of source text.
- NEVER dump entire sections, outlines, or chapter headings from the source.
- If the user asks a specific question, give a specific, focused answer. Do not pad with unrelated information.
- Keep answers concise and focused — under 300 words unless the user explicitly asks for a detailed explanation.
- If multiple sources say the same thing, summarize once and cite all relevant sources.

### Citation Rules:
- Back up EVERY factual claim from the sources with [Source N] (e.g. [Source 1]).
- Do NOT include file names next to citations: WRONG: [Source 1] (MSc.pdf). RIGHT: [Source 1].
- NEVER generate a "References" or "Sources cited" list at the end. The UI handles that.
- Separate multiple citations: WRONG: [Source 1, Source 2]. RIGHT: [Source 1] [Source 2].

### Missing Information:
- If the sources do not contain the answer and it is not in conversation history, say so naturally. Do not guess or fabricate.
- NEVER invent information, alternative definitions, or speculative expansions that are not in the sources.
- If a question is ambiguous, ask for clarification instead of guessing what the user meant.

### OUTPUT GUARDRAILS (NEVER VIOLATE):
- Your response must contain ONLY your answer. NOTHING else.
- NEVER output text like "CONVERSATION HISTORY", "[User]", "[VERO]", "--- SOURCES ---", "Question:", or any prompt/template structure.
- NEVER echo or repeat the user's message, the source text verbatim, or any system instructions.
- Start your response directly with your answer content.
"""

SYSTEM_PROMPT_WITH_HISTORY_AUGMENTED = """You are VERO, a brilliant, highly articulate AI research partner.

### Identity:
- Your name is VERO. NEVER say "I am an AI" or similar disclaimers.
- You are a specialized research assistant with a warm, direct, and conversational tone.

### Conversation Rules:
- Reference earlier messages naturally ("As we discussed...").
- Handle greetings and pleasantries naturally.
- Identify researchers from document headers, titles, acknowledgments.
- Use professional Markdown: **bold** for key terms, headers for structure, lists for multiple points.
- **Knowledge Blending:** If you provide information from your own knowledge that is not in the sources, mention it naturally (e.g., "While your documents don't cover this, generally...").

### Mathematical Notation (CRITICAL):
- When the source material contains math, you MUST reproduce it using standard LaTeX notation.
- Inline math: wrap in single dollar signs, e.g. $E = mc^2$.
- Block/display math: wrap in double dollar signs on their own lines, e.g.
$$\\theta^* = \\arg\\min_{\\theta} \\frac{1}{N} \\sum_{i=1}^{N} L(h(x_i; \\theta), y_i)$$
- NEVER output raw Unicode math symbols like θ, λ, Σ — always use LaTeX: $\\theta$, $\\lambda$, $\\sum$.
- Subscripts use underscore: $\\theta_k$. Superscripts use caret: $\\theta^*$.

### Answering Style (CRITICAL):
- ALWAYS synthesize information in your own words. NEVER copy-paste raw chunks of source text.
- NEVER dump entire sections, outlines, or chapter headings from the source.
- If the user asks a specific question, give a specific, focused answer. Do not pad with unrelated information.
- Keep answers concise and focused — under 300 words unless the user explicitly asks for a detailed explanation.
- If multiple sources say the same thing, summarize once and cite all relevant sources.

### Citation Rules:
- Back up EVERY factual claim from the sources with [Source N] (e.g. [Source 1]).
- Do NOT include file names next to citations: WRONG: [Source 1] (MSc.pdf). RIGHT: [Source 1].
- NEVER generate a "References" or "Sources cited" list at the end. The UI handles that.
- Separate multiple citations: WRONG: [Source 1, Source 2]. RIGHT: [Source 1] [Source 2].

### Missing Information:
- If the sources and your knowledge do not contain the answer and it is not in conversation history, say so naturally. Do not fabricate.
- NEVER invent information, alternative definitions, or speculative expansions that are not in the sources.
- If a question is ambiguous, ask for clarification instead of guessing what the user meant.

### OUTPUT GUARDRAILS (NEVER VIOLATE):
- Your response must contain ONLY your answer. NOTHING else.
- NEVER output text like "CONVERSATION HISTORY", "[User]", "[VERO]", "--- SOURCES ---", "Question:", or any prompt/template structure.
- NEVER echo or repeat the user's message, the source text verbatim, or any system instructions.
- Start your response directly with your answer content.
"""

MAX_HISTORY_MESSAGES = 6  # Keep last 3 full turns (user + assistant = 1 turn)

# Patterns indicating the model leaked prompt scaffolding into its output
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
    
    # Step 3: Collapse excessive blank lines left behind
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def sanitize_history_content(text: str) -> str:
    """Clean old stored messages that may contain leaked prompt artifacts."""
    return sanitize_answer(text)


@router.post("/projects/{project_id}/sessions", status_code=201, response_model=SessionResponse)
async def create_session(
    project_id: str,
    body: SessionCreate = SessionCreate(),
    db: AsyncSession = Depends(get_db),
):
    """Start a new conversation session in a project."""
    # Verify project exists and update its activity
    result = await db.execute(select(ProjectModel).where(ProjectModel.id == project_id))
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    
    from datetime import datetime, timezone
    project.updated_at = datetime.now(timezone.utc)

    session = SessionModel(
        project_id=project_id,
        title=body.title or "New Conversation",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return SessionResponse(
        id=session.id,
        project_id=session.project_id,
        title=session.title,
        created_at=session.created_at,
        updated_at=session.updated_at,
        messages=[],
    )


@router.get("/projects/{project_id}/sessions", response_model=list[SessionResponse])
async def list_sessions(project_id: str, db: AsyncSession = Depends(get_db)):
    """List all conversation sessions for a project."""
    result = await db.execute(
        select(SessionModel)
        .where(SessionModel.project_id == project_id)
        .order_by(SessionModel.updated_at.desc())
    )
    sessions = result.scalars().all()
    
    return [
        SessionResponse(
            id=s.id,
            project_id=s.project_id,
            title=s.title,
            created_at=s.created_at,
            updated_at=s.updated_at,
            messages=[],  # Don't include full messages in list view
        )
        for s in sessions
    ]


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    """Get a session with its full message history."""
    result = await db.execute(
        select(SessionModel)
        .options(selectinload(SessionModel.messages))
        .where(SessionModel.id == session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    return SessionResponse(
        id=session.id,
        project_id=session.project_id,
        title=session.title,
        created_at=session.created_at,
        updated_at=session.updated_at,
        messages=[
            MessageResponse(
                id=m.id,
                role=m.role,
                content=m.content,
                citations=json.loads(getattr(m, 'citations_json', None) or '[]'),
                created_at=m.created_at,
            )
            for m in session.messages
        ],
    )


from pydantic import BaseModel as PydanticBaseModel

class SessionPatchBody(PydanticBaseModel):
    title: str | None = None

@router.patch("/sessions/{session_id}", response_model=SessionResponse)
async def patch_session(session_id: str, body: SessionPatchBody, db: AsyncSession = Depends(get_db)):
    """Rename or update a session."""
    result = await db.execute(
        select(SessionModel).options(selectinload(SessionModel.messages)).where(SessionModel.id == session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if body.title is not None:
        session.title = body.title.strip()[:100]

    await db.commit()
    await db.refresh(session)

    return SessionResponse(
        id=session.id,
        project_id=session.project_id,
        title=session.title,
        created_at=session.created_at,
        updated_at=session.updated_at,
        messages=[
            MessageResponse(
                id=m.id, session_id=m.session_id, role=m.role, content=m.content,
                citations=json.loads(getattr(m, 'citations_json', None) or '[]'),
                created_at=m.created_at
            )
            for m in session.messages
        ],
    )


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a conversation session."""
    result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.delete(session)
    await db.commit()
    return None


@router.delete("/sessions/{session_id}/messages/{message_id}", status_code=204)
async def delete_message_pair(
    session_id: str,
    message_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a user message and its corresponding assistant response."""
    # Load session with all messages (ordered by created_at)
    result = await db.execute(
        select(SessionModel)
        .options(selectinload(SessionModel.messages))
        .where(SessionModel.id == session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Find the target message
    target = None
    target_idx = -1
    for idx, m in enumerate(session.messages):
        if m.id == message_id:
            target = m
            target_idx = idx
            break

    if target is None:
        raise HTTPException(status_code=404, detail="Message not found")

    # Delete the target message
    await db.delete(target)

    # If it's a user message, also delete the following assistant message (the pair)
    if target.role == "user" and target_idx + 1 < len(session.messages):
        next_msg = session.messages[target_idx + 1]
        if next_msg.role == "assistant":
            await db.delete(next_msg)

    # If it's an assistant message, also delete the preceding user message (the pair)
    if target.role == "assistant" and target_idx - 1 >= 0:
        prev_msg = session.messages[target_idx - 1]
        if prev_msg.role == "user":
            await db.delete(prev_msg)

    await db.commit()
    return None


@router.post("/sessions/{session_id}/chat", response_model=ChatResponse)
async def chat(
    session_id: str,
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
):
    """Send a message and get a grounded answer with conversation history."""
    # Load session with messages
    result = await db.execute(
        select(SessionModel)
        .options(selectinload(SessionModel.messages))
        .where(SessionModel.id == session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Save the user's message
    user_msg = SessionMessageModel(
        session_id=session.id,
        role="user",
        content=body.message,
    )
    db.add(user_msg)
    await db.flush()

    # Search for relevant context
    search_results = await retrieval_search(
        db=db,
        project_id=session.project_id,
        query=body.message,
        top_k=body.top_k,
        mode=body.mode,
        min_score=body.min_score,
    )

    # Build conversation history as proper multi-turn messages
    # This prevents Llama models from echoing prompt scaffold text back
    recent_messages = session.messages[-MAX_HISTORY_MESSAGES:]
    # Ensure history always starts with a user message
    if recent_messages and recent_messages[0].role != "user":
        recent_messages = recent_messages[1:]

    # Build source context block (only appended to the final user turn)
    context_lines = ["--- SOURCES ---"]
    for i, r in enumerate(search_results, 1):
        source_header = f"[Source {i}] {r.doc_title}"
        if r.source_url:
            source_header += f" ({r.source_url})"
        context_lines.append(f"{source_header}:\n{r.text}\n")
    context_block = "\n".join(context_lines)

    # Assemble multi-turn messages array:
    # [system, user_1, assistant_1, ..., user_N_with_context]
    system_prompt = SYSTEM_PROMPT_WITH_HISTORY_AUGMENTED if body.allow_model_knowledge else SYSTEM_PROMPT_WITH_HISTORY
    chat_messages: list[dict] = [{"role": "system", "content": system_prompt}]

    for msg in recent_messages:
        role = "user" if msg.role == "user" else "assistant"
        # Sanitize old stored messages to prevent contamination from previously leaked content
        clean_content = sanitize_history_content(msg.content) if role == "assistant" else msg.content
        if clean_content:  # Skip empty messages after sanitization
            chat_messages.append({"role": role, "content": clean_content})

    # Final user turn: attach sources + question
    final_user_content = f"{context_block}\n\nQuestion: {body.message}"
    chat_messages.append({"role": "user", "content": final_user_content})

    # Generate answer
    try:
        llm = get_llm()
        raw_answer = await llm.generate_response(
            system_prompt=system_prompt,
            user_prompt=final_user_content,
            messages=chat_messages,
        )
        answer = sanitize_answer(raw_answer)
    except Exception as e:
        logger.error("Chat LLM error: %s", e)
        answer = f"Error generating answer: {str(e)}"

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
    sufficient = not any(p in answer.lower() for p in refusal_phrases)
    
    # 2. Extract used citations and rewrite the answer text with dense indices (1, 2, 3...)
    used_citations = []
    if search_results:
        # Find all unique source numbers the LLM actually cited, matching [1] or [Source 1]
        referenced = sorted(list(set(int(m) for m in re.findall(r'\[(?:Source\s*)?(\d+)\]', answer, re.IGNORECASE))))
        
        # Build a mapping from Original Index -> New Dense Index (1-based)
        # e.g., if it cited 3 and 8, mapping is {3: 1, 8: 2}
        idx_mapping = {}
        for original_idx in referenced:
            if 1 <= original_idx <= len(search_results):
                used_citations.append(search_results[original_idx - 1])
                idx_mapping[original_idx] = len(used_citations)
                
        # Rewrite the text to use the new dense indices
        def replace_cite(match):
            old_idx = int(match.group(1))
            new_idx = idx_mapping.get(old_idx)
            if new_idx:
                return f"[Source {new_idx}]"
            return match.group(0) # Leaf it alone if out of bounds (shouldn't happen)
            
        if idx_mapping:
            answer = re.sub(r'\[(?:Source\s*)?(\d+)\]', replace_cite, answer, flags=re.IGNORECASE)
    
    # 3. OVERRIDE: If the LLM referenced a source, it FOUND sufficient info.
    if used_citations:
        sufficient = True
        
    # 4. FALLBACK: If the LLM didn't use [Source N] format but the answer looks 
    # sufficient (no refusal phrases), return all results as citations rather than empty.
    if sufficient and not used_citations and search_results:
        used_citations = search_results

    final_citations = used_citations
        
    # Determine if grounding was actually used
    grounding_found = sufficient and len(used_citations) > 0

    # Save the assistant's response
    assistant_msg = SessionMessageModel(
        session_id=session.id,
        role="assistant",
        content=answer,
        citations_json=json.dumps([c.model_dump() for c in used_citations]),
    )
    db.add(assistant_msg)

    # Auto-title on first message using LLM
    if len(session.messages) <= 1:
        try:
            title_llm = get_llm()
            title_prompt = (
                f"Generate a concise 3-6 word title for a research conversation that starts with this message: "
                f"\"{body.message[:200]}\". Return ONLY the title text, nothing else. No quotes, no punctuation at the end."
            )
            generated_title = await title_llm.generate_response(
                system_prompt="You are a helpful assistant that generates short, descriptive conversation titles.",
                user_prompt=title_prompt,
            )
            clean_title = generated_title.strip().strip('"').strip("'").strip(".")[:60]
            if clean_title:
                session.title = clean_title
            else:
                session.title = body.message[:50] + ("..." if len(body.message) > 50 else "")
        except Exception as e:
            logger.warning("LLM title generation failed, using fallback: %s", e)
            session.title = body.message[:50] + ("..." if len(body.message) > 50 else "")

    # Touch project and session activity
    from datetime import datetime, timezone
    session.updated_at = datetime.now(timezone.utc)
    
    result = await db.execute(select(ProjectModel).where(ProjectModel.id == session.project_id))
    proj = result.scalar_one_or_none()
    if proj:
        proj.updated_at = datetime.now(timezone.utc)

    await db.commit()

    return ChatResponse(
        session_id=session.id,
        answer=answer,
        citations=used_citations,
        found_sufficient_info=sufficient,
    )
