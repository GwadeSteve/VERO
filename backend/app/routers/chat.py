"""
VERO Router — Chat / Conversations
------------------------------------
Multi-turn conversation sessions with persistent history.
"""

import logging
import re

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

SYSTEM_PROMPT_WITH_HISTORY = """You are VERO, a sharp and knowledgeable research assistant.

Your job is to answer the user's question using ONLY the sources provided below plus any conversation context from earlier in this chat. Think of yourself as a helpful colleague who has read the documents and is continuing a conversation.

How to answer:
- Write naturally, like you're explaining to a smart person. Avoid stiff, robotic language.
- Back up every key claim with a citation like [Source 1] or [Source 3]. Weave them into your sentences naturally.
- If the sources cover the topic well, give a thorough answer. Summarize, synthesize, and connect the dots.
- If the user's question is a follow-up to something you discussed earlier, use the conversation context to give a coherent response.
- If the sources don't cover the question at all, say something like "I don't have enough information in the provided documents to answer that." Don't guess or make things up.
- Keep it concise but complete. No filler, no disclaimers about being an AI.
"""

SYSTEM_PROMPT_WITH_HISTORY_AUGMENTED = """You are VERO, a sharp and knowledgeable research assistant.

Your job is to answer the user's question using the sources provided below plus any conversation context from earlier in this chat. You may also supplement with your own knowledge when the sources are incomplete, but always prioritize and cite the provided documents first.

How to answer:
- Write naturally, like you're explaining to a smart person. Avoid stiff, robotic language.
- Back up claims from the documents with citations like [Source 1] or [Source 3]. Weave them into your sentences naturally.
- If the user's question is a follow-up to something you discussed earlier, use the conversation context to give a coherent response.
- If the documents partially cover the topic, cite what they say and then add your own knowledge clearly marked as general context.
- If the documents don't cover the question at all, you may answer from your own knowledge but clearly state that the response is based on general knowledge rather than the project's documents.
- Keep it concise but complete. No filler, no disclaimers about being an AI.
"""

MAX_HISTORY_MESSAGES = 10  # Keep last N messages for context


@router.post("/projects/{project_id}/sessions", status_code=201, response_model=SessionResponse)
async def create_session(
    project_id: str,
    body: SessionCreate = SessionCreate(),
    db: AsyncSession = Depends(get_db),
):
    """Start a new conversation session in a project."""
    # Verify project exists
    result = await db.execute(select(ProjectModel).where(ProjectModel.id == project_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Project not found")

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
        messages=[],
    )


@router.get("/projects/{project_id}/sessions", response_model=list[SessionResponse])
async def list_sessions(project_id: str, db: AsyncSession = Depends(get_db)):
    """List all conversation sessions for a project."""
    result = await db.execute(
        select(SessionModel)
        .where(SessionModel.project_id == project_id)
        .order_by(SessionModel.created_at.desc())
    )
    sessions = result.scalars().all()
    
    return [
        SessionResponse(
            id=s.id,
            project_id=s.project_id,
            title=s.title,
            created_at=s.created_at,
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
        messages=[
            MessageResponse(
                id=m.id,
                role=m.role,
                content=m.content,
                created_at=m.created_at,
            )
            for m in session.messages
        ],
    )


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
    )
    db.add(assistant_msg)

    # Auto-title on first message
    if len(session.messages) <= 1:
        session.title = body.message[:50] + ("..." if len(body.message) > 50 else "")

    await db.commit()

    return ChatResponse(
        session_id=session.id,
        answer=answer,
        citations=used_citations,
        found_sufficient_info=sufficient,
    )
