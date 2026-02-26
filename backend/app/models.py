"""
VERO ORM Models
---------------
SQLAlchemy table definitions mirroring the Layer 0 Pydantic contract.
"""

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
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    created_at = Column(DateTime, default=_utcnow)

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
    metadata_json = Column(Text, default="{}")
    created_at = Column(DateTime, default=_utcnow)

    project = relationship("ProjectModel", back_populates="documents")

    __table_args__ = (
        UniqueConstraint("project_id", "content_hash", name="uq_project_content"),
    )

    def __repr__(self):
        return f"<Document {self.title!r} ({self.source_type})>"
