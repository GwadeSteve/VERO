"""
VERO Router — Chat / Conversations
------------------------------------
Multi-turn conversation sessions with persistent history.
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel as PydanticBaseModel
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
from app.prompts import get_chat_prompt
from app.postprocess import (
    sanitize_answer,
    extract_and_rewrite_citations,
    build_source_context,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

MAX_HISTORY_MESSAGES = 6  # Keep last 3 full turns (user + assistant = 1 turn)


@router.post("/projects/{project_id}/sessions", status_code=201, response_model=SessionResponse)
async def create_session(
    project_id: str,
    body: SessionCreate = SessionCreate(),
    db: AsyncSession = Depends(get_db),
):
    """Start a new conversation session in a project."""
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
            messages=[],
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
                id=m.id, role=m.role, content=m.content,
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
    result = await db.execute(
        select(SessionModel)
        .options(selectinload(SessionModel.messages))
        .where(SessionModel.id == session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    target = None
    target_idx = -1
    for idx, m in enumerate(session.messages):
        if m.id == message_id:
            target = m
            target_idx = idx
            break

    if target is None:
        raise HTTPException(status_code=404, detail="Message not found")

    await db.delete(target)

    if target.role == "user" and target_idx + 1 < len(session.messages):
        next_msg = session.messages[target_idx + 1]
        if next_msg.role == "assistant":
            await db.delete(next_msg)

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

    # Query rewriting is done without extra LLM calls.
    from app.query_rewriter import rewrite_query

    history_for_rewriter = [
        {"role": msg.role, "content": msg.content}
        # Exclude the very last message since it's the newly inserted current user query
        for msg in session.messages[:-1][-6:]
    ]
    search_query = rewrite_query(body.message, history=history_for_rewriter)

    search_results = await retrieval_search(
        db=db,
        project_id=session.project_id,
        query=search_query,
        top_k=body.top_k,
        mode=body.mode,
        min_score=body.min_score,
    )

    # The current user message was just added to session.messages. We must exclude it
    # from the 'history' array since we manually append it with context at the very end!
    history_messages = session.messages[:-1]
    recent_messages = history_messages[-MAX_HISTORY_MESSAGES:]

    if recent_messages and recent_messages[0].role != "user":
        recent_messages = recent_messages[1:]

    context_block = build_source_context(search_results)
    system_prompt = get_chat_prompt(allow_model_knowledge=body.allow_model_knowledge)

    chat_messages: list[dict] = [{"role": "system", "content": system_prompt}]
    for msg in recent_messages:
        role = "user" if msg.role == "user" else "assistant"
        clean_content = sanitize_answer(msg.content) if role == "assistant" else msg.content
        if clean_content:
            chat_messages.append({"role": role, "content": clean_content})

    final_user_content = f"{context_block}\n\nQuestion: {body.message}"
    chat_messages.append({"role": "user", "content": final_user_content})

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

    answer, used_citations, sufficient = extract_and_rewrite_citations(answer, search_results)

    assistant_msg = SessionMessageModel(
        session_id=session.id,
        role="assistant",
        content=answer,
        citations_json=json.dumps([c.model_dump() for c in used_citations]),
    )
    db.add(assistant_msg)

    # Auto-title on first message
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

    # Touch timestamps
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
