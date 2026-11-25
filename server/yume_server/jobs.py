"""Async picture jobs. POST returns an id; the GPU work keeps going if the phone drops."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from typing import Any, Callable

_LOG = logging.getLogger("yume.jobs")
_LOCK = threading.Lock()
_JOBS: dict[str, dict[str, Any]] = {}
STALL_SECONDS = 8 * 60
LIMIT_SECONDS = 25 * 60
Task = Callable[[Any, Callable[..., None]], Any]


def submit(kind: str, body: Any, task: Task | None = None) -> dict[str, Any]:
    now = time.time()
    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "kind": kind,
        "status": "queued",
        "progress": 0,
        "created": now,
        "touched": now,
        "note": "Queued",
        "error": "",
        "images": [],
        "payload": None,
    }
    with _LOCK:
        _JOBS[job_id] = job
    import os

    if os.environ.get("YUME_MOCK", "").strip().lower() in {"1", "true", "yes"}:
        _run(job_id, body, task)
    else:
        threading.Thread(target=_run, args=(job_id, body, task), name=f"yume-job-{job_id}", daemon=True).start()
        threading.Thread(target=_watch, args=(job_id,), name=f"yume-job-watch-{job_id}", daemon=True).start()
    _LOG.info("job %s %s queued", job_id, kind)
    return public(_JOBS[job_id])


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
    threading.Thread(target=_run, args=(job_id, body, None), daemon=True).start()
    return get(job_id) or {}


def mark(job_id: str, note: str, progress: float | None = None) -> None:
    _LOG.info("job %s %s", job_id, note)
    with _LOCK:
        current = _JOBS.get(job_id)
        if not current or current["status"] not in {"queued", "running"}:
            return
        current["note"] = note
        current["touched"] = time.time()
        if progress is not None:
            current["progress"] = max(float(current.get("progress") or 0), float(progress))


def _run(job_id: str, body: Any, task: Task | None = None) -> None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job or job["status"] not in {"queued", "running"}:
            return
        job["status"] = "running"
        job["touched"] = time.time()
    delay = float(os_delay())
    if delay:
        time.sleep(delay)
    with _LOCK:
        job = _JOBS[job_id]
        if job.get("cancel") or job["status"] in {"cancelled", "paused", "failed"}:
            return

    def on_progress(note: str, fraction: float | None = None) -> None:
        mark(job_id, note, fraction)

    try:
        if task is None:
            from yume_server.generate import generate_images

            images, seeds, model, consistency, switched = generate_images(body, on_progress=lambda note: on_progress(note, None))
            payload = {
                "images": images,
                "seeds": seeds,
                "model": model,
                "scheduler": getattr(body, "scheduler", ""),
                "consistency": consistency,
                "switched": switched,
            }
        else:
            payload = task(body, on_progress)
            if not isinstance(payload, dict):
                payload = {"value": payload}
    except Exception as exc:  # noqa: BLE001
        from yume_server.upscale import picture_failure

        message = picture_failure(exc)
        _LOG.exception("job %s failed: %s", job_id, message)
        with _LOCK:
            job = _JOBS[job_id]
            if job["status"] in {"cancelled", "paused"}:
                return
            job["status"] = "failed"
            job["error"] = message
            job["note"] = message
        return
    with _LOCK:
        job = _JOBS[job_id]
        if job.get("cancel") or job["status"] in {"cancelled", "paused", "failed"}:
            _LOG.info("job %s finished after it was already %s", job_id, job["status"])
            return
        job["payload"] = payload
        job["images"] = payload.get("images") or []
        job["seeds"] = payload.get("seeds") or []
        job["model"] = payload.get("model")
        job["consistency"] = payload.get("consistency")
        job["switched"] = payload.get("switched")
        if payload.get("switched") and not job.get("note"):
            job["note"] = f"Switched to {payload.get('model')}"
        job["progress"] = 1
        job["status"] = "done"
        job["touched"] = time.time()
        _LOG.info("job %s done", job_id)


def _watch(job_id: str) -> None:
    """A hung ControlNet load logs nothing on its own. Fail it with the last step."""
    while True:
        time.sleep(15)
        with _LOCK:
            job = _JOBS.get(job_id)
            if not job or job["status"] not in {"queued", "running"}:
                return
            now = time.time()
            note = str(job.get("note") or "starting")
            if now - float(job["created"]) > LIMIT_SECONDS:
                job["status"] = "failed"
                job["error"] = f"Stopped after 25 minutes. Last step: {note}. The picture was not changed."
                _LOG.error("job %s timed out at %s", job_id, note)
                return
            if now - float(job.get("touched") or job["created"]) > STALL_SECONDS:
                job["status"] = "failed"
                job["error"] = f"No progress for 8 minutes at {note}. The picture was not changed."
                _LOG.error("job %s stalled at %s", job_id, note)
                return
        _LOG.info("job %s still running: %s", job_id, note)


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
        "step": job.get("note") or "",
        "ready": job["status"] == "done",
    }


def result(job_id: str) -> dict[str, Any]:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job:
            raise KeyError(job_id)
        if job["status"] == "failed":
            raise RuntimeError(str(job.get("error") or "The picture could not be finished."))
        if job["status"] != "done":
            raise RuntimeError("That job is not finished.")
        payload = job.get("payload")
        if isinstance(payload, dict):
            return payload
        return {"images": job.get("images") or [], "seeds": job.get("seeds") or [], "model": job.get("model")}
