# VERO

VERO is a personal research workspace designed for high-fidelity information retrieval and synthesis. It prioritizes data integrity and source traceability over conversational fluency, providing a structured environment for technical literature review.

## Project Architecture

VERO is built using a layered engineering framework. Each layer must be independently verifiable and demoable before proceeding to subsequent components.

### Core Principles
* **Deduplication**: Content is normalized and hashed using SHA-256 to prevent redundant storage and processing.
* **Source Integrity**: Every document carries a confidence score based on the extraction method (native vs. OCR).
* **Traceability**: All generated answers are strictly grounded in retrieved segments with direct pointers to the source material.

## Technical Stack

* **API**: FastAPI (Async Python)
* **Database**: SQLite / SQLAlchemy (Asyncio)
* **Parsers**: PyMuPDF, python-docx, BeautifulSoup4, GitHub REST API

## Getting Started

### Prerequisites
* Python 3.10+

### Installation
```bash
cd backend
pip install -e .
```

### Development Server
```bash
python -m uvicorn app.main:app --reload --port 8000
```
API documentation is available at `/docs` once the server is running.

## Development Status

| Layer | Status | Description |
| :--- | :--- | :--- |
| 0 | Complete | Project Contract & Data Schema |
| 1 | Complete | Hardened Ingestion Pipeline |
| 2 | In Progress | Reversible SOTA Chunking System |
| 3 | Pending | Versioned Vector Embeddings |
| 4 | Pending | Retrieval Pipeline |
| 5 | Pending | Grounded Answering System |
| 6 | Pending | Session Management |
| 7 | Pending | UI Implementation |
