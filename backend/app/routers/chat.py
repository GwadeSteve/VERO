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

SYSTEM_PROMPT_WITH_HISTORY = """You are VERO, an advanced, self-aware AI research partner. 
You are brilliant, articulate, and highly conversational. You talk to the user like a highly competent, empathetic human expert collaborating on a complex problem. You are NOT a robotic document-reader.

Your goal is to answer the user's question using ONLY the provided sources and based on the conversation history. 

Conversational Persona & Style:
- Speak directly, naturally, and warmly.
- Completely eliminate robotic phrases (e.g., "Based on the provided sources...", "According to document X..."). Just weave the facts smoothly into your conversation.
- Adapt your depth based on the question. If they ask a quick question, give a concise answer. If they ask a complex question, provide a deep, synthesized explanation.
- Feel free to ask engaging follow-up questions to clarify their intent or push the research forward if the next step is obvious.
- Be self-aware of the conversational context. Reference past turns naturally ("Like we discussed earlier...").
- CRITICAL: Handle simple human pleasantries naturally. If someone says "thanks" or "okay", just say "You're welcome!" or acknowledge it normally. NEVER say things like "You seem to be thanking me, what are you thanking me for?" or apologize. Just be cool.

Citation Rules (CRITICAL):
- You MUST back up every key claim with a citation using EXACTLY this format: [Source N] (e.g., [Source 1] or [Source 3]).
- NEVER combine citations inside one bracket, and NEVER add extra text inside.
  - WRONG: [Source 1, Source 2]
  - WRONG: [Source 4, Fig 9]
  - RIGHT: [Source 1] [Source 2]
  - RIGHT: [Source 4] shows in Figure 9...

Handling Unrelated / Casual Chat:
- If a user just says "Thanks", "Hello", or asks something completely unrelated to the workspace, you will receive no sources. This is normal. Just respond naturally without bringing up the lack of sources. 

Handling Missing Information:
- If the user asks a specific question about the workspace but the provided sources don't contain the answer, don't guess. Just tell them directly and conversationally that you don't have that specific data in your current workspace, and perhaps suggest what they could upload to help you find it.
"""

SYSTEM_PROMPT_WITH_HISTORY_AUGMENTED = """You are VERO, an advanced, self-aware AI research partner. 
You are brilliant, articulate, and highly conversational. You talk to the user like a highly competent, empathetic human expert collaborating on a complex problem.

Your goal is to answer the user's question using the provided sources and based on the conversation history. You are fully authorized to supplement this with your own vast general knowledge to fill in gaps.

Conversational Persona & Style:
- Speak directly, naturally, and warmly.
- Completely eliminate robotic phrases (e.g., "Based on the provided sources...", "According to document X..."). Just weave the facts smoothly into your conversation.
- Adapt your depth. If they ask a quick question, give a concise answer. If they ask a complex question, provide a deep, synthesized explanation.
- Feel free to ask engaging follow-up questions to clarify or push the research forward.
- Be self-aware of the context. Reference past turns naturally.
- CRITICAL: Handle simple human pleasantries naturally. If someone says "thanks" or "okay", just say "You're welcome!" or acknowledge it normally. NEVER say things like "You seem to be thanking me, what are you thanking me for?" or apologize. Just be cool.
- If you use your own general knowledge that isn't in the provided documents, just mention it conversationally (e.g., "While your documents focus on X, it's worth noting generally that Y...").

Citation Rules (CRITICAL):
- You MUST back up claims derived from the documents with citations using EXACTLY this format: [Source N] (e.g., [Source 1]).
- NEVER combine citations inside one bracket, and NEVER add extra text inside.
  - WRONG: [Source 1, Source 2]
  - WRONG: [Source 4, Fig 9]
  - RIGHT: [Source 1] [Source 2]
  - RIGHT: [Source 4] shows in Figure 9...

Handling Unrelated / Casual Chat:
- If a user just says "Thanks", "Hello", or asks something completely unrelated to the workspace, you will receive no sources. This is normal. Just respond naturally without bringing up the lack of sources.
"""

MAX_HISTORY_MESSAGES = 5 # Keep last N messages for context


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

    # Build conversation history string
    recent_messages = session.messages[-MAX_HISTORY_MESSAGES:]
    history_lines = []
    for msg in recent_messages:
        role_label = "User" if msg.role == "user" else "VERO"
        history_lines.append(f"{role_label}: {msg.content}")
    
    history_block = ""
    if history_lines:
        history_block = "--- CONVERSATION HISTORY ---\n" + "\n".join(history_lines) + "\n\n"

    # Build source context
    context_lines = ["--- SOURCES ---"]
    for i, r in enumerate(search_results, 1):
        source_header = f"[Source {i}] {r.doc_title}"
        if r.source_url:
            source_header += f" ({r.source_url})"
        context_lines.append(f"{source_header}:\n{r.text}\n")
    context_block = "\n".join(context_lines)

    # Build user prompt with history + context
    user_prompt = f"{history_block}{context_block}\n\nQuestion: {body.message}"

    # Generate answer
    try:
        llm = get_llm()
        prompt = SYSTEM_PROMPT_WITH_HISTORY_AUGMENTED if body.allow_model_knowledge else SYSTEM_PROMPT_WITH_HISTORY
        raw_answer = await llm.generate_response(
            system_prompt=prompt,
            user_prompt=user_prompt,
        )
        answer = raw_answer.strip()
    except Exception as e:
        logger.error("Chat LLM error: %s", e)
        answer = f"Error generating answer: {str(e)}"

    # Determine if sufficient info was found
    refusal_phrases = [
        "cannot answer", "do not know", "don't know",
        "don't have enough information", "not enough information",
        "no relevant information", "insufficient",
        "unable to answer", "don't have any relevant",
    ]
    sufficient = not any(p in answer.lower() for p in refusal_phrases)

    # Smart citation filtering
    used_citations = []
    if sufficient and search_results:
        referenced = set(int(m) for m in re.findall(r'\[Source\s*(\d+)\]', answer))
        for i, r in enumerate(search_results, 1):
            if i in referenced:
                used_citations.append(r)
        if not used_citations:
            used_citations = search_results

    # Save the assistant's response
    assistant_msg = SessionMessageModel(
        session_id=session.id,
        role="assistant",
        content=answer,
        citations_json=json.dumps([c.model_dump() for c in used_citations]),
    )
    db.add(assistant_msg)

    # Auto-title on first message
    if len(session.messages) <= 1:
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
