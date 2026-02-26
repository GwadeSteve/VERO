"""
VERO Parser — GitHub Repository
--------------------------------
Placeholder for v1. Will clone a repo and extract README + docstrings.
"""


async def parse_repo(repo_url: str) -> dict:
    """
    TODO: Implement GitHub repo ingestion.

    Plan:
    1. Clone repo to a temp directory (or use GitHub API)
    2. Extract README.md content
    3. Extract docstrings from Python files
    4. Concatenate into a single text blob with source markers

    For now, raises NotImplementedError.
    """
    raise NotImplementedError(
        "GitHub repository ingestion is not yet implemented. "
        "Use URL ingestion to ingest a specific README or file URL instead."
    )
