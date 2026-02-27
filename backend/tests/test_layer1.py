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
import httpx

BASE = "http://localhost:8000"
PASS = 0
FAIL = 0


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


# ── 1. Health Check ──────────────────────────────────────────────────────────

section("1. Health Check")
r = httpx.get(f"{BASE}/health")
check("GET /health returns 200", r.status_code == 200)


# ── 2. Projects ──────────────────────────────────────────────────────────────

section("2. Projects")

r = httpx.post(f"{BASE}/projects", json={"name": "Layer1 Full Test", "description": "Comprehensive test"})
check("POST /projects returns 201", r.status_code == 201)
proj = r.json()
pid = proj["id"]
check("Project has id", bool(pid))
check("Project has name", proj["name"] == "Layer1 Full Test")

# Duplicate project name
r_dup = httpx.post(f"{BASE}/projects", json={"name": "Layer1 Full Test"})
check("Duplicate project name returns 409", r_dup.status_code == 409)

# List projects
r_list = httpx.get(f"{BASE}/projects")
check("GET /projects returns 200", r_list.status_code == 200)
check("Projects list is non-empty", len(r_list.json()) >= 1)

# Get single project
r_get = httpx.get(f"{BASE}/projects/{pid}")
check("GET /projects/{id} returns 200", r_get.status_code == 200)
check("Project id matches", r_get.json()["id"] == pid)

# Invalid project
r_bad = httpx.get(f"{BASE}/projects/nonexistent")
check("GET nonexistent project returns 404", r_bad.status_code == 404)


# ── 3. File Ingestion (Markdown) ─────────────────────────────────────────────

section("3. File Ingestion (Markdown)")

with open("a:/AI-Searcher/README.md", "rb") as f:
    r1 = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("README.md", f)})
check("Ingest README returns 201", r1.status_code == 201)
d1 = r1.json()
check("source_type is markdown", d1["source_type"] == "markdown")
check("confidence_level is 3 (HIGH)", d1["confidence_level"] == 3)
check("is_duplicate is False", d1["is_duplicate"] is False)
check("content_hash is present", len(d1.get("content_hash", "")) == 64)
check("char_count > 0", d1["char_count"] > 0)

# Ingest a second different file
with open("a:/AI-Searcher/Framework.md", "rb") as f:
    r_fw = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("Framework.md", f)})
check("Ingest Framework.md returns 201", r_fw.status_code == 201)
d_fw = r_fw.json()
check("Framework is not duplicate", d_fw["is_duplicate"] is False)
check("Framework has different id", d_fw["id"] != d1["id"])
check("Framework has different hash", d_fw["content_hash"] != d1["content_hash"])


# ── 4. Deduplication ─────────────────────────────────────────────────────────

section("4. Deduplication")

with open("a:/AI-Searcher/README.md", "rb") as f:
    r2 = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("README.md", f)})
check("Re-ingest README returns 201", r2.status_code == 201)
d2 = r2.json()
check("is_duplicate is True", d2["is_duplicate"] is True)
check("Returns same document id", d2["id"] == d1["id"])
check("Returns same content_hash", d2["content_hash"] == d1["content_hash"])


# ── 5. Document Listing and Detail ───────────────────────────────────────────

section("5. Document Listing and Detail")

r_docs = httpx.get(f"{BASE}/projects/{pid}/documents")
check("GET /documents returns 200", r_docs.status_code == 200)
docs = r_docs.json()
check("Document count is 2 (README + Framework)", len(docs) == 2)

r_detail = httpx.get(f"{BASE}/documents/{d1['id']}")
check("GET /documents/{id} returns 200", r_detail.status_code == 200)
det = r_detail.json()
check("Detail has raw_text", len(det.get("raw_text", "")) > 0)
check("Detail has content_hash", len(det.get("content_hash", "")) == 64)
check("Detail has metadata dict", isinstance(det.get("metadata"), dict))
check("Detail confidence matches", det["confidence_level"] == 3)

# Nonexistent document
r_bad_doc = httpx.get(f"{BASE}/documents/nonexistent")
check("GET nonexistent document returns 404", r_bad_doc.status_code == 404)


# ── 6. URL Ingestion ─────────────────────────────────────────────────────────

section("6. URL Ingestion")

