"""
VERO Router — Activity
----------------------
Global metrics and stats for the Discovery & Activity dashboards.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.models import ProjectModel, DocumentModel, ChunkModel, SessionModel, SessionMessageModel

router = APIRouter(prefix="/activity", tags=["activity"])


class ActivityMetrics(BaseModel):
    total_projects: int
    total_documents: int
    total_sessions: int
    total_messages: int
    total_tokens_ingested: int


@router.get("/metrics", response_model=ActivityMetrics)
async def get_metrics(db: AsyncSession = Depends(get_db)):
    """Fetch global platform usage metrics."""
    # Count projects
    proj_count = await db.scalar(select(func.count(ProjectModel.id)))
    # Count docs
    doc_count = await db.scalar(select(func.count(DocumentModel.id)))
    # Count sessions
    sess_count = await db.scalar(select(func.count(SessionModel.id)))
    # Count messages
    msg_count = await db.scalar(select(func.count(SessionMessageModel.id)))
    # Sum tokens
    token_sum = await db.scalar(select(func.sum(ChunkModel.token_count))) or 0

    return ActivityMetrics(
        total_projects=proj_count or 0,
        total_documents=doc_count or 0,
        total_sessions=sess_count or 0,
        total_messages=msg_count or 0,
        total_tokens_ingested=token_sum or 0
    )
