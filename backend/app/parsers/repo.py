"""VERO Parser — GitHub Repository: Fetches README and Python docstrings from GitHub."""

import re
import httpx

# GitHub raw content base
_RAW_BASE = "https://raw.githubusercontent.com"
_API_BASE = "https://api.github.com"


def _parse_github_url(url: str) -> tuple[str, str]:
    """Extract (owner, repo) from a GitHub URL.

    Supports:
        https://github.com/owner/repo
        https://github.com/owner/repo.git
        https://github.com/owner/repo/tree/main/...
    """
    pattern = r"github\.com/([^/]+)/([^/.]+)"
    match = re.search(pattern, url.rstrip("/"))
    if not match:
        raise ValueError(f"Cannot parse GitHub URL: {url}")
    return match.group(1), match.group(2)


async def _fetch_readme(client: httpx.AsyncClient, owner: str, repo: str) -> str:
    """Try to fetch README content. Returns empty string if not found."""
    for name in ["README.md", "readme.md", "README.rst", "README.txt", "README"]:
        url = f"{_RAW_BASE}/{owner}/{repo}/HEAD/{name}"
        r = await client.get(url)
        if r.status_code == 200:
            return r.text
    return ""


async def _fetch_tree(client: httpx.AsyncClient, owner: str, repo: str) -> list[dict]:
    """Fetch the full file tree using the Git Trees API (recursive)."""
    url = f"{_API_BASE}/repos/{owner}/{repo}/git/trees/HEAD?recursive=1"
    r = await client.get(url)
    if r.status_code != 200:
        return []
    data = r.json()
    return data.get("tree", [])


async def _fetch_file(client: httpx.AsyncClient, owner: str, repo: str, path: str) -> str:
    """Fetch a single file's raw content."""
    url = f"{_RAW_BASE}/{owner}/{repo}/HEAD/{path}"
    r = await client.get(url)
    if r.status_code == 200:
        return r.text
    return ""


def _extract_docstrings(source: str, filepath: str) -> str:
    """Extract module-level and class/function docstrings from Python source.

    Returns a formatted string with source markers.
    """
    import ast

    parts = []
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return ""

    # Module docstring
    module_doc = ast.get_docstring(tree)
    if module_doc:
        parts.append(f"[{filepath}] Module: {module_doc}")

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            doc = ast.get_docstring(node)
            if doc:
                kind = "Class" if isinstance(node, ast.ClassDef) else "Function"
                parts.append(f"[{filepath}] {kind} {node.name}: {doc}")

    return "\n\n".join(parts)


async def parse_repo(repo_url: str) -> dict:
    """Fetch README and Python docstrings from a public GitHub repository.

    Returns {"text": str, "metadata": dict}.
    """
    owner, repo = _parse_github_url(repo_url)
    sections = []

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=30,
        headers={"Accept": "application/vnd.github.v3+json"},
    ) as client:
        # 1. Fetch README
        readme = await _fetch_readme(client, owner, repo)
        if readme:
            sections.append(f"# README\n\n{readme}")

        # 2. Fetch file tree and extract docstrings from Python files
        tree = await _fetch_tree(client, owner, repo)
        py_files = [
            f["path"] for f in tree
            if f["type"] == "blob"
            and f["path"].endswith(".py")
            and f.get("size", 0) < 100_000  # skip huge files
        ]

        docstring_parts = []
        for path in py_files[:50]:  # cap at 50 files to avoid rate limits
            source = await _fetch_file(client, owner, repo, path)
            if source:
                extracted = _extract_docstrings(source, path)
                if extracted:
                    docstring_parts.append(extracted)

        if docstring_parts:
            sections.append("# Python Docstrings\n\n" + "\n\n".join(docstring_parts))

    text = "\n\n---\n\n".join(sections)
    if not text.strip():
        raise ValueError(f"No extractable content found in {repo_url}")

    return {
        "text": text,
        "metadata": {
            "repo_url": repo_url,
            "owner": owner,
            "repo_name": repo,
            "python_files_scanned": len(py_files) if tree else 0,
        },
    }
