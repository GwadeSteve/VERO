"""
VERO Database Layer
-------------------
Async SQLAlchemy engine backed by SQLite for v1.
Swap to PostgreSQL later by changing the URL.
"""

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
    """Drop and recreate all tables (dev-safe for SQLite).

    This ensures the schema always matches the ORM models.
    Will be replaced with Alembic migrations before production.
    """
    async with engine.begin() as conn:
        from app.models import ProjectModel, DocumentModel  # noqa: F401
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    """FastAPI dependency — yields an async session."""
    async with async_session() as session:
        yield session
