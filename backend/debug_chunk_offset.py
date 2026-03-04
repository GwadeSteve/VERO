import sys
from pathlib import Path

# Add backend to path to import app modules
backend_dir = Path("a:/AI-Searcher/backend")
sys.path.append(str(backend_dir))

from app.chunks.markdown import MarkdownChunker

with open("a:/AI-Searcher/README.md", "r", encoding="utf-8") as f:
    text = f.read()

chunker = MarkdownChunker()
chunks = chunker.chunk(text, "test_doc", "test_proj")

c0 = chunks[0]
print("--- Chunk Text ---")
print(repr(c0.text))
print("--- Start/End ---", c0.start_char, c0.end_char)

norm_text = text.replace("\r\n", "\n")
chunk_text = c0.text.split("\n", 1)[1] # remove breadcrumbs to get internal chunk_text
search_content = chunk_text.strip()
print("--- Search Content Prefix ---")
print(repr(search_content[:100]))

idx = norm_text.find(search_content[:100])
print("--- Find index ---", idx)
