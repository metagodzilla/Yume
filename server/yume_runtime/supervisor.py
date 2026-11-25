"""PID 1. Fetches server code, then restarts only the app process on exit code 75.

/models and /loras are not touched. A container restart is not required.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

from yume_runtime.codepack import RELOAD_EXIT, apply_update, use_bundled


def paths() -> tuple[Path, Path, Path, Path]:
    root = Path(os.environ.get("YUME_RUNTIME_ROOT", "/opt/yume"))
    return root, root / "releases", root / "app", root / "bundled"


def ensure_code() -> None:
    root, releases, current, bundled = paths()
    ref = os.environ.get("YUME_SERVER_REF", "latest").strip() or "latest"
    try:
        apply_update(ref, os.environ.get("YUME_SERVER_SHA256", ""), releases_dir=releases, current_link=current)
        print(f"yume runtime loaded {ref}", flush=True)
        return
    except Exception as exc:  # noqa: BLE001 - boot must still start from the bundled copy
        print(f"yume runtime could not fetch {ref}: {exc}", flush=True)
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
