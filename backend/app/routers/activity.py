"""
VERO Router — Activity
----------------------
Global metrics and stats for the Discovery & Activity dashboards.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta, timezone
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

@router.get("/timeline")
async def get_timeline(db: AsyncSession = Depends(get_db)):
    """Fetch time-series data for the last 30 days and source type breakdown."""
    now = datetime.now(timezone.utc)
    thirty_days_ago = now - timedelta(days=30)
    
    docs_result = await db.execute(select(DocumentModel.created_at, DocumentModel.source_type, DocumentModel.project_id).where(DocumentModel.created_at >= thirty_days_ago))
    docs = docs_result.all()
    
    msgs_result = await db.execute(select(SessionMessageModel.created_at).where(SessionMessageModel.created_at >= thirty_days_ago))
    msgs = msgs_result.all()

    # Also grab project names so we can return top projects
    projects_result = await db.execute(select(ProjectModel.id, ProjectModel.name))
    project_map = {p.id: p.name for p in projects_result.all()}

    timeline = {}
    for i in range(29, -1, -1):
        d = (now - timedelta(days=i)).strftime('%Y-%m-%d')
        timeline[d] = {"date": d, "documents": 0, "messages": 0}

    source_types = {}
    project_counts = {}

    for (created_at, source_type, pid) in docs:
        if not created_at:
            continue
        d = created_at.strftime('%Y-%m-%d')
        if d in timeline:
            timeline[d]["documents"] += 1
        source_types[source_type] = source_types.get(source_type, 0) + 1
        project_counts[pid] = project_counts.get(pid, 0) + 1

    for (created_at,) in msgs:
        if not created_at:
            continue
        d = created_at.strftime('%Y-%m-%d')
        if d in timeline:
            timeline[d]["messages"] += 1

    timeline_list = list(timeline.values())
    types_list = [{"type": k, "count": v} for k, v in source_types.items()]
    types_list.sort(key=lambda x: x["count"], reverse=True)

    top_projects = [{"name": project_map.get(pid, "Unknown"), "count": v, "project_id": pid} for pid, v in project_counts.items()]
    top_projects.sort(key=lambda x: x["count"], reverse=True)
    top_projects = top_projects[:5]

    return {
        "timeline": timeline_list,
        "source_types": types_list,
        "top_projects": top_projects
    }
