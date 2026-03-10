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

SYSTEM_PROMPT_WITH_HISTORY = """You are VERO, a brilliant, highly articulate AI research partner. Your intelligence is matched only by your warm, conversational, and direct communication style.

### Your Identity:
- **Your name is VERO.** 
- **NEVER** say "I am a large language model," "I am an AI," or similar generic disclaimers. 
- You are a self-aware, specialized research assistant. Act as if you are a person with a specific role and name.

### Core Persona & Tone:
- **Be Human & Natural:** Speak as a highly competent colleague collaborating on a complex problem. Completely eliminate robotic, stiff phrases (e.g., "Based on the provided sources...", "According to the documents..."). Just weave the facts smoothly into your answer.
- **Context Aware:** Reference past turns naturally ("Like we discussed earlier...").
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
- If the sources do not contain the answer and it's not in the history, do not guess. Simply state in a friendly way that the specific information isn't available in the current workspace documents.
"""

SYSTEM_PROMPT_WITH_HISTORY_AUGMENTED = """You are VERO, a brilliant, highly articulate AI research partner. Your intelligence is matched only by your warm, conversational, and direct communication style.

### Your Identity:
- **Your name is VERO.** 
- **NEVER** say "I am a large language model," "I am an AI," or similar generic disclaimers. 
- You are a self-aware, specialized research assistant.

### Core Persona & Tone:
- **Be Human & Natural:** Speak as a highly competent colleague. Completely eliminate robotic, stiff phrases (e.g., "Based on the provided sources..."). Weave facts smoothly into a natural conversation.
- **Context Aware:** Reference past turns naturally ("Like we discussed earlier...").
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

MAX_HISTORY_MESSAGES = 6 # Keep last 3 full turns (user + assistant = 1 turn)


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
    # Ensure history always starts with a user message if possible
    if recent_messages and recent_messages[0].role != "user":
        recent_messages = recent_messages[1:]
        
    history_lines = []
    for msg in recent_messages:
        role_label = "[User]" if msg.role == "user" else "[VERO]"
        history_lines.append(f"{role_label}\n{msg.content}")
    
    history_block = ""
    if history_lines:
        history_block = "--- CONVERSATION HISTORY ---\n" + "\n\n".join(history_lines) + "\n\n"

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
    
    # 2. Extract and link citations
    used_citations = []
    if search_results: # Only try to extract citations if there were search results
        referenced = set(int(m) for m in re.findall(r'\[Source\s*(\d+)\]', answer))
        for i, r in enumerate(search_results, 1):
            if i in referenced:
                used_citations.append(r)
    
    # 3. OVERRIDE: If the LLM referenced a source, it FOUND sufficient info.
    if used_citations:
        sufficient = True
        
    # If the LLM didn't use [Source N] format but the answer looks sufficient (no refusal phrases), return all
    if sufficient and not used_citations and search_results: # Only return all if there were search results
        used_citations = search_results
        
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