try:
    r_url = httpx.post(
        f"{BASE}/projects/{pid}/ingest-url",
        json={"url": "https://fastapi.tiangolo.com/"},
        timeout=30,
    )
    check("Ingest URL returns 201", r_url.status_code == 201, f"got {r_url.status_code}: {r_url.text[:200]}")
    if r_url.status_code == 201:
        d_url = r_url.json()
        check("source_type is web", d_url["source_type"] == "web")
        check("confidence_level is 2 (MEDIUM)", d_url["confidence_level"] == 2)
        check("URL doc has content", d_url["char_count"] > 0)

        # Dedup: ingest same URL again
        r_url2 = httpx.post(
            f"{BASE}/projects/{pid}/ingest-url",
            json={"url": "https://fastapi.tiangolo.com/"},
            timeout=30,
        )
        check("Re-ingest same URL is duplicate", r_url2.json().get("is_duplicate") is True)
    else:
        FAIL += 4
        print("  SKIP  (remaining URL tests skipped due to ingestion failure)")
except Exception as e:
    FAIL += 5
    print(f"  SKIP  URL ingestion tests failed with exception: {e}")


# ── 7. Repo Ingestion ────────────────────────────────────────────────────────

section("7. Repo Ingestion (GitHub)")

try:
    r_repo = httpx.post(
        f"{BASE}/projects/{pid}/ingest-repo",
        json={"repo_url": "https://github.com/GwadeSteve/VERO"},
        timeout=60,
    )
    check("Ingest repo returns 201", r_repo.status_code == 201, f"got {r_repo.status_code}: {r_repo.text[:200]}")
    if r_repo.status_code == 201:
        d_repo = r_repo.json()
        check("source_type is repository", d_repo["source_type"] == "repository")
        check("confidence_level is 2 (MEDIUM)", d_repo["confidence_level"] == 2)
        check("Repo doc has content", d_repo["char_count"] > 100)

        # Dedup: ingest same repo again
        r_repo2 = httpx.post(
            f"{BASE}/projects/{pid}/ingest-repo",
            json={"repo_url": "https://github.com/GwadeSteve/VERO"},
            timeout=60,
        )
        check("Re-ingest same repo is duplicate", r_repo2.json().get("is_duplicate") is True)
    else:
        FAIL += 4
        print("  SKIP  (remaining repo tests skipped due to ingestion failure)")
except Exception as e:
    FAIL += 5
    print(f"  SKIP  Repo ingestion tests failed with exception: {e}")

# Invalid repo URL
r_bad_repo = httpx.post(
    f"{BASE}/projects/{pid}/ingest-repo",
    json={"repo_url": "https://not-github.com/invalid"},
)
check("Invalid repo URL returns 400", r_bad_repo.status_code == 400)


# ── 8. Error Handling ────────────────────────────────────────────────────────

section("8. Error Handling")

# Ingest to nonexistent project
with open("a:/AI-Searcher/README.md", "rb") as f:
    r_noproject = httpx.post(f"{BASE}/projects/nonexistent/ingest", files={"file": ("README.md", f)})
check("Ingest to nonexistent project returns 404", r_noproject.status_code == 404)

# Bad file extension
with open("a:/AI-Searcher/README.md", "rb") as f:
    r_badext = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("photo.jpg", f)})
check("Unsupported file extension returns 400", r_badext.status_code == 400)

# Missing fields in project creation
r_noval = httpx.post(f"{BASE}/projects", json={})
check("Empty project body returns 422", r_noval.status_code == 422)


# ── 9. Cross-Project Isolation ───────────────────────────────────────────────

section("9. Cross-Project Isolation")

try:
    with httpx.Client(base_url=BASE) as client:
        r_p2 = client.post("/projects", json={"name": "Isolation Test"})
        pid2 = r_p2.json()["id"]

        # Same README in a different project should NOT be dedup'd
        with open("a:/AI-Searcher/README.md", "rb") as f:
            r_cross = client.post(f"/projects/{pid2}/ingest", files={"file": ("README.md", f)})
        check("Same file in different project is NOT duplicate", r_cross.json()["is_duplicate"] is False)

        r_docs2 = client.get(f"/projects/{pid2}/documents")
        check("Second project has exactly 1 doc", len(r_docs2.json()) == 1)
except Exception as e:
    FAIL += 2
    print(f"  FAIL  Cross-project isolation tests failed: {e}")


# ── Final Summary ────────────────────────────────────────────────────────────

section("RESULTS")
total = PASS + FAIL
print(f"\n  {PASS}/{total} passed, {FAIL} failed\n")

if FAIL > 0:
    print("  LAYER 1 VERIFICATION FAILED")
    sys.exit(1)
else:
    print("  LAYER 1 VERIFICATION COMPLETE")
    sys.exit(0)
