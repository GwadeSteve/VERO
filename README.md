# VERO: Personal Research Workspace

VERO is an advanced, privacy-first personal research workspace engineered for high-fidelity information retrieval and synthesis. It prioritizes data integrity, deterministic processing, and strict source traceability to provide a rigorous environment for technical literature review and data analysis.

## Core Architecture

VERO is built upon a hardened, layered engineering framework. Every module is independently verifiable, ensuring zero data loss and perfect contextual preservation from raw document to final LLM synthesis.

1. **Deterministic Hashing**: All ingested content is normalized and hashed (SHA-256) to guarantee absolute deduplication and prevent redundant compute cycles.
2. **Reversible Chunking**: Advanced, context-aware chunking (semantic and markdown-aware) mapped strictly to original character offsets.
3. **Compute-Efficient Local Embedding**: Uses `sentence-transformers` locally to embed documents for zero-cost, fully private semantic retrieval.
4. **Hybrid Retrieval**: Employs Reciprocal Rank Fusion (RRF) to combine Semantic vector search with BM25 keyword search, followed by a Cross-Encoder reranking stage for state-of-the-art precision.
5. **Grounded Synthesis**: Leverages LLMs to synthesize answers that are strictly bound to retrieved context, enforcing academic-style source citations.

## Technical Stack

- **API Framework**: FastAPI (Async Python)
- **Database**: SQLite & SQLAlchemy (Asyncio)
- **Data Parsers**: PyMuPDF, python-docx, BeautifulSoup4, GitHub REST API
- **Embeddings & Reranking**: sentence-transformers (`all-MiniLM-L6-v2` & `ms-marco-MiniLM-L-6-v2`)
- **Vector Store**: ChromaDB (persistent, local)
- **Answering Engine**: Google Gemini 2.0 Flash

---

## Getting Started

### Prerequisites
- Python 3.10 or higher
- Git

### Installation

1. Clone the repository and navigate to the backend directory:
   ```bash
   git clone https://github.com/GwadeSteve/VERO.git
   cd VERO/backend
   ```

2. Create and activate a virtual environment (recommended):
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: .\venv\Scripts\activate
   ```

3. Install the application and dependencies:
   ```bash
   pip install -e .
   ```

4. Configure the environment:
   Create a `.env` file in the `backend` directory and add your Google Gemini API key (required for Layer 5 synthesis):
   ```env
   GEMINI_API_KEY="your_api_key_here"
   ```

### Running the Server

Start the FastAPI application with Uvicorn:
```bash
python -m uvicorn app.main:app --reload --port 8000
```
*The interactive API documentation (Swagger UI) will be instantly available at `http://localhost:8000/docs`.*

### Interactive Terminal Client

A robust interactive REPL is included to test the entire pipeline (Ingestion → Chunking → Embedding → Search → Answer) locally without frontend integration:
```bash
python demo.py
```

---

## API Interaction Guide

The VERO core API is scoped by "Projects" to ensure data isolation. Below is a high-level guide to the essential endpoints.

### 1. Project Management
- **POST `/projects`**: Create a new research workspace.
  ```json
  { "name": "Quantum Computing Review", "description": "Reviewing 2024 papers." }
  ```
- **GET `/projects`**: List all existing projects and their document counts.

### 2. Document Ingestion (Layer 1)
- **POST `/projects/{id}/ingest`**: Upload local files (Form-Data: `file`). Supports PDF, DOCX, MD, and TXT.
- **POST `/projects/{id}/ingest-url`**: Extract and clean the main article body from a webpage.
- **POST `/projects/{id}/ingest-repo`**: Recursively pull READMEs and Python docstrings from a GitHub repository.

### 3. Chunking & Embedding (Layers 2 & 3)
- **POST `/documents/{id}/chunk`**: Process the raw document text into optimal, token-aware semantic chunks.
- **POST `/documents/{id}/embed`**: Generate dense vector embeddings for all document chunks. VERO caches hashes locally to skip unchanged text.

### 4. Search & Retrieval (Layer 4)
- **POST `/projects/{id}/search`**: Execute a robust hybrid search.
  ```json
  {
    "query": "How is context preserved during chunking?",
    "top_k": 5,
    "mode": "hybrid"
  }
  ```
  *(Supported modes: `hybrid`, `semantic`, `keyword`)*
- **POST `/projects/{id}/search/context`**: Identical to search, but returns a formatted, LLM-ready text block with embedded source headers.

### 5. Grounded Answering (Layer 5)
- **POST `/projects/{id}/answer`**: The complete Retrieval-Augmented Generation (RAG) pipeline. Performs a hybrid search, gathers context, and prompts the LLM to write a comprehensive, strictly cited answer.

---

## Development Status

### Layer 1: Hardened Ingestion Pipeline (Complete)
A robust data ingestion pipeline that normalizes diverse inputs into standardized text records. Includes deterministic hashing, multi-format parsers, and auto-assigned source integrity confidence scores.

### Layer 2: Reversible SOTA Chunking System (Complete)
A strategy-driven chunking pipeline preparing text for optimal embeddings. Features `tiktoken` limit awareness, markdown header preservation, and strictly reversible character offsets.

### Layer 3: Versioned Vector Embeddings (Complete)
Compute-efficient local vectorization and persistent storage. Implements local-first embeddings, smart cryptographic versioning to prevent redundant compute, and ChromaDB integration.

### Layer 4: Retrieval Pipeline (Complete)
A two-stage hybrid search engine prioritizing accuracy. Over-fetches using Reciprocal Rank Fusion (Vector + BM25) and precisely reranks the top candidates using a Cross-Encoder model.

### Layer 5: Grounded Answering System (Complete)
An LLM integration layer that synthesizes retrieved knowledge. Enforces strict grounding rules, mandatory source citations (e.g., `[Source 1]`), and automatic contextual refusal logic via Google Gemini 2.0 Flash.

### Future Work
- **Layer 6: Session Management (Pending)**: Chat history, conversation threading, and cross-turn memory.
- **Layer 7: UI Implementation (Pending)**: Complete frontend client integration for the VERO backend.
