"""
VERO Pydantic Schema
--------------------
Layer 0 data contracts + request/response models for the API.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# Enums

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


# Core data contracts

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
    source_url: Optional[str] = None
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


# Request and response models

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = ""


class ProjectResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    created_at: datetime
    updated_at: datetime
    document_count: int = 0


class IngestURLRequest(BaseModel):
    url: str
    title: Optional[str] = None


class IngestRepoRequest(BaseModel):
    repo_url: str
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
    source_url: Optional[str] = None
    is_duplicate: bool = False
    processing_status: str = "pending"
    summary: Optional[str] = None
    created_at: datetime


class GlobalDocumentSummary(DocumentSummary):
    """Summary view including the project name for global grids."""
    project_name: str


class DocumentDetail(BaseModel):
    """Full document including raw text."""
    id: str
    project_id: str
    source_type: SourceType
    title: str
    raw_text: str
    content_hash: str
    confidence_level: int
    source_url: Optional[str] = None
    metadata: Dict[str, Any]
    processing_status: str = "pending"
    created_at: datetime


class ChunkResponse(BaseModel):
    id: str
    doc_id: str
    project_id: str
    text: str
    start_char: int
    end_char: int
    token_count: int
    strategy: str
    metadata: dict

    model_config = {"from_attributes": True}


class EmbedRequest(BaseModel):
    """Optional request body for embedding customization."""
    model_name: str = "all-MiniLM-L6-v2"


class EmbeddingResponse(BaseModel):
    """Response for a single chunk's embedding status."""
    id: str
    chunk_id: str
    model_name: str
    dimension: int
    is_cached: bool = False

    model_config = {"from_attributes": True}


# Layer 4: Search / Retrieval

class SearchMode(str, Enum):
    """Search strategy selector."""
    SEMANTIC = "semantic"   # Vector similarity only
    KEYWORD = "keyword"     # BM25 keyword match only
    HYBRID = "hybrid"       # Weighted combination of both


class SearchRequest(BaseModel):
    """Request body for project-level search."""
    query: str
    top_k: int = Field(default=5, ge=1, le=50)
    mode: SearchMode = SearchMode.HYBRID
    min_score: float = Field(default=0.01, ge=0.0, le=1.0)


class SearchResultItem(BaseModel):
    """A single search result with chunk data, score, and document context."""
    chunk_id: str
    doc_id: str
    text: str
    score: float
    start_char: int
    end_char: int
    strategy: str
    doc_title: str
    source_type: str
    source_url: Optional[str] = None
    confidence_level: int


class SearchResponse(BaseModel):
    """Full search response with results and metadata."""
    query: str
    mode: str
    total_results: int
    results: List[SearchResultItem]


class ContextWindowResponse(BaseModel):
    """Formatted context window ready for LLM injection."""
    query: str
    mode: str
    total_chunks: int
    context: str


class GroundedAnswer(BaseModel):
    answer: str
    citations: List[SearchResultItem]
    found_sufficient_info: bool


class AnswerRequest(BaseModel):
    query: str
    top_k: int = Field(default=5, ge=1, le=50)
    mode: str = "hybrid"
    min_score: float = Field(default=0.01, ge=0.0, le=1.0)
    allow_model_knowledge: bool = False


# Layer 6: Conversation Sessions

class SessionCreate(BaseModel):
    title: Optional[str] = "New Conversation"


class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    citations: List[Dict[str, Any]] = []
    created_at: datetime


class SessionResponse(BaseModel):
    id: str
    project_id: str
    title: str
    created_at: datetime
    updated_at: Optional[datetime] = None
    messages: List[MessageResponse] = []


class ChatRequest(BaseModel):
    message: str
    top_k: int = Field(default=5, ge=1, le=50)
    mode: str = "hybrid"
    min_score: float = Field(default=0.01, ge=0.0, le=1.0)
    allow_model_knowledge: bool = False


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    citations: List[SearchResultItem]
    found_sufficient_info: bool
    thought_steps: List[Dict[str, Any]] = []


class AgentEventResponse(BaseModel):
    """A single event from the ReAct agent, streamed via SSE."""
    type: str  # thinking, tool_call, tool_result, answer, error
    content: str
    metadata: Dict[str, Any] = {}
