"""
VERO Interactive Pipeline Tester
================================
A local interactive script to test the full VERO pipeline:
  Ingest → Chunk → Embed → Search

Usage:
    1. Start server:  uvicorn app.main:app --reload --port 8000
    2. Run this:      python demo.py

Commands inside the REPL:
    new                      Create a new project
    use <project_id>         Switch to an existing project
    projects                 List all projects
    ingest <filepath>        Ingest a local file (PDF, DOCX, MD, TXT)
    url <url>                Ingest a web page
    repo <github_url>        Ingest a GitHub repo
    docs                     List documents in current project
    pipeline                 Run chunk + embed on ALL documents
    search <query>           Hybrid search (default)
    semantic <query>         Semantic-only search
    keyword <query>          Keyword-only search
    context <query>          Get LLM-ready context window
    status                   Show current project and doc count
    help                     Show this help
    quit                     Exit
"""

import sys
import os
import httpx

BASE = "http://localhost:8000"
TIMEOUT = 180.0
current_project = None
current_project_name = None


def api(method, path, **kwargs):
    """Make an API call with error handling."""
    kwargs.setdefault("timeout", TIMEOUT)
    try:
        r = getattr(httpx, method)(f"{BASE}{path}", **kwargs)
        if r.status_code >= 400:
            print(f"  ERROR {r.status_code}: {r.text[:200]}")
            return None
        return r.json()
    except httpx.ConnectError:
        print("  ERROR: Cannot connect to server. Is it running on port 8000?")
        return None
    except httpx.ReadTimeout:
        print("  ERROR: Request timed out. The server may be busy.")
        return None


def cmd_new():
    name = input("  Project name: ").strip()
    if not name:
        print("  Cancelled.")
        return
    desc = input("  Description (optional): ").strip()
    data = api("post", "/projects", json={"name": name, "description": desc})
    if data:
        global current_project, current_project_name
        current_project = data["id"]
        current_project_name = data["name"]
        print(f"  Created & switched to: {current_project_name} ({current_project})")


def cmd_use(pid):
    data = api("get", f"/projects")
    if data:
        for p in data:
            if p["id"] == pid or p["name"].lower() == pid.lower():
                global current_project, current_project_name
                current_project = p["id"]
                current_project_name = p["name"]
                print(f"  Switched to: {current_project_name} ({current_project})")
                return
        print(f"  Project '{pid}' not found.")


def cmd_projects():
    data = api("get", "/projects")
    if data:
        if not data:
            print("  No projects yet. Use 'new' to create one.")
            return
        print(f"  {'ID':<15} {'Name':<30} {'Docs':<6}")
        print(f"  {'-'*15} {'-'*30} {'-'*6}")
        for p in data:
            print(f"  {p['id']:<15} {p['name']:<30} {p.get('document_count', '?'):<6}")


def require_project():
    if not current_project:
        print("  No project selected. Use 'new' or 'use <id>'.")
        return False
    return True


def cmd_ingest(filepath):
    if not require_project():
        return
    filepath = filepath.strip().strip('"').strip("'")
    if not os.path.exists(filepath):
        print(f"  File not found: {filepath}")
        return
    filename = os.path.basename(filepath)
    print(f"  Ingesting: {filename} ...")
    with open(filepath, "rb") as f:
        data = api("post", f"/projects/{current_project}/ingest",
                    files={"file": (filename, f)})
    if data:
        print(f"  Done! doc_id={data['id']} | type={data.get('source_type')} | chars={data.get('char_count', '?')}")
        return data["id"]


def cmd_url(url):
    if not require_project():
        return
    print(f"  Ingesting URL: {url} ...")
    data = api("post", f"/projects/{current_project}/ingest-url", json={"url": url})
    if data:
        print(f"  Done! doc_id={data['id']} | type={data.get('source_type')} | chars={data.get('char_count', '?')}")


def cmd_repo(repo_url):
    if not require_project():
        return
    print(f"  Ingesting repo: {repo_url} ...")
    data = api("post", f"/projects/{current_project}/ingest-repo", json={"repo_url": repo_url})
    if data:
        print(f"  Done! doc_id={data['id']} | type={data.get('source_type')} | chars={data.get('char_count', '?')}")


def cmd_docs():
    if not require_project():
        return
    data = api("get", f"/projects/{current_project}/documents")
    if data is not None:
        if not data:
            print("  No documents yet. Use 'ingest', 'url', or 'repo'.")
            return
        print(f"  {'ID':<15} {'Type':<12} {'Title':<35} {'Chars':<8}")
        print(f"  {'-'*15} {'-'*12} {'-'*35} {'-'*8}")
        for d in data:
            title = d['title'][:33] + '..' if len(d['title']) > 35 else d['title']
            print(f"  {d['id']:<15} {d['source_type']:<12} {title:<35} {d.get('char_count', '?'):<8}")


