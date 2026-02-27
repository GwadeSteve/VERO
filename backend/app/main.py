"""VERO FastAPI Entry Point: Entry point for the backend server."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.routers import projects, documents


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


@app.get("/health")
async def health():
    return {"status": "ok", "layer": 1}
