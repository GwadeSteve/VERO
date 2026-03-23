"""VERO ORM Models: SQLAlchemy table definitions for the core domain."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ProjectModel(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=_new_id)
    name = Column(String, nullable=False, unique=True)
    description = Column(Text, default="")
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    last_indexed_at = Column(DateTime, nullable=True)

    documents = relationship("DocumentModel", back_populates="project", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Project {self.name!r}>"


class DocumentModel(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True, default=_new_id)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    source_type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    raw_text = Column(Text, nullable=False)
    content_hash = Column(String(64), nullable=False, index=True)
    confidence_level = Column(Integer, nullable=False, default=3)
    source_url = Column(String, nullable=True)
    metadata_json = Column(Text, default="{}")
    summary = Column(Text, nullable=True)
    processing_status = Column(String, nullable=False, default="pending")  # pending → processing → ready → failed
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    project = relationship("ProjectModel", back_populates="documents")
    chunks = relationship("ChunkModel", back_populates="document", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("project_id", "content_hash", name="uq_project_content"),
    )

    def __repr__(self):
        return f"<Document {self.title!r} ({self.source_type})>"


class ChunkModel(Base):
    __tablename__ = "chunks"

    id = Column(String, primary_key=True, default=_new_id)
    doc_id = Column(String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    text = Column(Text, nullable=False)
    start_char = Column(Integer, nullable=False)
    end_char = Column(Integer, nullable=False)
    token_count = Column(Integer, nullable=False)
    strategy = Column(String, nullable=False)
    metadata_json = Column(Text, default="{}")
    created_at = Column(DateTime, default=_utcnow)

    document = relationship("DocumentModel", back_populates="chunks")

    def __repr__(self):
        return f"<Chunk {self.id} strategy={self.strategy}>"


class EmbeddingModel(Base):
    __tablename__ = "embeddings"

    id = Column(String, primary_key=True, default=_new_id)
    chunk_id = Column(String, ForeignKey("chunks.id", ondelete="CASCADE"), nullable=False)
    model_name = Column(String, nullable=False)
    dimension = Column(Integer, nullable=False)
    content_hash = Column(String(64), nullable=False)
    created_at = Column(DateTime, default=_utcnow)

    chunk = relationship("ChunkModel")

    __table_args__ = (
        UniqueConstraint("chunk_id", "model_name", name="uq_chunk_model"),
    )

    def __repr__(self):
        return f"<Embedding chunk={self.chunk_id} model={self.model_name}>"


class SessionModel(Base):
    __tablename__ = "sessions"

    id = Column(String, primary_key=True, default=_new_id)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, default="New Conversation")
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    project = relationship("ProjectModel")
    messages = relationship("SessionMessageModel", back_populates="session", cascade="all, delete-orphan", order_by="SessionMessageModel.created_at")

    def __repr__(self):
        return f"<Session {self.id} project={self.project_id}>"


class SessionMessageModel(Base):
    __tablename__ = "session_messages"

    id = Column(String, primary_key=True, default=_new_id)
    session_id = Column(String, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    role = Column(String, nullable=False)  # "user" or "assistant"
    content = Column(Text, nullable=False)
    citations_json = Column(Text, default="[]")
    created_at = Column(DateTime, default=_utcnow)

    session = relationship("SessionModel", back_populates="messages")

    def __repr__(self):
        return f"<Message {self.role} in session={self.session_id}>"
