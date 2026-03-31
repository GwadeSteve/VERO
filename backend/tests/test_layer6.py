"""
VERO Layer 6 -- Conversational Intelligence & Auto-Pipeline
===========================================================
Covers:
1. Auto-Pipeline: Documents auto-process (chunk & embed) upon ingest.
2. Sessions: Creation and listing of multi-turn chat sessions.
3. Chat History: Context is maintained across messages in a session.
4. Message Pair Deletion: Deleting a message removes its Q&A pair.
5. Session Deletion: Full session cleanup.

Usage:
    Must set GROQ_API_KEY (or GEMINI/OLLAMA equivalents) environment variable.
    1. Start the server:  uvicorn app.main:app --reload
    2. Run this script:   python tests/test_layer6.py
"""

import os
import sys
import uuid
import httpx
import time
from pathlib import Path
from dotenv import load_dotenv

# Load from backend/.env if present
load_dotenv()

BASE = "http://127.0.0.1:8000"
PASS = 0
FAIL = 0

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
    print("  Checking server health...")
    for i in range(10):
        try:
            r = httpx.get(f"{BASE}/health", timeout=5.0)
            if r.status_code == 200:
                print(f"  Server is healthy (Layer {r.json().get('layer')}).")
                return True
        except Exception:
            pass
        print(f"  Waiting for server... (attempt {i+1}/10)")
        time.sleep(2)
    return False


def setup_project():
    r = httpx.post(f"{BASE}/projects", json={"name": f"test-layer6-{uuid.uuid4().hex[:6]}"}, timeout=10.0)
    r.raise_for_status()
    project_id = r.json()["id"]
    return project_id


