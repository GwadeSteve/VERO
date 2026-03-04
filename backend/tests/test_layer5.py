"""
VERO Layer 5 -- Grounded Answering System Verification Suite
============================================================
Covers: Synthesized answering, citation reinforcement, and refusal
handling when context is insufficient.

Usage:
    Must set GEMINI_API_KEY environment variable.
    1. Start the server:  uvicorn app.main:app --reload --port 8000
    2. Run this script:   python tests/test_layer5.py
"""

import os
import sys
import uuid
import httpx
from pathlib import Path
from dotenv import load_dotenv

# Load from backend/.env if present
load_dotenv()

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
    project_name = f"Layer 5 Answers {uuid.uuid4().hex[:6]}"
    r = httpx.post(f"{BASE}/projects", json={"name": project_name, "description": "Testing answers."})
    r.raise_for_status()
    pid = r.json()["id"]

    with open(README, "rb") as f:
        r_ingest = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("README.md", f)})
    r_ingest.raise_for_status()
    doc_id = r_ingest.json()["id"]

    httpx.post(f"{BASE}/documents/{doc_id}/chunk").raise_for_status()
    
    httpx.post(
        f"{BASE}/documents/{doc_id}/embed",
        json={"model_name": "all-MiniLM-L6-v2"},
        timeout=HTTP_TIMEOUT,
    ).raise_for_status()

    return pid, doc_id


def run_tests():
    global PASS, FAIL
    
    if not os.environ.get("GEMINI_API_KEY"):
        print("\n  SKIP: GEMINI_API_KEY is not set. Layer 5 tests cannot run.")
        print("  To test: export GEMINI_API_KEY=your_key && python tests/test_layer5.py\n")
        sys.exit(0)

    try:
        print("  Setting up project for LLM tests (one-time)...")
        pid, doc_id = setup_project_with_embeddings()
        print(f"  Setup complete: project={pid}, doc={doc_id}\n")

        # ============================================================
        section("1. Grounded Answer Generation (Positive Test)")
        # ============================================================
        r = httpx.post(
            f"{BASE}/projects/{pid}/answer",
            json={"query": "Does VERO support Python DOCX parsing?", "top_k": 3},
            timeout=HTTP_TIMEOUT, # LLM calls can take a few seconds
        )
        check("POST /answer returns 200", r.status_code == 200, f"got {r.status_code}")
        
        data = r.json()
        if r.status_code != 200 or not data.get("found_sufficient_info"):
            print(f"  DEBUG: Response Body: {data}")

        check("Response has 'answer'", "answer" in data)
        check("Response has 'citations'", "citations" in data)
        check("Response has 'found_sufficient_info'", "found_sufficient_info" in data)
        
        answer: str = data.get("answer", "")
        check("found_sufficient_info is True", data.get("found_sufficient_info") is True, f"Answer: {answer[:100]}...")
        
        ans_lower = answer.lower()
        check("Answer contains affirmative parsing statement", "docx" in ans_lower or "pdf" in ans_lower)
        check("Answer contains source citation format", "[" in ans_lower and "]" in ans_lower)
        
        citations = data.get("citations", [])
        check("Returns >0 citations", len(citations) > 0, f"Got {len(citations)} citations")
        
        # ============================================================
        section("2. Insufficient Context Refusal (Negative Test)")
        # ============================================================
        print("  Testing refusal on out-of-context query (may take a moment)...")
        r_refuse = httpx.post(
            f"{BASE}/projects/{pid}/answer",
            json={"query": "Who won the World Series in 2024?", "top_k": 3},
            timeout=HTTP_TIMEOUT,
        )
        check("POST /answer (refusal) returns 200", r_refuse.status_code == 200)
        
        data_refuse = r_refuse.json()
        check("found_sufficient_info is False", data_refuse["found_sufficient_info"] is False)
        
        ans_refuse: str = data_refuse["answer"].lower()
        check("Answer contains refusal phasing", "cannot answer" in ans_refuse or "do not know" in ans_refuse)

        # ============================================================
        section("RESULTS")
        # ============================================================
        print(f"\n  {PASS}/{PASS+FAIL} passed, {FAIL} failed")
        if FAIL == 0:
            print("\n  LAYER 5 VERIFICATION COMPLETE")
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
