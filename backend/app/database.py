"""VERO Database Layer: Async SQLAlchemy engine backed by SQLite."""

import os
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

# Store the DB file in backend/data/
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv(
    "VERO_DATABASE_URL",
    f"sqlite+aiosqlite:///{DATA_DIR / 'vero.db'}",
)

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""
    pass


async def init_db():
    """Create tables if they don't exist (idempotent).

    Uses create_all which only creates missing tables — safe for
    --reload and restarts without losing data.
    Also runs lightweight column migrations for schema evolution.
    """
    async with engine.begin() as conn:
        from app.models import ProjectModel, DocumentModel, ChunkModel, EmbeddingModel, SessionModel, SessionMessageModel  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)

        # ── Lightweight column migrations ──
        # Add updated_at to sessions if missing (added in Phase 20)
        import sqlalchemy as sa
        result = await conn.execute(sa.text("PRAGMA table_info(sessions)"))
        columns = [row[1] for row in result.fetchall()]
        if "updated_at" not in columns:
            await conn.execute(sa.text("ALTER TABLE sessions ADD COLUMN updated_at DATETIME"))
            await conn.execute(sa.text("UPDATE sessions SET updated_at = created_at WHERE updated_at IS NULL"))


async def get_db():
    """FastAPI dependency — yields an async session."""
    async with async_session() as session:
        yield session