def run_tests():
    if not wait_for_server():
        print("\n  FATAL: Server not reachable at http://localhost:8000")
        print("  Start it with: uvicorn app.main:app --reload")
        sys.exit(1)

    project_id = setup_project()
    print(f"  Setup complete: project={project_id}")

    # ============================================================
    section("1. Auto-Pipeline on Ingest")
    # ============================================================
    with open(README, "rb") as f:
        r_ingest = httpx.post(f"{BASE}/projects/{project_id}/ingest", files={"file": ("README.md", f)}, timeout=10.0)
    
    check("POST /ingest returns 201", r_ingest.status_code == 201)
    
    doc = r_ingest.json()
    doc_id = doc["id"]
    check("Response has initial status processing/pending", doc.get("processing_status") in ["pending", "processing", "parsing"])

    print("  Waiting for background pipeline to complete (max 60s)...", end="", flush=True)
    pipeline_ready = False
    for i in range(60):
        print(".", end="", flush=True)
        try:
            r_status = httpx.get(f"{BASE}/documents/{doc_id}", timeout=15.0)
            status = r_status.json().get("processing_status")
            if status == "ready":
                pipeline_ready = True
                print(" Done!")
                break
            elif status == "failed":
                print(" Failed!")
                break
        except Exception:
            pass  # Connection hiccup during background processing, retry
        time.sleep(1)

    # If loop ended without "ready", do one final check (pipeline may have JUST finished)
    if not pipeline_ready:
        try:
            r_final = httpx.get(f"{BASE}/documents/{doc_id}", timeout=15.0)
            if r_final.json().get("processing_status") == "ready":
                pipeline_ready = True
                print(" Done (late)!")
        except Exception:
            pass
    
    check("Pipeline completed successfully (status='ready')", pipeline_ready)

    # Verify chunks exist without manual call
    r_chunks = httpx.get(f"{BASE}/documents/{doc_id}/chunks", timeout=15.0)
    check("Chunks were auto-generated", len(r_chunks.json()) > 0)
    
    # Verify embeddings exist without manual call
    r_emb = httpx.get(f"{BASE}/documents/{doc_id}/embeddings", timeout=15.0)
    check("Embeddings were auto-generated", len(r_emb.json()) > 0)


    # ============================================================
    section("2. Sessions API")
    # ============================================================
    r_session = httpx.post(f"{BASE}/projects/{project_id}/sessions", json={"title": "Test Session"}, timeout=5.0)
    check("POST /sessions returns 201", r_session.status_code == 201)
    
    session_data = r_session.json()
    session_id = session_data["id"]
    check("Session has ID and title", "id" in session_data and session_data["title"] == "Test Session")
    
    r_list = httpx.get(f"{BASE}/projects/{project_id}/sessions", timeout=5.0)
    check("GET /sessions lists new session", any(s["id"] == session_id for s in r_list.json()))

    # ============================================================
    section("3. Multi-Turn Chat (History & Context)")
    # ============================================================
    # Turn 1: Ask something specific
    print("  Sending Turn 1 (Wait a moment)...")
    r_chat1 = httpx.post(
        f"{BASE}/sessions/{session_id}/chat",
        json={"message": "What is VERO?", "top_k": 3, "mode": "hybrid"},
        timeout=120.0
    )
    check("POST /chat (Turn 1) returns 200", r_chat1.status_code == 200)
    ans1 = r_chat1.json().get("answer", "").lower()
    check("Answer 1 is relevant", "ai" in ans1 or "research" in ans1 or "assistant" in ans1, ans1[:50])
    
    # Turn 2: Follow up with a pronoun (requires history context)
    print("  Sending Turn 2 (Testing history)...")
    r_chat2 = httpx.post(
        f"{BASE}/sessions/{session_id}/chat",
        json={"message": "Can I run it locally?", "top_k": 3, "mode": "hybrid"},
        timeout=120.0
    )
    check("POST /chat (Turn 2) returns 200", r_chat2.status_code == 200)
    ans2 = r_chat2.json().get("answer", "").lower()
    # It should understand "it" refers to VERO and affirm it can be run locally (as per README)
    check("Answer 2 maintains context", "yes" in ans2 or "can" in ans2 or "local" in ans2, ans2[:50])

    # Check session history retrieval
    r_hist = httpx.get(f"{BASE}/sessions/{session_id}", timeout=5.0)
    history = r_hist.json().get("messages", [])
    check("Session history contains 4 messages (2 user, 2 assistant)", len(history) == 4)
    if len(history) >= 4:
        check("History maintains order", history[0]["role"] == "user" and history[1]["role"] == "assistant")

    # ============================================================
    section("4. Message Pair Deletion")
    # ============================================================
    # We have 4 messages: user1, assistant1, user2, assistant2
    # Delete the first user message — its paired assistant response should also be removed
    first_msg_id = history[0]["id"]
    r_del_msg = httpx.delete(f"{BASE}/sessions/{session_id}/messages/{first_msg_id}", timeout=5.0)
    check("DELETE /sessions/{sid}/messages/{mid} returns 204", r_del_msg.status_code == 204)

    r_hist2 = httpx.get(f"{BASE}/sessions/{session_id}", timeout=5.0)
    history2 = r_hist2.json().get("messages", [])
    check("History reduced to 2 messages after pair deletion", len(history2) == 2)

    # The remaining messages should be from Turn 2
    if len(history2) == 2:
        check("Remaining messages are Turn 2 (user then assistant)", 
              history2[0]["role"] == "user" and history2[1]["role"] == "assistant")

    # Try deleting a non-existent message
    r_del_404 = httpx.delete(f"{BASE}/sessions/{session_id}/messages/nonexistent-id", timeout=5.0)
    check("DELETE non-existent message returns 404", r_del_404.status_code == 404)

    # ============================================================
    section("5. Session Deletion")
    # ============================================================
    r_del = httpx.delete(f"{BASE}/sessions/{session_id}", timeout=5.0)
    check("DELETE /sessions/{id} returns 204", r_del.status_code == 204)

    r_verify_del = httpx.get(f"{BASE}/sessions/{session_id}", timeout=5.0)
    check("GET deleted session returns 404", r_verify_del.status_code == 404)

    # ============================================================
    section("RESULTS")
    total = PASS + FAIL
    color = GREEN if FAIL == 0 else RED
    print(f"\n  {color}Report: {PASS}/{total} assertions passed{RESET}\n")
    
    if FAIL > 0:
        print(f"  {RED}{BOLD}LAYER 6 VERIFICATION FAILED{RESET}")
        sys.exit(1)
    else:
        print(f"  {GREEN}{BOLD}LAYER 6 VERIFICATION COMPLETE{RESET}")

if __name__ == "__main__":
    run_tests()
