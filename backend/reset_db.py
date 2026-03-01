import asyncio
import logging
import sys
from app.database import init_db

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

async def reset_database():
    """
    Utility script to reset the database schema to the latest version.
    Drops all existing tables and recreates them.
    """
    logger.warning("All data in the local database will be deleted.")
    try:
        await init_db()
        logger.info("Database schema synchronized successfully.")
    except Exception as e:
        logger.error(f"Failed to reset database: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(reset_database())
