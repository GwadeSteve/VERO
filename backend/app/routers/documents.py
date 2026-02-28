"""
VERO Router — Documents / Ingestion
------------------------------------
The core Layer 1 endpoint: upload a file or URL and turn it into stored text.
Deduplication via SHA-256 hash on normalized text.
"""

import json
import tempfile
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import ProjectModel, DocumentModel
from app.parsers import detect_source_type, parse_file
from app.parsers.web import parse_web
from app.parsers.repo import parse_repo
from app.utils import compute_content_hash
from app.schema import (
    DocumentDetail,
    DocumentSummary,
    ChunkResponse,
    IngestRepoRequest,
    IngestURLRequest,
    SourceType,
    SOURCE_CONFIDENCE,
)

router = APIRouter(tags=["documents"])


async def _verify_project(project_id: str, db: AsyncSession) -> ProjectModel:
    """Helper: ensure the project exists or 404."""
    result = await db.execute(
        select(ProjectModel).where(ProjectModel.id == project_id)
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def _check_duplicate(project_id: str, content_hash: str, db: AsyncSession) -> DocumentModel | None:
    """Check if a document with this hash already exists in the project."""
    result = await db.execute(
        select(DocumentModel).where(
            DocumentModel.project_id == project_id,
            DocumentModel.content_hash == content_hash,
        )
    )
    return result.scalar_one_or_none()


def _to_summary(doc: DocumentModel, is_duplicate: bool = False) -> DocumentSummary:
    """Convert ORM model to API response."""
    return DocumentSummary(
        id=doc.id,
        project_id=doc.project_id,
        source_type=SourceType(doc.source_type),
        title=doc.title,
        char_count=len(doc.raw_text),
        confidence_level=doc.confidence_level,
        content_hash=doc.content_hash,
        is_duplicate=is_duplicate,
        created_at=doc.created_at,
    )


# File upload ingestion

@router.post("/projects/{project_id}/ingest", status_code=201, response_model=DocumentSummary)
async def ingest_file(
    project_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a document file (PDF, DOCX, MD, TXT) and ingest it.
    If the same content already exists in this project, returns the existing doc.
    """
    await _verify_project(project_id, db)

    # Detect source type from filename
    try:
        source_type = detect_source_type(file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Save upload to a temp file, then parse
    tmp_dir = tempfile.mkdtemp()
    tmp_path = Path(tmp_dir) / file.filename
    try:
        with open(tmp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        result = await parse_file(str(tmp_path), source_type)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse file: {e}")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    raw_text = result["text"]
    content_hash = compute_content_hash(raw_text)

    # Dedup check
    existing = await _check_duplicate(project_id, content_hash, db)
    if existing is not None:
        return _to_summary(existing, is_duplicate=True)

    # Store new document
    confidence = SOURCE_CONFIDENCE.get(source_type, 3).value
    doc = DocumentModel(
        project_id=project_id,
        source_type=source_type.value,
        title=file.filename,
        raw_text=raw_text,
        content_hash=content_hash,
        confidence_level=confidence,
        metadata_json=json.dumps(result.get("metadata", {})),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    return _to_summary(doc)


# URL ingestion

@router.post("/projects/{project_id}/ingest-url", status_code=201, response_model=DocumentSummary)
async def ingest_url(
    project_id: str,
    body: IngestURLRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Ingest a web page by URL. Deduplicates by content hash.
    """
    await _verify_project(project_id, db)

    try:
        result = await parse_web(body.url)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to fetch URL: {e}")

    raw_text = result["text"]
    content_hash = compute_content_hash(raw_text)

    # Dedup check
    existing = await _check_duplicate(project_id, content_hash, db)
    if existing is not None:
        return _to_summary(existing, is_duplicate=True)

    title = body.title or result.get("metadata", {}).get("title", body.url)
    confidence = SOURCE_CONFIDENCE[SourceType.WEB].value

    doc = DocumentModel(
        project_id=project_id,
        source_type=SourceType.WEB.value,
        title=title,
        raw_text=raw_text,
        content_hash=content_hash,
        confidence_level=confidence,
        metadata_json=json.dumps(result.get("metadata", {})),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    return _to_summary(doc)


# Repository ingestion

@router.post("/projects/{project_id}/ingest-repo", status_code=201, response_model=DocumentSummary)
async def ingest_repo(
    project_id: str,
    body: IngestRepoRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Ingest a public GitHub repository (README + Python docstrings).
    Deduplicates by content hash.
    """
    await _verify_project(project_id, db)

    try:
        result = await parse_repo(body.repo_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to fetch repo: {e}")

    raw_text = result["text"]
    content_hash = compute_content_hash(raw_text)

    # Dedup check
    existing = await _check_duplicate(project_id, content_hash, db)
    if existing is not None:
        return _to_summary(existing, is_duplicate=True)

    title = body.title or result.get("metadata", {}).get("repo_name", body.repo_url)
    confidence = SOURCE_CONFIDENCE[SourceType.REPO].value

    doc = DocumentModel(
        project_id=project_id,
        source_type=SourceType.REPO.value,
        title=title,
        raw_text=raw_text,
        content_hash=content_hash,
        confidence_level=confidence,
        metadata_json=json.dumps(result.get("metadata", {})),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    return _to_summary(doc)


# List and retrieve documents

@router.get("/projects/{project_id}/documents", response_model=list[DocumentSummary])
async def list_documents(project_id: str, db: AsyncSession = Depends(get_db)):
    """List all documents in a project (without raw text)."""
    await _verify_project(project_id, db)

    result = await db.execute(
        select(DocumentModel)
        .where(DocumentModel.project_id == project_id)
        .order_by(DocumentModel.created_at.desc())
    )
    docs = result.scalars().all()
    return [_to_summary(d) for d in docs]


@router.get("/documents/{doc_id}", response_model=DocumentDetail)
async def get_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single document including its full raw text."""
    result = await db.execute(
        select(DocumentModel).where(DocumentModel.id == doc_id)
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    return DocumentDetail(
        id=doc.id,
        project_id=doc.project_id,
        source_type=SourceType(doc.source_type),
        title=doc.title,
        raw_text=doc.raw_text,
        content_hash=doc.content_hash,
        confidence_level=doc.confidence_level,
        metadata=json.loads(doc.metadata_json) if doc.metadata_json else {},
        created_at=doc.created_at,
    )


# Chunking endpoints

@router.post("/documents/{doc_id}/chunk", status_code=201, response_model=list[ChunkResponse])
async def generate_chunks(
    doc_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Generate chunks for a given document using the SOTA auto-selected strategy based on its SourceType.
    Re-chunking will overwrite existing chunks for the document.
    """
    # 1. Fetch the document
    result = await db.execute(
        select(DocumentModel).where(DocumentModel.id == doc_id)
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    # 2. Delete existing chunks for this document (Reversible Chunking)
    from app.models import ChunkModel
    await db.execute(ChunkModel.__table__.delete().where(ChunkModel.doc_id == doc_id))

    # 3. Get the best chunker for this document type
    from app.chunks import get_chunker_for_source
    chunker = get_chunker_for_source(doc.source_type)

    # 4. Generate chunks
    chunk_responses = chunker.chunk(text=doc.raw_text, doc_id=doc.id, project_id=doc.project_id)
    
    # 5. Store them in the DB
    new_chunks = []
    for cr in chunk_responses:
        c_model = ChunkModel(
            id=cr.id,
            doc_id=cr.doc_id,
            project_id=cr.project_id,
            text=cr.text,
            start_char=cr.start_char,
            end_char=cr.end_char,
            token_count=cr.token_count,
            strategy=cr.strategy,
            metadata_json=json.dumps(cr.metadata)
        )
        new_chunks.append(c_model)
        db.add(c_model)

    await db.commit()

    # 6. Return response
    return chunk_responses


@router.get("/documents/{doc_id}/chunks", response_model=list[ChunkResponse])
async def list_chunks(doc_id: str, db: AsyncSession = Depends(get_db)):
    """Retrieve all chunks for a document to visually verify the strategy works."""
    from app.models import ChunkModel
    
    # Ensure document exists
    result = await db.execute(
        select(DocumentModel).where(DocumentModel.id == doc_id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Document not found")

    # Retrieve chunks
    chunk_result = await db.execute(
        select(ChunkModel).where(ChunkModel.doc_id == doc_id).order_by(ChunkModel.start_char.asc())
    )
    chunks = chunk_result.scalars().all()

    return [
        ChunkResponse(
            id=c.id,
            doc_id=c.doc_id,
            project_id=c.project_id,
            text=c.text,
            start_char=c.start_char,
            end_char=c.end_char,
            token_count=c.token_count,
            strategy=c.strategy,
            metadata=json.loads(c.metadata_json) if c.metadata_json else {}
        )
        for c in chunks
    ]