def cmd_pipeline():
    """Run chunk + embed on all documents in the current project."""
    if not require_project():
        return
    docs = api("get", f"/projects/{current_project}/documents")
    if not docs:
        print("  No documents to process.")
        return

    print(f"\n  Processing {len(docs)} document(s)...\n")
    for i, doc in enumerate(docs, 1):
        title = doc['title'][:40]
        doc_id = doc['id']

        # Chunk
        print(f"  [{i}/{len(docs)}] Chunking: {title} ...", end="", flush=True)
        chunks = api("post", f"/documents/{doc_id}/chunk")
        if chunks:
            n_chunks = len(chunks) if isinstance(chunks, list) else '?'
            print(f" {n_chunks} chunks", end="")
        else:
            print(f" (may already be chunked)", end="")

        # Embed
        print(" → Embedding ...", end="", flush=True)
        embeds = api("post", f"/documents/{doc_id}/embed",
                      json={"model_name": "all-MiniLM-L6-v2"})
        if embeds:
            n_embeds = len(embeds) if isinstance(embeds, list) else '?'
            cached = sum(1 for e in embeds if e.get("is_cached")) if isinstance(embeds, list) else 0
            print(f" {n_embeds} embeddings ({cached} cached)")
        else:
            print(" done")

    print(f"\n  Pipeline complete! Ready to search.")


def cmd_search(query, mode="hybrid"):
    if not require_project():
        return
    print(f"  Searching ({mode}): \"{query}\" ...\n")
    data = api("post", f"/projects/{current_project}/search",
               json={"query": query, "top_k": 5, "mode": mode})
    if data and data.get("results"):
        for i, r in enumerate(data["results"], 1):
            score = r['score']
            title = r['doc_title'][:30]
            text_preview = r['text'][:120].replace('\n', ' ')
            print(f"  {i}. [{score:+.4f}] {title}")
            print(f"     {text_preview}...")
            print()
        print(f"  {data['total_results']} result(s) found.")
    else:
        print("  No results found.")


def cmd_context(query):
    if not require_project():
        return
    print(f"  Building context for: \"{query}\" ...\n")
    data = api("post", f"/projects/{current_project}/search/context",
               json={"query": query, "top_k": 5, "mode": "hybrid"})
    if data and data.get("context"):
        print("─" * 60)
        print(data["context"])
        print("─" * 60)
        print(f"\n  {data['total_chunks']} chunk(s) in context window.")


def cmd_status():
    if not current_project:
        print("  No project selected.")
        return
    docs = api("get", f"/projects/{current_project}/documents")
    n_docs = len(docs) if docs else 0
    print(f"  Project: {current_project_name} ({current_project})")
    print(f"  Documents: {n_docs}")


def show_help():
    print("""
  VERO Interactive Pipeline Tester
  ─────────────────────────────────
  new                      Create a new project
  use <id_or_name>         Switch to existing project
  projects                 List all projects
  ingest <filepath>        Ingest a local file (PDF, DOCX, MD, TXT)
  url <url>                Ingest a web page
  repo <github_url>        Ingest a GitHub repo
  docs                     List documents in current project
  pipeline                 Run chunk + embed on ALL documents
  search <query>           Hybrid search (Semantic + BM25 + Reranking)
  semantic <query>         Semantic-only search
  keyword <query>          Keyword-only search
  context <query>          Get formatted LLM-ready context window
  status                   Show current project info
  help                     Show this help
  quit                     Exit
""")


def main():
    print("\n  ╔══════════════════════════════════════╗")
    print("  ║     VERO Pipeline Tester v1.0        ║")
    print("  ╠══════════════════════════════════════╣")
    print("  ║  Type 'help' for available commands  ║")
    print("  ╚══════════════════════════════════════╝\n")

    # Quick health check
    health = api("get", "/health")
    if health:
        print(f"  Server: OK (Layer {health.get('layer', '?')})\n")
    else:
        print("  WARNING: Server not reachable. Start it first.\n")

    while True:
        try:
            prompt = f"  [{current_project_name or 'no project'}] > "
            line = input(prompt).strip()
        except (KeyboardInterrupt, EOFError):
            print("\n  Bye!")
            break

        if not line:
            continue

        parts = line.split(maxsplit=1)
        cmd = parts[0].lower()
        arg = parts[1] if len(parts) > 1 else ""

        if cmd == "quit" or cmd == "exit" or cmd == "q":
            print("  Bye!")
            break
        elif cmd == "help" or cmd == "h" or cmd == "?":
            show_help()
        elif cmd == "new":
            cmd_new()
        elif cmd == "use":
            cmd_use(arg)
        elif cmd == "projects":
            cmd_projects()
        elif cmd == "ingest":
            cmd_ingest(arg)
        elif cmd == "url":
            cmd_url(arg)
        elif cmd == "repo":
            cmd_repo(arg)
        elif cmd == "docs":
            cmd_docs()
        elif cmd == "pipeline":
            cmd_pipeline()
        elif cmd == "search":
            cmd_search(arg, mode="hybrid")
        elif cmd == "semantic":
            cmd_search(arg, mode="semantic")
        elif cmd == "keyword":
            cmd_search(arg, mode="keyword")
        elif cmd == "context":
            cmd_context(arg)
        elif cmd == "status":
            cmd_status()
        else:
            print(f"  Unknown command: '{cmd}'. Type 'help' for options.")


if __name__ == "__main__":
    main()
