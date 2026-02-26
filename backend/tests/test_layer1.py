"""VERO Layer 1 — Verification Script"""
import httpx

BASE = "http://localhost:8000"

# 1. Create project
r = httpx.post(f"{BASE}/projects", json={"name": "Dedup Test", "description": "Testing deduplication"})
proj = r.json()
pid = proj["id"]
print(f"1. CREATE PROJECT: {r.status_code} -> id={pid}")

# 2. Ingest README
with open("a:/AI-Searcher/README.md", "rb") as f:
    r1 = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("README.md", f)})
if r1.status_code != 201:
    print(f"FAILED to ingest README: {r1.status_code}\n{r1.text}")
    exit(1)
d1 = r1.json()
print(f"2. INGEST README:  {r1.status_code} -> id={d1['id']}, confidence={d1.get('confidence_level', 'MISSING')}, dup={d1.get('is_duplicate', 'MISSING')}")

# 3. Ingest SAME README again (dedup test)
with open("a:/AI-Searcher/README.md", "rb") as f:
    r2 = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("README.md", f)})
d2 = r2.json()
print(f"3. DEDUP CHECK:    {r2.status_code} -> id={d2['id']}, dup={d2['is_duplicate']}")
print(f"   Same doc returned? {d1['id'] == d2['id']}")

# 4. Ingest Framework.md (different content, should NOT be dedup'd)
with open("a:/AI-Searcher/Framework.md", "rb") as f:
    r3 = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("Framework.md", f)})
d3 = r3.json()
print(f"4. INGEST NEW:     {r3.status_code} -> id={d3['id']}, dup={d3['is_duplicate']}")

# 5. List documents (should be exactly 2)
r4 = httpx.get(f"{BASE}/projects/{pid}/documents")
docs = r4.json()
print(f"5. LIST DOCS:      {r4.status_code} -> count={len(docs)}")

# 6. Get document detail
r5 = httpx.get(f"{BASE}/documents/{d1['id']}")
det = r5.json()
print(f"6. DOC DETAIL:     {r5.status_code} -> confidence={det['confidence_level']}, hash={det['content_hash'][:16]}...")

print("\n--- ALL TESTS PASSED ---" if (
    d1["is_duplicate"] is False
    and d2["is_duplicate"] is True
    and d1["id"] == d2["id"]
    and d3["is_duplicate"] is False
    and len(docs) == 2
) else "\n--- SOME TESTS FAILED ---")
