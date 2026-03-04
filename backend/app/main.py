"""VERO FastAPI Entry Point: Entry point for the backend server."""

import os
import warnings
import logging

# Must be set before ANY ML imports to suppress TensorFlow/OneDNN warnings
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"  # 3 = FATAL only

# Kill Python-level TF deprecation warnings (tf_keras, etc.)
warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", category=FutureWarning)
logging.getLogger("tensorflow").setLevel(logging.FATAL)
logging.getLogger("tf_keras").setLevel(logging.FATAL)

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.routers import projects, documents, search


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: create DB tables. Shutdown: nothing special yet."""
    await init_db()
    yield


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


@app.get("/health")
async def health():
    return {"status": "ok", "layer": 5}
