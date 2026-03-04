"""VERO Search Router: Exposes semantic, keyword, and hybrid search endpoints."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import ProjectModel
from app.schema import (
    SearchRequest,
    SearchResponse,
    ContextWindowResponse,
    AnswerRequest,
    GroundedAnswer,
)
from app.retrieval import search, build_context_window
from app.answering import generate_answer

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Search"])


async def _verify_project(project_id: str, db: AsyncSession) -> ProjectModel:
    """Verify a project exists or raise 404."""
    result = await db.execute(
        select(ProjectModel).where(ProjectModel.id == project_id)
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.post("/projects/{project_id}/search", response_model=SearchResponse)
async def search_project(
    project_id: str,
    body: SearchRequest,
    db: AsyncSession = Depends(get_db),
):
    """Search across all embedded documents in a project.

    Supports three modes:
    - **semantic**: Pure vector similarity search (best for conceptual queries).
    - **keyword**: BM25 keyword match (best for exact terms, function names, etc.).
    - **hybrid**: Combines both using Reciprocal Rank Fusion (recommended).
    """
    await _verify_project(project_id, db)

    results = await search(
        db=db,
        project_id=project_id,
        query=body.query,
        top_k=body.top_k,
        mode=body.mode.value,
    )

    return SearchResponse(
        query=body.query,
        mode=body.mode.value,
        total_results=len(results),
        results=results,
    )


@router.post("/projects/{project_id}/search/context", response_model=ContextWindowResponse)
async def search_context(
    project_id: str,
    body: SearchRequest,
    db: AsyncSession = Depends(get_db),
):
    """Search and return a formatted context window for LLM grounding.

    Returns a single text block with source citations, ready to be
    injected into a prompt as context for answer generation.
    """
    await _verify_project(project_id, db)

    results = await search(
        db=db,
        project_id=project_id,
        query=body.query,
        top_k=body.top_k,
        mode=body.mode.value,
    )

    context = build_context_window(body.query, results)

    return ContextWindowResponse(
        query=body.query,
        mode=body.mode.value,
        total_chunks=len(results),
        context=context,
    )


@router.post("/projects/{project_id}/answer", response_model=GroundedAnswer)
async def generate_grounded_answer(
    project_id: str,
    body: AnswerRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate a synthesized answer using an LLM, grounded in search results.

    Performs a hybrid search to find relevant context, then asks the LLM
    to formulate a professional response citing those specific sources.
    Requires GEMINI_API_KEY environment variable.
    """
    await _verify_project(project_id, db)

    results = await search(
        db=db,
        project_id=project_id,
        query=body.query,
        top_k=body.top_k,
        mode=body.mode,  # AnswerRequest takes string, not Enum directly to keep it simple
    )

    answer = await generate_answer(
        query=body.query,
        results=results,
        allow_model_knowledge=body.allow_model_knowledge,
    )
    return answer

