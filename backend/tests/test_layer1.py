"""
VERO Layer 1 -- Comprehensive Verification Suite
=================================================
Covers: Projects, File Ingestion, URL Ingestion, Repo Ingestion,
        Deduplication, Confidence Levels, Error Handling.

Usage:
    1. Start the server:  uvicorn app.main:app --reload --port 8000
    2. Run this script:   python tests/test_layer1.py

The script exits with code 0 if all tests pass, 1 otherwise.
"""

import sys
import uuid
from pathlib import Path
import httpx

# Professional Logging Utilities
GREEN = "\033[32m"
RED = "\033[31m"
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"

BASE = "http://localhost:8000"
HTTP_TIMEOUT = 120.0

# Resolve paths relative to repo root (works on Windows and Linux CI)
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
README = REPO_ROOT / "README.md"
FRAMEWORK = REPO_ROOT / "Framework.md"

PASS = 0
FAIL = 0


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
        # 1. Health check
        section("1. Health Check")
        r = httpx.get(f"{BASE}/health", timeout=HTTP_TIMEOUT)
        check("GET /health returns 200", r.status_code == 200)

        # 2. Projects
        section("2. Projects")
        project_name = f"Layer1 Full Test {uuid.uuid4().hex[:6]}"
        r = httpx.post(f"{BASE}/projects", json={"name": project_name, "description": "Comprehensive test"}, timeout=HTTP_TIMEOUT)
        check("POST /projects returns 201", r.status_code == 201)
        proj = r.json()
        pid = proj["id"]
        check("Project has id", bool(pid))
        check("Project has name", proj["name"] == project_name)

        # Duplicate project name
        r_dup = httpx.post(f"{BASE}/projects", json={"name": project_name}, timeout=HTTP_TIMEOUT)
        check("Duplicate project name returns 409", r_dup.status_code == 409)

        # List projects
        r_list = httpx.get(f"{BASE}/projects", timeout=HTTP_TIMEOUT)
        check("GET /projects returns 200", r_list.status_code == 200)
        check("Projects list is non-empty", len(r_list.json()) >= 1)

        # Get single project
        r_get = httpx.get(f"{BASE}/projects/{pid}", timeout=HTTP_TIMEOUT)
        check("GET /projects/{id} returns 200", r_get.status_code == 200)
        check("Project id matches", r_get.json()["id"] == pid)

        # Invalid project
        r_bad = httpx.get(f"{BASE}/projects/nonexistent")
        check("GET nonexistent project returns 404", r_bad.status_code == 404)

        # 3. File ingestion (Markdown)
        section("3. File Ingestion (Markdown)")
        with open(README, "rb") as f:
            r1 = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("README.md", f)}, timeout=HTTP_TIMEOUT)
        check("Ingest README returns 201", r1.status_code == 201)
        d1 = r1.json()
        check("source_type is markdown", d1["source_type"] == "markdown")
        check("confidence_level is 3 (HIGH)", d1["confidence_level"] == 3)
        check("is_duplicate is False", d1["is_duplicate"] is False)
        check("content_hash is present", len(d1.get("content_hash", "")) == 64)
        check("char_count > 0", d1["char_count"] > 0)

        # Ingest a second different file
        with open(FRAMEWORK, "rb") as f:
            r_fw = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("Framework.md", f)}, timeout=HTTP_TIMEOUT)
        check("Ingest Framework.md returns 201", r_fw.status_code == 201)
        d2 = r_fw.json()
        check("Framework is not duplicate", d2["is_duplicate"] is False)
        check("Framework has different id", d2["id"] != d1["id"])
        check("Framework has different hash", d2["content_hash"] != d1["content_hash"])

        # 4. Deduplication
        section("4. Deduplication")
        with open(README, "rb") as f:
            r_dup = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("README.md", f)}, timeout=HTTP_TIMEOUT)
        check("Re-ingest README returns 201", r_dup.status_code == 201)
        d_dup = r_dup.json()
        check("is_duplicate is True", d_dup["is_duplicate"] is True)
        check("Returns same document id", d_dup["id"] == d1["id"])
        check("Returns same content_hash", d_dup["content_hash"] == d1["content_hash"])

        # 5. Document listing and detail
        section("5. Document Listing and Detail")
        r_docs = httpx.get(f"{BASE}/projects/{pid}/documents", timeout=HTTP_TIMEOUT)
        check("GET /documents returns 200", r_docs.status_code == 200)
        docs = r_docs.json()
        check("Document count is 2 (README + Framework)", len(docs) == 2)

        r_det = httpx.get(f"{BASE}/documents/{d1['id']}", timeout=HTTP_TIMEOUT)
        check("GET /documents/{id} returns 200", r_det.status_code == 200)
        det = r_det.json()
        check("Detail has raw_text", "raw_text" in det)
        check("Detail has content_hash", det["content_hash"] == d1["content_hash"])
        check("Detail has metadata dict", isinstance(det["metadata"], dict))
        check("Detail confidence matches", det["confidence_level"] == d1["confidence_level"])

        r_non = httpx.get(f"{BASE}/documents/999999")
        check("GET nonexistent document returns 404", r_non.status_code == 404)

        # 6. URL ingestion
        section("6. URL Ingestion")
        url = "https://fastapi.tiangolo.com/"
        r_u = httpx.post(f"{BASE}/projects/{pid}/ingest-url", json={"url": url, "title": "FastAPI Docs"}, timeout=HTTP_TIMEOUT)
        check("Ingest URL returns 201", r_u.status_code == 201 or r_u.status_code == 200)
        du = r_u.json()
        check("source_type is web", du["source_type"] == "web")
        check("confidence_level is 2 (MEDIUM)", du["confidence_level"] == 2)
        check("URL doc has content", du["char_count"] > 100)
        check("source_url is correctly saved", du["source_url"] == url)

        # Re-ingest same URL
        r_u2 = httpx.post(f"{BASE}/projects/{pid}/ingest-url", json={"url": url}, timeout=HTTP_TIMEOUT)
        check("Re-ingest same URL is duplicate", r_u2.json()["is_duplicate"] is True)

        # 7. Repo ingestion
        section("7. Repo Ingestion (GitHub)")
        repo = "https://github.com/GwadeSteve/VERO"
        r_rep = httpx.post(f"{BASE}/projects/{pid}/ingest-repo", json={"repo_url": repo}, timeout=HTTP_TIMEOUT)
        check("Ingest repo returns 201", r_rep.status_code == 201)
        dr = r_rep.json()
        check("source_type is repository", dr["source_type"] == "repository")
        check("confidence_level is 2 (MEDIUM)", dr["confidence_level"] == 2)
        check("Repo doc has content", dr["char_count"] > 100)
        check("source_url is correctly saved", dr["source_url"] == repo)

        # Re-ingest same repo
        r_rep2 = httpx.post(f"{BASE}/projects/{pid}/ingest-repo", json={"repo_url": repo}, timeout=HTTP_TIMEOUT)
        check("Re-ingest same repo is duplicate", r_rep2.json()["is_duplicate"] is True)

        # Invalid repo
        r_badr = httpx.post(f"{BASE}/projects/{pid}/ingest-repo", json={"repo_url": "not-a-repo"})
        check("Invalid repo URL returns 400", r_badr.status_code == 400)

        # 8. Error handling
        section("8. Error Handling")
        r_bad_pid = httpx.post(f"{BASE}/projects/999/ingest", files={"file": ("test.txt", b"content")}, timeout=HTTP_TIMEOUT)
        check("Ingest to nonexistent project returns 404", r_bad_pid.status_code == 404)

        r_ext = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("test.exe", b"binary content")})
        check("Unsupported file extension returns 400", r_ext.status_code == 400)

        r_empty = httpx.post(f"{BASE}/projects", json={})
        check("Empty project body returns 422", r_empty.status_code == 422)

        # 9. Cross-project isolation
        section("9. Cross-Project Isolation")
        p2_name = f"Isolation Test {uuid.uuid4().hex[:6]}"
        r_p2 = httpx.post(f"{BASE}/projects", json={"name": p2_name}, timeout=HTTP_TIMEOUT)
        pid2 = r_p2.json()["id"]

        try:
            with open(README, "rb") as f:
                r_iso = httpx.post(f"{BASE}/projects/{pid2}/ingest", files={"file": ("README.md", f)}, timeout=HTTP_TIMEOUT)
            d_iso = r_iso.json()
            check("Same file in different project is NOT duplicate", d_iso["is_duplicate"] is False)
            
            r_cnt = httpx.get(f"{BASE}/projects/{pid2}/documents", timeout=HTTP_TIMEOUT)
            check("Second project has exactly 1 doc", len(r_cnt.json()) == 1)
        except Exception as e:
            FAIL += 2
            print(f"  FAIL  Cross-project isolation tests failed: {e}")

        # Summary
        section("RESULTS")
        total = PASS + FAIL
        color = GREEN if FAIL == 0 else RED
        print(f"\n  {color}Report: {PASS}/{total} assertions passed{RESET}\n")

        if FAIL > 0:
            print(f"  {RED}{BOLD}LAYER 1 VERIFICATION FAILED{RESET}")
            sys.exit(1)
        else:
            print(f"  {GREEN}{BOLD}LAYER 1 VERIFICATION COMPLETE{RESET}")
            sys.exit(0)

    except Exception as e:
        print(f"\n{RED}FATAL ERROR: {e}{RESET}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
