"""A short, on-disk ring of recent failures. Secrets are stripped before anything is stored."""

from __future__ import annotations

import json
import os
import re
import threading
import time
from collections import deque
from typing import Any

_LOCK = threading.Lock()
_ERRORS: deque[dict[str, Any]] = deque(maxlen=50)
_SECRET_NAME = re.compile(r"(token|authorization|api[-_]?key|password|secret)", re.I)
_SECRET_TEXT = (
    (re.compile(r"salad_cloud_user_\S+", re.I), "salad_cloud_user_…"),
    (re.compile(r"sk-[A-Za-z0-9_-]{6,}"), "sk-…"),
    (re.compile(r"(?i)(token=)[^&\s]+"), r"\1…"),
    (re.compile(r"(?i)(bearer\s+)\S+"), r"\1…"),
)


def _path() -> str:
    root = os.environ.get("YUME_MODEL_DIR", "/models")
    os.makedirs(root, exist_ok=True)
    return os.path.join(root, "errors.json")


def sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            if _SECRET_NAME.search(str(key)):
                cleaned[str(key)] = "[redacted]"
            else:
                cleaned[str(key)] = sanitize(item)
        return cleaned
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, str):
        text = value
        for pattern, replacement in _SECRET_TEXT:
            text = pattern.sub(replacement, text)
        return text[:4000]
    return value


def _load() -> None:
    try:
        with open(_path(), encoding="utf-8") as handle:
            saved = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return
    if isinstance(saved, list):
        for item in saved[-50:]:
            if isinstance(item, dict):
                _ERRORS.append(sanitize(item))


def _persist() -> None:
    try:
        with open(_path(), "w", encoding="utf-8") as handle:
            json.dump(list(_ERRORS), handle)
    except OSError:
        return


def record_error(
    *,
    endpoint: str,
    status: int,
    message: str,
    payload: Any = None,
    trace: str = "",
    source: str = "server",
) -> dict[str, Any]:
    item = sanitize(
        {
            "time": time.time(),
            "source": source,
            "endpoint": endpoint,
            "status": status,
            "message": message,
            "payload": payload,
            "traceback": trace,
        }
    )
    with _LOCK:
        _ERRORS.append(item)
        _persist()
        return dict(item)


def list_errors() -> list[dict[str, Any]]:
    with _LOCK:
        return [dict(item) for item in reversed(_ERRORS)]


def add_client_report(report: dict[str, Any]) -> dict[str, Any]:
    errors = report.get("errors") if isinstance(report.get("errors"), list) else []
    message = "Client report"
    if errors:
        first = errors[-1]
        if isinstance(first, dict) and first.get("message"):
            message = str(first.get("message"))
    return record_error(
        endpoint=str((report.get("request") or {}).get("endpoint") or "/client-report"),
        status=int((report.get("request") or {}).get("status") or 0),
        message=message,
        payload=report,
        source="client",
    )


_load()
