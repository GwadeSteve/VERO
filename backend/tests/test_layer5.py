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

BASE = "http://127.0.0.1:8000"
PASS = 0
FAIL = 0
HTTP_TIMEOUT = 120.0

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


def wait_for_server():
    """Wait for the server to be ready before running tests."""
    import time
    print("  Checking server health...")
    for i in range(10):
        try:
            r = httpx.get(f"{BASE}/health", timeout=5.0)
            if r.status_code == 200:
                print(f"  Server is healthy.")
                return True
        except Exception:
            pass
        print(f"  Waiting for server... (attempt {i+1}/10)")
        time.sleep(2)
    return False


def setup_project_with_embeddings():
    """Create a project, ingest README, chunk it, and embed it."""
    project_name = f"Layer 5 Answers {uuid.uuid4().hex[:6]}"
    r = httpx.post(
        f"{BASE}/projects",
        json={"name": project_name, "description": "Testing answers."},
        timeout=HTTP_TIMEOUT,
    )
    r.raise_for_status()
    pid = r.json()["id"]

    with open(README, "rb") as f:
        r_ingest = httpx.post(
            f"{BASE}/projects/{pid}/ingest",
            files={"file": ("README.md", f)},
            timeout=HTTP_TIMEOUT,
        )
    r_ingest.raise_for_status()
    doc_id = r_ingest.json()["id"]

    httpx.post(
        f"{BASE}/documents/{doc_id}/chunk",
        timeout=HTTP_TIMEOUT,
    ).raise_for_status()
    
    httpx.post(
        f"{BASE}/documents/{doc_id}/embed",
        json={"model_name": "all-MiniLM-L6-v2"},
        timeout=HTTP_TIMEOUT,
    ).raise_for_status()

    return pid, doc_id


def run_tests():
    global PASS, FAIL
    
    provider = os.environ.get("VERO_LLM_PROVIDER", "groq").lower()
    
    if provider == "groq" and not os.environ.get("GROQ_API_KEY"):
        print("\n  SKIP: GROQ_API_KEY is not set. Layer 5 tests cannot run.")
        print("  To test: set GROQ_API_KEY in .env or export it.")
        sys.exit(0)
    elif provider == "gemini" and not os.environ.get("GEMINI_API_KEY"):
        print("\n  SKIP: GEMINI_API_KEY is not set. Layer 5 tests cannot run.")
        print("  To test: set GEMINI_API_KEY in .env or export it.")
        sys.exit(0)
    
    print(f"  Using LLM provider: {provider}")

    try:
        if not wait_for_server():
            print("\n  FATAL: Server not reachable at", BASE)
            print("  Start it with: uvicorn app.main:app --reload --port 8000")
            sys.exit(1)

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
        if not data_refuse.get("found_sufficient_info") is False:
            print(f"  DEBUG: Refusal Response: {data_refuse}")

        check("found_sufficient_info is False", data_refuse["found_sufficient_info"] is False)
        
        ans_refuse: str = data_refuse["answer"].lower()
        # Different LLMs phrase refusals differently
        refusal_phrases = [
            "cannot answer", "do not know", "don't know",
            "not enough information", "no relevant information",
            "insufficient", "unable to answer", "not found",
            "cannot find", "no information", "not contain",
            "don't have enough", "don't have any relevant",
        ]
        has_refusal = any(phrase in ans_refuse for phrase in refusal_phrases)
        check("Answer contains refusal phrasing", has_refusal, f"Answer: {ans_refuse[:100]}...")

        # ============================================================
        section("RESULTS")
        total = PASS + FAIL
        color = GREEN if FAIL == 0 else RED
        print(f"\n  {color}Report: {PASS}/{total} assertions passed{RESET}\n")

        if FAIL == 0:
            print(f"  {GREEN}{BOLD}LAYER 5 VERIFICATION COMPLETE{RESET}")
            sys.exit(0)
        else:
            print(f"  {RED}{BOLD}LAYER 5 VERIFICATION FAILED{RESET}")
            sys.exit(1)

    except Exception as e:
        print(f"\nFATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
