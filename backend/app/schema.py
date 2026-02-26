"""
VERO Pydantic Schema
--------------------
Layer 0 data contracts + request/response models for the API.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ─── Enums ────────────────────────────────────────────────────────────────────

class SourceType(str, Enum):
    PDF = "pdf"
    DOCX = "docx"
    MARKDOWN = "markdown"
    TEXT = "text"
    REPO = "repository"
    WEB = "web"


class ConfidenceLevel(int, Enum):
    """How trustworthy the text extraction is."""
    HIGH = 3    # Native PDF, DOCX, Markdown
    MEDIUM = 2  # Clean web article
    LOW = 1     # OCR, scanned, image-based


# Automatic confidence mapping by source type
SOURCE_CONFIDENCE = {
    SourceType.PDF: ConfidenceLevel.HIGH,
    SourceType.DOCX: ConfidenceLevel.HIGH,
    SourceType.MARKDOWN: ConfidenceLevel.HIGH,
    SourceType.TEXT: ConfidenceLevel.HIGH,
    SourceType.WEB: ConfidenceLevel.MEDIUM,
    SourceType.REPO: ConfidenceLevel.MEDIUM,
}


# ─── Layer 0: Core Data Contracts ─────────────────────────────────────────────

class Project(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Document(BaseModel):
    id: str
    project_id: str
    source_type: SourceType
    title: str
    raw_text: str
    content_hash: str
    confidence_level: int
    metadata: Dict[str, Any] = {}
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Chunk(BaseModel):
    id: str
    doc_id: str
    project_id: str
    text: str
    start_offset: int
    end_offset: int
    strategy: str
    metadata: Dict[str, Any] = {}


class Embedding(BaseModel):
    chunk_id: str
    vector: List[float]
    model_name: str
    dimension: int
    version: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class RetrievalResult(BaseModel):
    chunk: Chunk
    score: float
    doc_metadata: Dict[str, Any]


class GroundedAnswer(BaseModel):
    answer: str
    citations: List[str]
    found_sufficient_info: bool


# ─── Request / Response Models (Layer 1 API) ──────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = ""


class ProjectResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    created_at: datetime
    document_count: int = 0


class IngestURLRequest(BaseModel):
    url: str
    title: Optional[str] = None


class DocumentSummary(BaseModel):
    """Lightweight view for list endpoints (no raw_text)."""
    id: str
    project_id: str
    source_type: SourceType
    title: str
    char_count: int
    confidence_level: int
    content_hash: str
    is_duplicate: bool = False
    created_at: datetime


class DocumentDetail(BaseModel):
    """Full document including raw text."""
    id: str
    project_id: str
    source_type: SourceType
    title: str
    raw_text: str
    content_hash: str
    confidence_level: int
    metadata: Dict[str, Any]
    created_at: datetime
