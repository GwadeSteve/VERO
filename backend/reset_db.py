"""Reset the VERO database: drops all tables and recreates them.

Usage: Stop the server first, then run:
    python reset_db.py
"""
import asyncio
import logging
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


async def reset_database():
    """Drop all tables and recreate with the latest schema."""
    from app.database import engine, Base
    from app.models import (  # noqa: F401
        ProjectModel, DocumentModel, ChunkModel, EmbeddingModel,
        SessionModel, SessionMessageModel,
    )

    logger.warning("Dropping ALL tables and recreating with latest schema...")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    logger.info("Database reset complete. All tables recreated.")


if __name__ == "__main__":
    asyncio.run(reset_database())
