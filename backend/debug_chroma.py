"""Debug: trace the exact search pipeline in the server process."""
import sys, uuid, time, httpx

BASE = "http://127.0.0.1:8000"
T = 120.0

from pathlib import Path
README = Path(__file__).resolve().parent.parent / "README.md"

# 1. Create project + ingest + wait
print("1. Setup...")
r = httpx.post(f"{BASE}/projects", json={"name": f"debug2_{uuid.uuid4().hex[:6]}"}, timeout=T)
pid = r.json()["id"]
with open(README, "rb") as f:
    r = httpx.post(f"{BASE}/projects/{pid}/ingest", files={"file": ("README.md", f)}, timeout=T)
doc_id = r.json()["id"]

for i in range(30):
    r = httpx.get(f"{BASE}/documents/{doc_id}", timeout=T)
    if r.json().get("processing_status") == "ready":
        print(f"   Ready after {(i+1)*2}s")
        break
    time.sleep(2)

# 2. Run _semantic_search directly (same process as server for import, but own ChromaDB client)
print("\n2. Testing _semantic_search function locally...")
from app import vectorstore
from app.embeddings import get_embedder

query = "deduplication and content hashing"
embedder = get_embedder()
query_vector = embedder.embed_single(query)
print(f"   Query vector: dim={len(query_vector)}, first 5 values={query_vector[:5]}")

# Direct ChromaDB query
collection = vectorstore.get_collection(pid)
print(f"   Collection count: {collection.count()}")

results = collection.query(query_embeddings=[query_vector], n_results=3)
print(f"   ChromaDB query IDs: {results['ids'][0]}")
print(f"   ChromaDB distances: {results['distances'][0]}")

# Compute scores the same way _semantic_search does
scores = {}
if results and results.get("ids") and results["ids"][0]:
    ids = results["ids"][0]
    distances = results["distances"][0] if results.get("distances") else [0.0] * len(ids)
    for chunk_id, distance in zip(ids, distances):
        scores[chunk_id] = 1.0 - (distance / 2.0)
print(f"   Computed scores: {scores}")

# 3. Now test via API with verbose mode
print("\n3. API semantic search...")
r = httpx.post(f"{BASE}/projects/{pid}/search",
    json={"query": query, "top_k": 3, "mode": "semantic"}, timeout=T)
api_data = r.json()
print(f"   API returned {len(api_data['results'])} results")
if api_data['results']:
    for item in api_data['results']:
        print(f"   - chunk={item['chunk_id']} score={item['score']}")

# 4. Test with min_score=0
print("\n4. API semantic search with min_score=0...")
r = httpx.post(f"{BASE}/projects/{pid}/search",
    json={"query": query, "top_k": 3, "mode": "semantic", "min_score": 0.0}, timeout=T)
api_data = r.json()
print(f"   API returned {len(api_data['results'])} results")
if api_data['results']:
    for item in api_data['results']:
        print(f"   - chunk={item['chunk_id']} score={item['score']}")

# 5. Test keyword for comparison
print("\n5. API keyword search...")
r = httpx.post(f"{BASE}/projects/{pid}/search",
    json={"query": query, "top_k": 3, "mode": "keyword"}, timeout=T)
api_data = r.json()
print(f"   Keyword returned {len(api_data['results'])} results")
if api_data['results']:
    for item in api_data['results']:
        print(f"   - chunk={item['chunk_id']} score={item['score']}")

# 6. Test hybrid
print("\n6. API hybrid search...")
r = httpx.post(f"{BASE}/projects/{pid}/search",
    json={"query": query, "top_k": 3, "mode": "hybrid"}, timeout=T)
api_data = r.json()
print(f"   Hybrid returned {len(api_data['results'])} results")
if api_data['results']:
    for item in api_data['results']:
        print(f"   - chunk={item['chunk_id']} score={item['score']}")
