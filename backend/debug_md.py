import asyncio
import time
from app.chunks.markdown import MarkdownChunker

async def main():
    print("Loading README...")
    with open("../README.md", "r", encoding="utf-8") as f:
        text = f.read()
    
    print("Initializing chunker...")
    chunker = MarkdownChunker()
    
    print("Starting chunk...")
    t0 = time.time()
    try:
        chunks = chunker.chunk(text, "doc1", "proj1")
        print(f"Success! generated {len(chunks)} chunks in {time.time() - t0:.2f}s")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
