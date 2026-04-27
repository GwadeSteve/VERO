"""VERO FastAPI Entry Point: Entry point for the backend server."""

import logging
import os
import warnings
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.database import init_db
from app.routers import activity, chat, documents, projects, search
from app.warmup import get_warmup_status, models_ready, start_model_warmup, stop_model_warmup

logger = logging.getLogger(__name__)

# Load environment variables early.
load_dotenv()

# Must be set before any ML imports to suppress TensorFlow/OneDNN warnings.
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"  # 3 = FATAL only

# Suppress noisy Python-level ML warnings.
warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", category=FutureWarning)
logging.getLogger("tensorflow").setLevel(logging.FATAL)
logging.getLogger("tf_keras").setLevel(logging.FATAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: create DB tables, then warm heavy ML models in the background."""
    await init_db()
    app.state.model_warmup_task = start_model_warmup()
    logger.info("API startup complete. Model warmup continues in the background.")

    yield

    await stop_model_warmup()


app = FastAPI(
    title="VERO",
    description="Personal AI Research Assistant — Grounded answers from your own documents.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(documents.router)
app.include_router(search.router)
app.include_router(chat.router)
app.include_router(activity.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "layer": 6,
        "models": get_warmup_status(),
    }


@app.get("/ready")
async def ready():
    status_code = 200 if models_ready() else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ready" if status_code == 200 else "warming",
            "layer": 6,
            "models": get_warmup_status(),
        },
    )
