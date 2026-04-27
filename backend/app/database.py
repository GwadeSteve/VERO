"""VERO Database Layer: Async SQLAlchemy engine backed by SQLite."""

import os
from pathlib import Path

import sqlalchemy
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

# Store the DB file in backend/data/
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv(
    "VERO_DATABASE_URL",
    f"sqlite+aiosqlite:///{DATA_DIR / 'vero.db'}",
)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args={
        "timeout": 30.0,  # Increase lock timeout for massive background burst writes
        "check_same_thread": False,
    },
)

# Enable WAL (Write-Ahead Logging) at the connection level for concurrent reads/writes
@sqlalchemy.event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, _connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA cache_size=-64000")  # 64MB cache
    cursor.close()

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""
    pass


async def init_db():
    """Create tables if they don't exist (idempotent).

    Uses create_all which only creates missing tables - safe for
    --reload and restarts without losing data.
    Also runs lightweight column migrations for schema evolution.
    """
    async with engine.begin() as conn:
        from app.models import (  # noqa: F401
            ChunkModel,
            DocumentModel,
            EmbeddingModel,
            ProjectModel,
            SessionMessageModel,
            SessionModel,
        )

        await conn.run_sync(Base.metadata.create_all)

        # Lightweight column migrations.
        import sqlalchemy as sa

        # Add updated_at to sessions if missing (added in Phase 20)
        result = await conn.execute(sa.text("PRAGMA table_info(sessions)"))
        columns = [row[1] for row in result.fetchall()]
        if "updated_at" not in columns:
            await conn.execute(sa.text("ALTER TABLE sessions ADD COLUMN updated_at DATETIME"))
            await conn.execute(sa.text("UPDATE sessions SET updated_at = created_at WHERE updated_at IS NULL"))

        # Add citations_json to session_messages if missing (added in Phase 21)
        result_msgs = await conn.execute(sa.text("PRAGMA table_info(session_messages)"))
        columns_msgs = [row[1] for row in result_msgs.fetchall()]
        if "citations_json" not in columns_msgs:
            await conn.execute(sa.text("ALTER TABLE session_messages ADD COLUMN citations_json TEXT DEFAULT '[]'"))

        # Add last_indexed_at to projects if missing (added in Search Upgrade)
        result_projs = await conn.execute(sa.text("PRAGMA table_info(projects)"))
        columns_projs = [row[1] for row in result_projs.fetchall()]
        if "last_indexed_at" not in columns_projs:
            await conn.execute(sa.text("ALTER TABLE projects ADD COLUMN last_indexed_at DATETIME"))

        # Add summary to documents if missing (added in Search Upgrade Phase 2)
        result_docs = await conn.execute(sa.text("PRAGMA table_info(documents)"))
        columns_docs = [row[1] for row in result_docs.fetchall()]
        if "summary" not in columns_docs:
            await conn.execute(sa.text("ALTER TABLE documents ADD COLUMN summary TEXT"))


async def get_db():
    """FastAPI dependency — yields an async session."""
    async with async_session() as session:
        yield session
