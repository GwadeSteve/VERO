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
from app.routers import projects, documents, search, chat


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: create DB tables and pre-warm ML models."""
    import time
    await init_db()

    # Pre-warm ML models so the first request is instant
    t0 = time.time()
    print("\n  [VERO] Pre-warming ML models...")
    from app.embeddings import get_embedder
    get_embedder()
    print("  ✓ Embedder loaded (all-MiniLM-L6-v2)")
    from app.reranker import _get_model as get_reranker
    get_reranker()
    print(f"  ✓ Cross-encoder loaded (ms-marco-MiniLM-L-6-v2)")
    print(f"  ✓ All models ready in {time.time() - t0:.1f}s\n")

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
app.include_router(chat.router)


@app.get("/health")
async def health():
    return {"status": "ok", "layer": 6}
