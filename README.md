# VERO | The Personal Research Workspace

VERO is a text-first research environment built on the principle of **traceability over fluency**. It follows a layered engineering framework to ensure the project reaches a finished, usable state (v1).

---

## Layer 0: The Project Contract

This contract defines the non-negotiable boundaries of the project. Any feature expansion must be reviewed against this "Definition of Done."

### 1. The User
*   **Persona**: A single technical researcher or engineer (me).
*   **Context**: Deep-diving into academic papers, technical documentation, and codebases.
*   **Requirement**: Needs verifiable facts, not creative summaries.

### 2. The Inputs (v1 Scope)
*   **Formats**: PDF, DOCX, Markdown, TXT.
*   **Sources**: Local files, GitHub Repositories (README/Comments), and clean Web URLs.
*   **Constraint**: No complex dynamic JS rendering or video/audio in v1.

### 3. The Outputs
*   **Primary**: Grounded answers to research questions.
*   **Constraint**: Every claim MUST be linked to a specific `chunk_id`.
*   **Traceability**: Clicking a citation must reveal the exact source text.

### 4. Failure Behavior
*   **The "Honesty" Rule**: If the retrieved context does not contain the answer, the system must explicitly state: *"I don't have enough information in your documents to answer this."*
*   **No Hallucinations**: Creative guessing is strictly disabled via prompt engineering and low temperature.

### 5. Definition of Done (v1)
A successful v1 is achieved when:
1.  A user can upload a 20-page PDF or point to a GitHub Repo.
2.  A user can ask a specific technical question.
3.  The system returns a concise answer with at least one valid chunk citation.
4.  The citation correctly points to the source material.

---

## Technical Core (The Data Schema)

| Entity | Responsibilities |
| :--- | :--- |
| **Project** | A knowledge boundary (e.g., "Deep Learning Research"). |
| **Document** | Raw source material. Stored unchunked. |
| **Chunk** | A window of text from a Document. Versioned by strategy. |
| **Embedding** | A vector representation of a Chunk. Strictly versioned. |

---

## Next Steps: The Layered Build
*   [x] **Layer 0**: The Contract
*   [ ] **Layer 1**: Ingestion Pipeline (FastAPI + Parsers)
*   [ ] **Layer 2**: Chunking System
*   [ ] **Layer 3**: Versioned Embeddings (FAISS)
*   [ ] **Layer 4**: Retrieval Pipeline
*   [ ] **Layer 5**: Grounded Answering (LLM)
*   [ ] **Layer 6**: Session Context
*   [ ] **Layer 7**: Minimal UI (React)
