"""Model startup progress. /startup can answer before /ready."""

from __future__ import annotations

import threading
from typing import Any

_LOCK = threading.Lock()
_STATE: dict[str, Any] = {
    "stage": "idle",
    "bytesDone": 0,
    "bytesTotal": 0,
    "message": "Not started",
}


def mark(stage: str, message: str, *, done: int | None = None, total: int | None = None) -> None:
    with _LOCK:
        _STATE["stage"] = stage
        _STATE["message"] = message
        if done is not None:
            _STATE["bytesDone"] = max(0, int(done))
        if total is not None:
            _STATE["bytesTotal"] = max(0, int(total))


def note_download(done: int, total: int) -> None:
    mark("downloading", "Downloading model", done=done, total=total)


def snapshot() -> dict[str, Any]:
    with _LOCK:
        done = int(_STATE["bytesDone"] or 0)
        total = int(_STATE["bytesTotal"] or 0)
        percent = int(done * 100 / total) if total > 0 else None
        return {
            "stage": _STATE["stage"],
            "bytesDone": done,
            "bytesTotal": total,
            "percent": percent,
            "message": _STATE["message"],
        }
