import sys
from pathlib import Path

# Add backend to path to import app modules
backend_dir = Path("a:/AI-Searcher/backend")
sys.path.append(str(backend_dir))

from langchain_text_splitters import MarkdownHeaderTextSplitter

with open("a:/AI-Searcher/README.md", "r", encoding="utf-8") as f:
    text = f.read()

headers_to_split_on = [
    ("#", "Header 1"),
    ("##", "Header 2"),
    ("###", "Header 3"),
]

md_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)
splits = md_splitter.split_text(text)

print("Number of splits:", len(splits))
for i, split in enumerate(splits):
    if "Switch providers with a single" in split.page_content:
        print(f"\n--- Split {i} | Metadata: {split.metadata} ---")
        print(repr(split.page_content[:100]))
        search = split.page_content.strip()[:100]
        norm = text.replace("\r\n", "\n")
        print("Found in norm_text?", norm.find(search))
