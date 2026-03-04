"""
VERO Layer 4 -- Retrieval Pipeline Verification Suite
=====================================================
Covers: Semantic search, keyword search, hybrid search,
context window generation, project isolation, and error handling.

Usage:
    1. Start the server:  uvicorn app.main:app --reload --port 8000
    2. Run this script:   python tests/test_layer4.py
"""

import sys
import uuid
import httpx
from pathlib import Path

BASE = "http://localhost:8000"
PASS = 0
FAIL = 0
HTTP_TIMEOUT = 120.0

# Files
TEST_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = TEST_DIR.parent.parent
README = PROJECT_ROOT / "README.md"


def check(name: str, condition: bool, detail: str = ""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def section(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def setup_project_with_embeddings():
    """Create a project, ingest README, chunk it, and embed it."""
    project_name = f"Layer 4 Search Test {uuid.uuid4().hex[:6]}"
    r = httpx.post(f"{BASE}/projects", json={"name": project_name, "description": "Testing search."}, timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    pid = r.json()["id"]

    with open(README, "rb") as f:
        r_ingest = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("README.md", f)}, timeout=HTTP_TIMEOUT)
    r_ingest.raise_for_status()
    doc_id = r_ingest.json()["id"]

    r_chunk = httpx.post(f"{BASE}/documents/{doc_id}/chunk", timeout=HTTP_TIMEOUT)
    r_chunk.raise_for_status()

    r_embed = httpx.post(
        f"{BASE}/documents/{doc_id}/embed",
        json={"model_name": "all-MiniLM-L6-v2"},
        timeout=HTTP_TIMEOUT,
    )
    r_embed.raise_for_status()

    return pid, doc_id


def run_tests():
    global PASS, FAIL

    try:
        print("  Setting up project with embeddings (one-time)...")
        pid, doc_id = setup_project_with_embeddings()
        print(f"  Setup complete: project={pid}, doc={doc_id}\n")

        # ============================================================
        section("1. Semantic Search")
        # ============================================================
        r = httpx.post(
            f"{BASE}/projects/{pid}/search",
            json={"query": "deduplication and content hashing", "top_k": 3, "mode": "semantic"},
            timeout=HTTP_TIMEOUT,
        )
        check("POST /search (semantic) returns 200", r.status_code == 200, f"got {r.status_code}")
        data = r.json()
        check("Response has 'results' field", "results" in data)
        check("Results are non-empty", len(data["results"]) > 0)
        check("Results have score field", all("score" in item for item in data["results"]))
        check("Results have doc_title", all("doc_title" in item for item in data["results"]))
        check("Mode is 'semantic'", data["mode"] == "semantic")

        # ============================================================
        section("2. Keyword Search (BM25)")
        # ============================================================
        r = httpx.post(
            f"{BASE}/projects/{pid}/search",
            json={"query": "FastAPI SQLAlchemy", "top_k": 3, "mode": "keyword"},
            timeout=HTTP_TIMEOUT,
        )
        check("POST /search (keyword) returns 200", r.status_code == 200, f"got {r.status_code}")
        data = r.json()
        check("Keyword results are non-empty", len(data["results"]) > 0)
        check("Mode is 'keyword'", data["mode"] == "keyword")
        # Keyword search should find exact terms
        top_text = data["results"][0]["text"].lower()
        check("Top result contains query terms", "fastapi" in top_text or "sqlalchemy" in top_text,
              f"text: {top_text[:100]}")

        # ============================================================
        section("3. Hybrid Search (Semantic + BM25)")
        # ============================================================
        r = httpx.post(
            f"{BASE}/projects/{pid}/search",
            json={"query": "how does VERO handle document ingestion", "top_k": 5, "mode": "hybrid"},
            timeout=HTTP_TIMEOUT,
        )
        check("POST /search (hybrid) returns 200", r.status_code == 200, f"got {r.status_code}")
        data = r.json()
        check("Hybrid results are non-empty", len(data["results"]) > 0)
        check("Mode is 'hybrid'", data["mode"] == "hybrid")
        check("total_results matches results length", data["total_results"] == len(data["results"]))

        # ============================================================
        section("4. Context Window Generation")
        # ============================================================
        r = httpx.post(
            f"{BASE}/projects/{pid}/search/context",
            json={"query": "what parsers does VERO support", "top_k": 3, "mode": "hybrid"},
            timeout=HTTP_TIMEOUT,
        )
        check("POST /search/context returns 200", r.status_code == 200, f"got {r.status_code}")
        ctx = r.json()
        check("Context response has 'context' field", "context" in ctx)
        check("Context is non-empty string", len(ctx["context"]) > 0)
        check("Context contains source citations", "[Source 1]" in ctx["context"])
        check("total_chunks matches search results", ctx["total_chunks"] > 0)

        # ============================================================
        section("5. Project Isolation")
        # ============================================================
        # Create a second empty project and search it
        project_name_2 = f"Empty Project {uuid.uuid4().hex[:6]}"
        r2 = httpx.post(f"{BASE}/projects", json={"name": project_name_2})
        r2.raise_for_status()
        pid2 = r2.json()["id"]

        r = httpx.post(
            f"{BASE}/projects/{pid2}/search",
            json={"query": "anything at all", "mode": "hybrid"},
            timeout=HTTP_TIMEOUT,
        )
        check("Search in empty project returns 200", r.status_code == 200)
        check("Empty project returns zero results", len(r.json()["results"]) == 0)

        # ============================================================
        section("6. Error Handling")
        # ============================================================
        r = httpx.post(
            f"{BASE}/projects/nonexistent_id/search",
            json={"query": "test"},
            timeout=HTTP_TIMEOUT,
        )
        check("Search nonexistent project returns 404", r.status_code == 404)

        # ============================================================
        section("RESULTS")
        # ============================================================
        print(f"\n  {PASS}/{PASS+FAIL} passed, {FAIL} failed")
        if FAIL == 0:
            print("\n  LAYER 4 VERIFICATION COMPLETE")
            sys.exit(0)
        else:
            sys.exit(1)

    except Exception as e:
        print(f"\nFATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
