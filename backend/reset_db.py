"""Reset the VERO database: drops all tables and recreates them.

Usage: Stop the server first, then run:
    python reset_db.py
"""

import asyncio
import logging
import time

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


async def reset_database():
    """Drop all tables and recreate with the latest schema."""
    import shutil
    from pathlib import Path

    from app.database import Base, engine
    from app.models import (  # noqa: F401
        ChunkModel,
        DocumentModel,
        EmbeddingModel,
        ProjectModel,
        SessionMessageModel,
        SessionModel,
    )

    logger.warning("Dropping ALL tables and recreating with latest schema...")

    # Clean the persisted Chroma database as part of the reset.
    chroma_dir = Path(__file__).parent / "data" / "chromadb"
    if chroma_dir.exists() and chroma_dir.is_dir():
        deleted = False
        last_error: Exception | None = None

        for attempt in range(1, 6):
            try:
                shutil.rmtree(chroma_dir)
                deleted = True
                logger.info("Deleted Chroma database directory: %s", chroma_dir)
                break
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Failed to delete Chroma directory %s on attempt %d/5: %s",
                    chroma_dir,
                    attempt,
                    exc,
                )
                time.sleep(1.0)

        if not deleted:
            raise RuntimeError(
                "Chroma reset failed because the directory is still locked by another process. "
                "Stop the backend server and any Python process using Chroma, then run reset_db.py again."
            ) from last_error
    else:
        logger.info("No Chroma directory found at %s", chroma_dir)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    logger.info("Database reset complete. All tables recreated.")


if __name__ == "__main__":
    asyncio.run(reset_database())
