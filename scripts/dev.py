"""Run FastAPI and Vite together on macOS/Linux: python scripts/dev.py."""
import os
import signal
import subprocess
import sys
import time
from contextlib import suppress
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def stop(signum, frame):
    raise SystemExit(128 + signum)


def main():
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    commands = [
        [sys.executable, '-m', 'uvicorn', 'backend.api:app', '--reload'],
        ['npm', 'run', 'dev', '--prefix', 'frontend', '--', '--port', '5173', '--strictPort'],
    ]
    servers = []
    print('Backend: http://127.0.0.1:8000 | Frontend: http://127.0.0.1:5173', flush=True)
    try:
        for command in commands:
            servers.append(subprocess.Popen(command, cwd=ROOT, start_new_session=True))
        while True:
            for server in servers:
                if (code := server.poll()) is not None:
                    return code
            time.sleep(0.2)
    finally:
        # Stop process groups so reloaders and npm's child server also exit.
        for server in servers:
            with suppress(ProcessLookupError):
                os.killpg(server.pid, signal.SIGTERM)
        for server in servers:
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                with suppress(ProcessLookupError):
                    os.killpg(server.pid, signal.SIGKILL)
                server.wait()


if __name__ == '__main__':
    raise SystemExit(main())
