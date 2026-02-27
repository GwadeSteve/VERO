"""
VERO Router — Projects
----------------------
CRUD endpoints for managing research projects.
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import ProjectModel, DocumentModel
from app.schema import ProjectCreate, ProjectResponse

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("", status_code=201, response_model=ProjectResponse)
async def create_project(body: ProjectCreate, db: AsyncSession = Depends(get_db)):
    """Create a new research project (knowledge boundary)."""
    project = ProjectModel(name=body.name, description=body.description or "")
    db.add(project)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"Project '{body.name}' already exists")
    await db.refresh(project)
    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        created_at=project.created_at,
        document_count=0,
    )


@router.get("", response_model=list[ProjectResponse])
async def list_projects(db: AsyncSession = Depends(get_db)):
    """List all projects with document counts."""
    stmt = (
        select(
            ProjectModel,
            func.count(DocumentModel.id).label("doc_count"),
        )
        .outerjoin(DocumentModel)
        .group_by(ProjectModel.id)
    )
    results = await db.execute(stmt)
    rows = results.all()

    return [
        ProjectResponse(
            id=proj.id,
            name=proj.name,
            description=proj.description,
            created_at=proj.created_at,
            document_count=doc_count,
        )
        for proj, doc_count in rows
    ]


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single project by ID."""
    stmt = (
        select(
            ProjectModel,
            func.count(DocumentModel.id).label("doc_count"),
        )
        .outerjoin(DocumentModel)
        .where(ProjectModel.id == project_id)
        .group_by(ProjectModel.id)
    )
    result = await db.execute(stmt)
    row = result.first()

    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")

    proj, doc_count = row
    return ProjectResponse(
        id=proj.id,
        name=proj.name,
        description=proj.description,
        created_at=proj.created_at,
        document_count=doc_count,
    )
