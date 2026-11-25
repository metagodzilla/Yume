"""Async generation jobs. A running GPU pass is cancelled, not paused mid-step."""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any

_LOCK = threading.Lock()
_JOBS: dict[str, dict[str, Any]] = {}


def submit(kind: str, body: Any) -> dict[str, Any]:
    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "kind": kind,
        "status": "queued",
        "progress": 0,
        "created": time.time(),
        "note": "",
        "error": "",
        "images": [],
    }
    with _LOCK:
        _JOBS[job_id] = job
    threading.Thread(target=_run, args=(job_id, body), daemon=True).start()
    return public(job)


def get(job_id: str) -> dict[str, Any] | None:
    with _LOCK:
        job = _JOBS.get(job_id)
        return public(job) if job else None


def cancel(job_id: str) -> dict[str, Any]:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job:
            raise KeyError(job_id)
        if job["status"] in {"done", "cancelled"}:
            return public(job)
        job["cancel"] = True
        job["status"] = "cancelled"
        job["note"] = "Cancelled."
        return public(job)


def pause(job_id: str) -> dict[str, Any]:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job:
            raise KeyError(job_id)
        if job["status"] == "running":
            job["cancel"] = True
            job["status"] = "paused"
            job["note"] = "Stopped. A GPU image cannot pause halfway, so Resume starts that image again."
        elif job["status"] == "queued":
            job["status"] = "paused"
            job["note"] = "Paused before it started."
        return public(job)


def resume(job_id: str, body: Any) -> dict[str, Any]:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job:
            raise KeyError(job_id)
        if job["status"] != "paused":
            return public(job)
        job["status"] = "queued"
        job["cancel"] = False
        job["note"] = "Resumed."
        job["progress"] = 0
    threading.Thread(target=_run, args=(job_id, body), daemon=True).start()
    return get(job_id) or {}


def _run(job_id: str, body: Any) -> None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job or job["status"] not in {"queued", "running"}:
            return
        job["status"] = "running"
        job["progress"] = 0.2
    delay = float(os_delay())
    if delay:
        time.sleep(delay)
    with _LOCK:
        job = _JOBS[job_id]
        if job.get("cancel") or job["status"] in {"cancelled", "paused"}:
            return
    def on_progress(note: str) -> None:
        with _LOCK:
            current = _JOBS.get(job_id)
            if current and current["status"] == "running":
                current["note"] = note
                current["progress"] = max(float(current.get("progress") or 0), 0.15)

    try:
        from yume_server.generate import generate_images

        images, seeds, model, consistency, switched = generate_images(body, on_progress=on_progress)
    except Exception as exc:  # noqa: BLE001
        with _LOCK:
            job = _JOBS[job_id]
            job["status"] = "failed"
            job["error"] = str(exc)
        return
    with _LOCK:
        job = _JOBS[job_id]
        if job.get("cancel") or job["status"] in {"cancelled", "paused"}:
            return
        job["images"] = images
        job["seeds"] = seeds
        job["model"] = model
        job["consistency"] = consistency
        job["switched"] = switched
        if switched and not job.get("note"):
            job["note"] = f"Switched to {model}"
        job["progress"] = 1
        job["status"] = "done"


def os_delay() -> str:
    import os

    return os.environ.get("YUME_JOB_DELAY", "0")


def public(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": job["id"],
        "kind": job["kind"],
        "status": job["status"],
        "progress": job["progress"],
        "note": job.get("note") or "",
        "error": job.get("error") or "",
        "ready": job["status"] == "done",
    }


def result(job_id: str) -> dict[str, Any]:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job:
            raise KeyError(job_id)
        if job["status"] != "done":
            raise RuntimeError("That job is not finished.")
        return {"images": job.get("images") or [], "seeds": job.get("seeds") or [], "model": job.get("model")}
