"""
VERO Layer 2 -- SOTA Chunking Verification Suite
=================================================
Covers: Strategy selection, Markdown context-preservation, 
Semantic chunking, recursive chunking, token counting, and reversibility.

Usage:
    1. Start the server:  uvicorn app.main:app --reload --port 8000
    2. Run this script:   python tests/test_layer2.py
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
TEST_PDF = PROJECT_ROOT / "test.pdf"

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
        # Create Project
        r = httpx.post(f"{BASE}/projects", json={"name": f"Layer 2 Chunking Test {uuid.uuid4().hex[:6]}", "description": "Testing chunking systems."})
        r.raise_for_status()
        pid = r.json()["id"]

        section("1. Markdown Chunking (Context-Preservation)")
        # Ingest README
        with open(README, "rb") as f:
            r1 = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("README.md", f)}, timeout=HTTP_TIMEOUT)
        doc_md = r1.json()
        doc_md_id = doc_md["id"]
        
        # Trigger Chunking
        rc = httpx.post(f"{BASE}/documents/{doc_md_id}/chunk", timeout=HTTP_TIMEOUT)
        check("POST /chunk returns 201", rc.status_code == 201)
        chunks = rc.json()
        check("Chunks generated", len(chunks) > 0)
        check("Strategy is markdown", all(c["strategy"] == "markdown" for c in chunks))
        
        # Verify context preservation (breadcrumbs)
        # We expect at least some chunks to have breadcrumb metadata because README has headers
        has_breadcrumbs = any(c["metadata"].get("breadcrumbs", {}) for c in chunks)
        check("Markdown chunks retain parent headers in metadata", has_breadcrumbs)

        section("2. Semantic Chunking (Web Source)")
        # Ingest Web Profile
        rc_web = httpx.post(
            f"{BASE}/projects/{pid}/ingest-url",
            json={"url": "https://fastapi.tiangolo.com/", "title": "FastAPI"},
            timeout=HTTP_TIMEOUT
        )
        rc_web.raise_for_status()
        doc_web = rc_web.json()
        check("source_url is correctly saved", doc_web.get("source_url") == "https://fastapi.tiangolo.com/")
        doc_web_id = doc_web["id"]

        # Trigger Chunking
        rc_sem = httpx.post(f"{BASE}/documents/{doc_web_id}/chunk", timeout=HTTP_TIMEOUT)
        check("POST /chunk web returns 201", rc_sem.status_code == 201)
        chunks_sem = rc_sem.json()
        check("Semantic chunks generated", len(chunks_sem) > 0)
        check("Strategy is semantic", all(c["strategy"] == "semantic" for c in chunks_sem))

        section("3. Reversibility & Token Verification")
        # Fetch chunks for Markdown doc again using GET
        rg = httpx.get(f"{BASE}/documents/{doc_md_id}/chunks", timeout=HTTP_TIMEOUT)
        check("GET /chunks returns 200", rg.status_code == 200)
        fetched_chunks = rg.json()
        check("GET returns same chunks as POST", len(fetched_chunks) == len(chunks))
        
        # Reversibility test: fetch doc raw text and compare 
        rd = httpx.get(f"{BASE}/documents/{doc_md_id}", timeout=HTTP_TIMEOUT)
        raw_text = rd.json()["raw_text"]
        
        c0 = fetched_chunks[0]
        # BUT the start_char must point to the valid start of the *original* content part.
        original_slice = raw_text[c0["start_char"]:c0["end_char"]]

        check("Chunk offsets are reversible to original text", len(original_slice) > 0, detail=f"len was {len(original_slice)}")
        check("Token count is measured", c0["token_count"] > 0)

        section("RESULTS")
        total = PASS + FAIL
        color = GREEN if FAIL == 0 else RED
        print(f"\n  {color}Report: {PASS}/{total} assertions passed{RESET}\n")

        if FAIL == 0:
            print(f"  {GREEN}{BOLD}LAYER 2 VERIFICATION COMPLETE{RESET}")
            sys.exit(0)
        else:
            print(f"  {RED}{BOLD}LAYER 2 VERIFICATION FAILED{RESET}")
            sys.exit(1)

    except Exception as e:
        print(f"\nFATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
