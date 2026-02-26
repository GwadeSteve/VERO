# VERO Backend

This directory contains the core logic for the VERO research workspace.

## Environment Setup (Isolated)

To isolate the development environment, a Python virtual environment (`venv`) is used.

### 1. Initialize Virtual Environment
If you haven't already, create the venv:
```bash
python -m venv venv
```

### 2. Activate the Environment
* **Windows**:
  ```powershell
  .\venv\Scripts\activate
  ```
* **Linux/macOS**:
  ```bash
  source venv/bin/activate
  ```

### 3. Install Dependencies
Install the package in editable mode with development dependencies:
```bash
pip install -e .
```

## Running the Application

### Start Development Server
```bash
uvicorn app.main:app --reload --port 8000
```
The API will be available at `http://localhost:8000`.

## Testing

### Layer 1 Verification
Run the automated ingestion tests:
```bash
python tests/test_layer1.py
```
This script verifies project creation, deduplication (SHA-256), and metadata storage.
