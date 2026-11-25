"""Model startup progress. /startup and /progress can answer before /ready."""

from __future__ import annotations

import threading
import time
from typing import Any

_LOCK = threading.Lock()
_STATE: dict[str, Any] = {
    "stage": "idle",
    "bytesDone": 0,
    "bytesTotal": 0,
    "message": "Not started",
}
_SPEED = {"at": 0.0, "done": 0, "rate": 0.0}
_FILES: dict[str, dict[str, Any]] = {}


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
    note_file("checkpoint", name="Checkpoint", kind="Checkpoint", done=done, total=total, state="downloading")


def note_file(key: str, *, name: str, kind: str, done: int = 0, total: int = 0, state: str = "downloading", version_id: int | None = None, feature: str | None = None) -> None:
    """Record one weight file. speed is bytes per second."""
    now = time.monotonic()
    with _LOCK:
        row = _FILES.get(key) or {"at": now, "mark": 0, "speed": 0.0}
        done = max(0, int(done or 0))
        total = max(0, int(total or 0))
        elapsed = now - float(row.get("at") or now)
        if elapsed >= 0.4:
            base = int(row.get("mark") or 0)
            row["speed"] = max(0.0, (done - base) / elapsed) if done >= base else 0.0
            row["at"] = now
            row["mark"] = done
        speed = float(row.get("speed") or 0)
        row.update({
            "name": name,
            "type": kind,
            "versionId": version_id,
            "bytes_done": done,
            "bytes_total": total,
            "speed": speed,
            "state": "waiting" if state in {"queued", "paused"} else state,
            "eta_seconds": int((total - done) / speed) if speed > 0 and total > done else None,
            "feature": feature or row.get("feature") or "",
        })
        _FILES[key] = row


def files_payload() -> list[dict[str, Any]]:
    with _LOCK:
        tracked = [dict(item) for item in _FILES.values()]
    seen = {item.get("versionId") for item in tracked if item.get("versionId")}
    for job in _catalog_files():
        if job.get("versionId") in seen:
            continue
        tracked.append(job)
    return tracked


def _catalog_files() -> list[dict[str, Any]]:
    try:
        from yume_server.catalog import list_installs
    except Exception:
        return []
    rows = []
    for job in list_installs():
        state = str(job.get("state") or "waiting")
        if state in {"queued", "paused"}:
            state = "waiting"
        if state not in {"downloading", "waiting", "done", "error"}:
            continue
        rows.append({
            "name": job.get("name") or "Model",
            "type": job.get("type") or "Checkpoint",
            "versionId": job.get("versionId"),
            "bytes_done": int(job.get("bytesDone") or 0),
            "bytes_total": int(job.get("bytesTotal") or 0),
            "speed": float(job.get("bytesPerSecond") or 0),
            "state": state,
            "eta_seconds": job.get("etaSeconds"),
        })
    return rows


def tqdm_factory(key: str, name: str, kind: str):
    """Hugging Face progress bar that records one weight file."""
    from tqdm.auto import tqdm

    class _Bar(tqdm):
        def update(self, n: int = 1):  # type: ignore[override]
            shown = super().update(n)
            note_file(key, name=name, kind=kind, done=int(self.n or 0), total=int(self.total or 0), state="downloading")
            return shown

    return _Bar


def eta_seconds(done: int, total: int, speed: float) -> int | None:
    if speed <= 0 or total <= done:
        return None
    return int((total - done) / speed)


def snapshot() -> dict[str, Any]:
    now = time.monotonic()
    with _LOCK:
        done = int(_STATE["bytesDone"] or 0)
        total = int(_STATE["bytesTotal"] or 0)
        elapsed = now - float(_SPEED["at"] or 0)
        if _SPEED["at"] and elapsed >= 0.4:
            base = int(_SPEED["done"] or 0)
            _SPEED["rate"] = max(0.0, (done - base) / elapsed) if done >= base else 0.0
            _SPEED["at"] = now
            _SPEED["done"] = done
        elif not _SPEED["at"]:
            _SPEED["at"] = now
            _SPEED["done"] = done
        speed = float(_SPEED["rate"] or 0)
        percent = int(done * 100 / total) if total > 0 else None
        body = {
            "stage": _STATE["stage"],
            "bytesDone": done,
            "bytesTotal": total,
            "bytesPerSecond": speed,
            "etaSeconds": eta_seconds(done, total, speed),
            "percent": percent,
            "message": _STATE["message"],
            "files": [dict(item) for item in _FILES.values()],
        }
    try:
        from yume_server.selfheal import public_status

        heal = public_status()
    except Exception:
        heal = {}
    if heal.get("error"):
        body["error"] = heal["error"]
    if heal.get("network"):
        body["network"] = heal["network"]
    if heal.get("selfHeal"):
        body["selfHeal"] = heal["selfHeal"]
    if heal.get("healthFail"):
        body["stage"] = "relocating"
        body["message"] = heal.get("message") or body["message"]
        body["network"] = "unreachable"
        body["selfHeal"] = "reallocate"
    body["files"] = files_payload()
    return body
