"""
VERO Layer 3 -- Versioned Vector Embeddings Verification Suite
==============================================================
Covers: Embedding generation, dimension validation, versioning/caching,
ChromaDB storage, and embedding metadata retrieval.

Usage:
    1. Start the server:  uvicorn app.main:app --reload --port 8000
    2. Run this script:   python tests/test_layer3.py
"""

import sys
import uuid
import httpx
from pathlib import Path

BASE = "http://localhost:8000"
PASS = 0
FAIL = 0
HTTP_TIMEOUT = 120.0  # Embedding may take longer on first run (model download)

# Files
TEST_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = TEST_DIR.parent.parent
README = PROJECT_ROOT / "README.md"


# Professional Logging Utilities
GREEN = "\033[32m"
RED = "\033[31m"
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"

def check(name: str, condition: bool, detail: str = ""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  {GREEN}✓{RESET} {name}")
    else:
        FAIL += 1
        print(f"  {RED}✗{RESET} {name} {DIM}({detail}){RESET}")

def section(title: str):
    print(f"\n{BOLD}{title.upper()}{RESET}")
    print(f"{DIM}{'─' * 40}{RESET}")


def run_tests():
    global PASS, FAIL

    try:
        # Setup: Create project, ingest, and chunk a document
        project_name = f"Layer 3 Embedding Test {uuid.uuid4().hex[:6]}"
        r = httpx.post(f"{BASE}/projects", json={"name": project_name, "description": "Testing embeddings."})
        r.raise_for_status()
        pid = r.json()["id"]

        # Ingest README
        with open(README, "rb") as f:
            r_ingest = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("README.md", f)})
        r_ingest.raise_for_status()
        doc_id = r_ingest.json()["id"]

        # Wait for the background auto_pipeline to finish its first run
        # otherwise it will overwrite our manual chunks/embeddings in Step 1/2
        print(f"  Waiting for background pipeline to finish for {doc_id}...")
        import time
        for i in range(20):
            r_status = httpx.get(f"{BASE}/documents/{doc_id}")
            if r_status.json().get("processing_status") == "ready":
                print(f"  Pipeline ready ({i*2}s)")
                break
            time.sleep(2)

        # Generate chunks first (Layer 2 prerequisite)
        r_chunk = httpx.post(f"{BASE}/documents/{doc_id}/chunk", timeout=HTTP_TIMEOUT)
        r_chunk.raise_for_status()
        chunks = r_chunk.json()
        num_chunks = len(chunks)
        print(f"  Setup complete: {num_chunks} chunks generated.\n")

        # ============================================================
        section("1. Embedding Generation")
        # ============================================================
        r_embed = httpx.post(
            f"{BASE}/documents/{doc_id}/embed",
            json={"model_name": "all-MiniLM-L6-v2"},
            timeout=HTTP_TIMEOUT,
        )
        check("POST /embed returns 201", r_embed.status_code == 201, f"got {r_embed.status_code}")
        embeddings = r_embed.json()
        check("Embeddings generated for all chunks", len(embeddings) == num_chunks,
              f"expected {num_chunks}, got {len(embeddings)}")
        check("All embeddings have correct dimension (384)", all(e["dimension"] == 384 for e in embeddings))
        check("All embeddings marked as not cached (first run)", all(e["is_cached"] is False for e in embeddings))
        check("Model name is all-MiniLM-L6-v2", all(e["model_name"] == "all-MiniLM-L6-v2" for e in embeddings))

        # ============================================================
        section("2. Versioning / Cache Verification")
        # ============================================================
        r_embed2 = httpx.post(
            f"{BASE}/documents/{doc_id}/embed",
            json={"model_name": "all-MiniLM-L6-v2"},
            timeout=HTTP_TIMEOUT,
        )
        check("POST /embed (re-run) returns 201", r_embed2.status_code == 201)
        embeddings2 = r_embed2.json()
        check("Same number of embeddings returned", len(embeddings2) == num_chunks)
        check("All embeddings marked as cached (no recomputation)", all(e["is_cached"] is True for e in embeddings2))

        # ============================================================
        section("3. Embedding Metadata Retrieval")
        # ============================================================
        r_meta = httpx.get(f"{BASE}/documents/{doc_id}/embeddings")
        check("GET /embeddings returns 200", r_meta.status_code == 200)
        meta = r_meta.json()
        check("Metadata count matches chunk count", len(meta) == num_chunks)
        check("Metadata contains correct model name", all(e["model_name"] == "all-MiniLM-L6-v2" for e in meta))

        # ============================================================
        section("4. Error Handling")
        # ============================================================
        # Embed without chunks
        r_no_chunks = httpx.post(
            f"{BASE}/documents/nonexistent_id/embed",
            json={"model_name": "all-MiniLM-L6-v2"},
            timeout=HTTP_TIMEOUT,
        )
        check("Embed nonexistent doc returns 404", r_no_chunks.status_code == 404)

        # Invalid model name
        r_bad_model = httpx.post(
            f"{BASE}/documents/{doc_id}/embed",
            json={"model_name": "invalid-model-xyz"},
            timeout=HTTP_TIMEOUT,
        )
        check("Invalid model name returns 400", r_bad_model.status_code == 400)

        # ============================================================
        section("RESULTS")
        total = PASS + FAIL
        color = GREEN if FAIL == 0 else RED
        print(f"\n  {color}Report: {PASS}/{total} assertions passed{RESET}\n")

        if FAIL == 0:
            print(f"  {GREEN}{BOLD}LAYER 3 VERIFICATION COMPLETE{RESET}")
            sys.exit(0)
        else:
            print(f"  {RED}{BOLD}LAYER 3 VERIFICATION FAILED{RESET}")
            sys.exit(1)

    except Exception as e:
        print(f"\nFATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
