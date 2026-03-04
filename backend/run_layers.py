"""
VERO -- Sequential Layer Test Runner
High-fidelity verification suite for the VERO Research Workspace Engine.
"""

import subprocess
import sys
import os
import time

TEST_FILES = [
    ("Layer 1", "tests/test_layer1.py"),
    ("Layer 2", "tests/test_layer2.py"),
    ("Layer 3", "tests/test_layer3.py"),
    ("Layer 4", "tests/test_layer4.py"),
    ("Layer 5", "tests/test_layer5.py"),
    ("Layer 6", "tests/test_layer6.py"),
]

# Formatting Constants
WIDTH = 70
HR = "─" * WIDTH
BOLD = "\033[1m"
GREEN = "\033[32m"
RED = "\033[31m"
CYAN = "\033[36m"
RESET = "\033[0m"

def print_header():
    print(f"\n{BOLD}{CYAN}VERO ARCHITECTURAL VERIFICATION{RESET}")
    print(f"{HR}")
    print(f"Executing sequential audit of {len(TEST_FILES)} system layers...")
    print(f"{HR}\n")

def main():
    # Environment Check
    if not os.path.isdir("tests"):
        if os.path.isdir("backend/tests"):
            os.chdir("backend")
        else:
            print(f"{RED}ERROR: Verification target 'tests/' not found.{RESET}")
            sys.exit(1)

    print_header()

    results = []
    start_time = time.time()

    for idx, (label, path) in enumerate(TEST_FILES, 1):
        print(f"{BOLD}[{idx}/{len(TEST_FILES)}]{RESET} Verifying {BOLD}{label}{RESET}...")
        print(f"Target: {path}")
        
        # Run process
        proc = subprocess.run(
            [sys.executable, path],
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            capture_output=False # Stream directly to terminal for real-time monitoring
        )

        status = "PASSED" if proc.returncode == 0 else "FAILED"
        results.append((label, status))
        
        color = GREEN if status == "PASSED" else RED
        print(f"\n{color}{label} Result: {status}{RESET}")
        print(f"{HR}\n")

    total_time = time.time() - start_time

    # ── Final Report ───────────────────────────────────────────
    print(f"{BOLD}VERO SYSTEM AUDIT SUMMARY{RESET}")
    print(f"{HR}")
    
    all_passed = True
    for label, status in results:
        color = GREEN if status == "PASSED" else RED
        mark = "✓" if status == "PASSED" else "✗"
        print(f"  {color}{mark} {label:<10} {status}{RESET}")
        if status == "FAILED":
            all_passed = False

    print(f"{HR}")
    print(f"Total Audit Time: {total_time:.2f}s")
    
    if all_passed:
        print(f"\n{BOLD}{GREEN}VERIFICATION SUCCESSFUL: ARCHITECTURE INTACT{RESET}\n")
    else:
        print(f"\n{BOLD}{RED}VERIFICATION FAILED: ARCHITECTURAL ANOMALIES DETECTED{RESET}\n")

    sys.exit(0 if all_passed else 1)

if __name__ == "__main__":
    main()
