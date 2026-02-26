# VERO
*A personal research workspace that actually helps you think.*

**VERO** is a text-first research environment designed to turn messy documentation into a structured, interrogation-ready knowledge base. It prioritizes **traceability over fluency** and **evidence over generation**.

---

# Part I: The Universal Project-Finishing Framework
*Before building anything, every ML product must answer these questions to prevent abandonment.*

### 1. The Purpose (The "Why")
If you cannot explain why this exists in one paragraph, the project will stall. A project without a clear purpose becomes a playground, not a product.
- **Pain Point**: The friction between having data and having *answers*.
- **The Solution**: A system that manages the "Synthesis Gap"—the space between reading 50 PDFs and forming a coherent conclusion.

### 2. The User (The "Who")
Every finished project has a real user, even if it is just you. Be specific to keep the scope tight.
- **Primary User**: Technical researchers, ML engineers, and graduate students.
- **Core Need**: High-fidelity retrieval and evidence-based reasoning.

### 3. Success Criteria (Observable Wins)
Success must be observable, not aspirational.
- **Win**: The user asks a complex question and gets an answer they *trust* because they can see the source.
- **Fail Case**: The system hallucinates a plausible answer without evidence. In VERO, the system must say "I don't know."

### 4. The End State (Definition of Done)
A finished v1 is better than a perfect v3 that never ships.
- **v1 Goal**: Ingest documents, retrieve passages, and answer with citations. If this works, the project is complete.

---

# Part II: The VERO Specification (v1)
*Applying the framework to the Research Assistant.*

### 1. High-Level Contract
- **Input**: Academic PDFs, GitHub Repos, Markdown notes, Technical Web-pages.
- **Output**: Answers grounded **only** in retrieved chunks.
- **The "Traceability" Rule**: Every statement must map to a `chunk_id`.

### 2. Supported Sources
- **Native**: PDF, DOCX, Markdown, TXT.
- **Code**: GitHub Repos (README, docstrings, comments).
- **Web**: Cleaned URL text (no dynamic JS/ads).
- **OCR**: Scanned text (marked with low-confidence flags).

### 3. Explicit Non-Scope (The "Finish" Guardrail)
To finish v1, we explicitly ignore:
- Collaborative/Team features.
- Multimedia (Audio/Video).
- Advanced Diagram Reasoning.
- Mobile App versions.

---

# Part III: The Execution Pipeline (Layered Build)
*You never move up a layer until the one below is complete and demo-able.*

### Layer 0: The Metadata Schema
Define exactly how a "Document" and a "Chunk" look in your database. 
- **Deliverable**: A defined SQL/NoSQL schema that supports source tracking.

### Layer 1: Ingestion is the Product
Turn messy inputs into normalized text. 
- **Stack**: FastAPI + PyMuPDF + BeautifulSoup.
- **Deliverable**: `POST /ingest` — Upload a document; see it stored as raw text.

### Layer 2: Chunking as a Strategy
Chunking is a "view" of data, not a permanent transformation. 
- **Implement**: Fixed-token, Semantic, and Section-aware chunkers.
- **Deliverable**: `GET /documents/{id}/chunks` — Inspect the chunks visually.

### Layer 3: Versioned Embeddings
Never overwrite embeddings. Record model name, date, and dimensions.
- **Stack**: Sentence-Transformers + FAISS.
- **Deliverable**: A config flag to switch between embedding models (v1 vs v2) without data loss.

### Layer 4: The Retrieval Pipeline
Retrieval = **Filter** (Project ID) → **Vector Search** → **Rerank** (Cross-encoder).
- **Deliverable**: `POST /retrieve` — Returns the raw evidence, not an LLM answer.

### Layer 5: Grounded Answering
The LLM layer. Use a strict "Citation Contract" in the prompt.
- **Output Format**:
  ```json
  {
    "answer": "...",
    "citations": ["paper_01_chunk_12"]
  }
  ```
- **Deliverable**: Answers that can be click-verified.

### Layer 6: Session Context (Intent Tracking)
Store user intent and previous cited chunks, not just raw chat history.
- **Deliverable**: A "Thinking Thread" that remembers what you were looking for.

### Layer 7: The "Zero-Explanation" UI
A minimal interface that proves completion.
- **Required**: Upload Panel + Query Bar + Citation-to-Source viewer.

---

# The Golden Rule of Finishing
> **"Can I demo this layer without explaining it?"**

If yes, move forward. If no, stop and fix the layer. This is how VERO gets finished.
