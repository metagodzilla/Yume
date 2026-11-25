"""PID 1. Fetches server code, then restarts only the app process on exit code 75.

/models and /loras are not touched. A container restart is not required.
The code fetch runs in its own process. DNS and downloads are abandoned after 90s.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from yume_runtime.codepack import RELOAD_EXIT, use_bundled

FETCH_DEADLINE_SECONDS = 90


def paths() -> tuple[Path, Path, Path, Path]:
    root = Path(os.environ.get("YUME_RUNTIME_ROOT", "/opt/yume"))
    return root, root / "releases", root / "app", root / "bundled"


def abandon(proc: subprocess.Popen[bytes]) -> None:
    if proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        proc.kill()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def wait_bounded(proc: subprocess.Popen[bytes], seconds: float) -> int:
    try:
        return proc.wait(timeout=seconds)
    except subprocess.TimeoutExpired as exc:
        abandon(proc)
        raise TimeoutError(f"server code fetch exceeded {seconds:.0f}s") from exc


def start_fetch(ref: str, sha: str, releases: Path, current: Path) -> subprocess.Popen[bytes]:
    runtime = str(Path(__file__).resolve().parent.parent)
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join([runtime, env.get("PYTHONPATH", "")]).strip(os.pathsep)
    return subprocess.Popen(
        [sys.executable, "-m", "yume_runtime.fetch_boot", ref, sha, str(releases), str(current)],
        env=env,
        start_new_session=True,
    )


def ensure_code() -> None:
    _root, releases, current, bundled = paths()
    ref = os.environ.get("YUME_SERVER_REF", "latest").strip() or "latest"
    sha = os.environ.get("YUME_SERVER_SHA256", "")
    print(f"yume runtime fetching {ref} within {FETCH_DEADLINE_SECONDS}s", flush=True)
    proc = start_fetch(ref, sha, releases, current)
    try:
        code = wait_bounded(proc, FETCH_DEADLINE_SECONDS)
    except TimeoutError as exc:
        print(f"yume runtime abandoned the code fetch: {exc}", flush=True)
    else:
        if code == 0:
            print(f"yume runtime loaded {ref}", flush=True)
            return
        print(f"yume runtime fetch exited {code}. Using the bundled server code.", flush=True)
    if use_bundled(bundled, releases, current):
        print("yume runtime is using the bundled server code", flush=True)
        return
    if (current / "yume_server" / "main.py").is_file():
        print("yume runtime kept the server code already on disk", flush=True)
        return
    raise SystemExit("No server code is available.")


def serve_once() -> int:
    _root, _releases, current, _bundled = paths()
    runtime = Path(__file__).resolve().parent.parent
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join([str(current), str(runtime), env.get("PYTHONPATH", "")]).strip(os.pathsep)
    env["YUME_SUPERVISOR"] = "1"
    env["YUME_CODE_STAMP"] = str(current / "STAMP.json")
    port = env.get("PORT", "8080")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "yume_server.main:app", "--host", "::", "--port", port],
        env=env,
    )
    return proc.wait()


def main() -> None:
    ensure_code()
    while True:
        code = serve_once()
        if code == RELOAD_EXIT:
            print("yume runtime reloaded the server code. Models on disk were kept.", flush=True)
            continue
        print(f"yume app exited {code}. Starting it again.", flush=True)
        time.sleep(2)


if __name__ == "__main__":
    main()
