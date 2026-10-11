"""
SentinelAI - Real-Time Attack Loop
====================================
Launches ransomware simulation via cmd.exe so it runs in a
COMPLETELY SEPARATE process tree from any IDE/terminal.
The agent correctly identifies and terminates it in real time.

Run this once. Open http://localhost:5173 to watch live detection.
Press Ctrl+C to stop.
"""

import subprocess, sys, time, os, uuid
import requests

ROOT     = os.path.dirname(os.path.abspath(__file__))
SIM_DIR  = os.path.join(ROOT, "simulator")
PYTHON   = sys.executable
BACKEND  = "http://127.0.0.1:8000"
TOKEN    = "hackfest-super-secret-token"
HEADERS  = {"x-agent-token": TOKEN}

# Console helpers (ASCII safe for Windows charmap console)
def log(msg, tag="*"):
    print(f"  [{time.strftime('%H:%M:%S')}] [{tag}] {msg}", flush=True)

# Backend helpers
def backend_alive():
    try:
        r = requests.get(f"{BACKEND}/api/incidents", headers=HEADERS, timeout=3)
        return r.status_code == 200
    except Exception:
        return False

def get_incidents():
    try:
        r = requests.get(f"{BACKEND}/api/incidents", headers=HEADERS, timeout=4)
        return r.json() if r.ok else []
    except Exception:
        return []

def wait_for_backend(secs=15):
    log("Checking backend connection...", "INFO")
    for i in range(secs):
        try:
            r = requests.get(f"{BACKEND}/api/incidents", headers=HEADERS, timeout=3)
            if r.status_code == 200:
                log("Backend ready (HTTP 200)", "OK")
                return True
        except Exception as e:
            if i == secs - 1:
                log(f"Connection detail: {e}", "WARN")
        time.sleep(1)
    log("Backend not reachable on http://127.0.0.1:8000!", "ERR")
    return False

# Sandbox helpers
def reseed():
    log("Seeding 1000 fresh files into sandbox...", "SEED")
    r = subprocess.run(
        [PYTHON, "simulate.py", "--reseed"],
        cwd=SIM_DIR, capture_output=True, text=True
    )
    ok = r.returncode == 0
    if ok:
        log("Sandbox ready", "OK")
    else:
        log(f"Seed error: {r.stderr[:100]}", "ERR")
    return ok

# Attack launcher (Runs via cmd.exe for independent process tree)
def launch_attack(run_id):
    bat = os.path.join(ROOT, "launch_attack.bat")
    proc = subprocess.Popen(
        ["cmd.exe", "/c", bat, run_id],
        creationflags=(
            subprocess.CREATE_NEW_PROCESS_GROUP |
            subprocess.DETACHED_PROCESS
        ),
        close_fds=True
    )
    return proc

# Poll backend for detection and resolution
def poll_result(timeout=90):
    start = time.time()
    seen  = set()
    while time.time() - start < timeout:
        for inc in get_incidents():
            iid    = inc["id"]
            status = inc.get("status", "")
            score  = inc.get("max_score", 0)
            if iid in seen:
                continue

            if status in ("Suspend-Pending", "Suspended", "Terminate-Pending", "Terminated", "Restored"):
                if status not in ("Restored", "Terminated"):
                    log(f"{status.upper()} - Risk Score: {score:.0f}", "WARN")
                elif status == "Terminated":
                    files = inc.get("affected_count", 0)
                    log(f"TERMINATED - Score: {score:.0f} | Files hit: {files}", "KILL")
                elif status == "Restored":
                    ms  = inc.get("contained_after_ms") or 0
                    rec = inc.get("restored_count", 0)
                    log(f"RESTORED - Contained in {ms/1000:.2f}s | Recovered: {rec} files", "RESTORED")
                    seen.add(iid)
                    return True
        time.sleep(1)
    return False

def main():
    print()
    print("  ============================================")
    print("   SentinelAI - Real-Time Attack Loop         ")
    print("   Dashboard: http://localhost:5173           ")
    print("  ============================================")
    print()

    if not wait_for_backend(15):
        return

    cycle = 0
    while True:
        cycle += 1
        run_id = f"rtdemo-{cycle:03d}-{uuid.uuid4().hex[:6]}"
        print()
        log(f"CYCLE {cycle} START", "CYCLE")

        # 1. Fresh clean files
        if not reseed():
            time.sleep(5)
            continue

        # 2. Wait for vault snapshot
        log("Waiting 12s for vault to snapshot clean files...", "VAULT")
        time.sleep(12)

        # 3. Launch ransomware attack
        log(f"Launching attack (run_id={run_id})...", "ATTACK")
        proc = launch_attack(run_id)
        log(f"Simulator PID: {proc.pid} (detached)", "ATTACK")

        # 4. Wait for SentinelAI detection, containment, and restoration
        contained = poll_result(timeout=90)

        # 5. Clean up process if still running
        if proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass

        if contained:
            log(f"Cycle {cycle} complete. Pausing 10s before next attack...", "OK")
        else:
            log(f"Cycle {cycle}: no containment reported in time.", "WARN")

        time.sleep(10)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        log("Demo stopped by user.", "INFO")
