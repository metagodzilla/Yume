"""Resumable Civitai downloads. A dropped connection keeps the .part file and continues with HTTP Range."""

from __future__ import annotations

import hashlib
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

class DownloadPaused(Exception):
    """The caller asked this transfer to stop without deleting the partial file."""


class DownloadCancelled(Exception):
    """The caller asked this transfer to stop and delete the partial file."""


def retry_delay(attempt: int) -> float:
    return float(min(30, 2 ** max(0, min(attempt, 5))))


def range_headers(headers: dict[str, str], done: int) -> dict[str, str]:
    merged = dict(headers)
    if done > 0:
        merged["Range"] = f"bytes={done}-"
    return merged


def transfer_mode(status: int, done: int) -> str:
    """How to treat an HTTP response when some bytes are already on disk."""
    if done <= 0:
        return "write" if status == 200 else "error"
    if status == 206:
        return "append"
    if status == 200:
        return "write"
    if status == 416:
        return "complete"
    return "error"


def content_total(status: int, response_headers: Any, done: int, hint: int) -> int:
    if status == 206:
        span = response_headers.get("Content-Range") or response_headers.get("content-range") or ""
        if "/" in span:
            total = span.rsplit("/", 1)[-1].strip()
            if total.isdigit():
                return int(total)
    length = int(response_headers.get("Content-Length") or response_headers.get("content-length") or 0)
    if status == 200 and length:
        return length
    if status == 206 and length:
        return done + length
    return hint or 0


def file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_download(path: str, expected_size: int, expected_sha256: str) -> None:
    size = os.path.getsize(path)
    if expected_size and size != expected_size:
        raise RuntimeError(f"Download size is {size} bytes, expected {expected_size}.")
    wanted = (expected_sha256 or "").strip().lower()
    if wanted and file_sha256(path) != wanted:
        raise RuntimeError("Download hash does not match Civitai.")


def lora_root() -> str:
    """LoRAs land in /models/loras. A custom YUME_LORA_DIR is kept, except the old /loras default."""
    configured = os.environ.get("YUME_LORA_DIR", "").strip()
    if not configured or os.path.normpath(configured) == "/loras":
        return "/models/loras"
    return configured


def resource_root(record: dict[str, Any]) -> str:
    kind = str(record.get("type") or "Checkpoint").lower().replace(" ", "").replace("_", "")
    if kind in {"lora", "locon", "dora", "lycoris"}:
        root = lora_root()
    elif kind in {"textualinversion", "embedding", "embeddings"}:
        root = os.environ.get("YUME_EMBEDDING_DIR", "/embeddings")
    else:
        root = os.environ.get("YUME_MODEL_DIR", "/models")
    os.makedirs(root, exist_ok=True)
    return root


def _public_url(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def _redirect(headers: dict[str, str]) -> type[urllib.request.HTTPRedirectHandler]:
    class _Redirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, hdrs, newurl):  # noqa: ANN001
            host = urllib.parse.urlparse(newurl).hostname or ""
            forwarded = {
                key: value
                for key, value in headers.items()
                if not (key.lower() == "authorization" and "civitai.com" not in host)
            }
            return urllib.request.Request(newurl, headers=forwarded, method="GET")

    return _Redirect


def _urlopen(request: urllib.request.Request, timeout: int = 120) -> Any:
    opener = urllib.request.build_opener(_redirect(dict(request.headers)))
    return opener.open(request, timeout=timeout)


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def _stopped(control: dict[str, Any] | None) -> str | None:
    if not control:
        return None
    pause = control.get("pause")
    cancel = control.get("cancel")
    if cancel is not None and cancel.is_set():
        return "cancel"
    if pause is not None and pause.is_set():
        return "pause"
    return None


def download_resumable(
    url: str,
    dest: str,
    headers: dict[str, str],
    on_progress: Callable[[int, int], None] | None = None,
    total_hint: int = 0,
    expected_sha256: str = "",
    control: dict[str, Any] | None = None,
    attempts: int = 6,
) -> None:
    """Download to dest.part and retry with Range. Pause keeps the partial. Cancel deletes it."""
    partial = dest + ".part"
    done = os.path.getsize(partial) if os.path.exists(partial) else 0
    attempt = 0
    total = total_hint
    while True:
        stop = _stopped(control)
        if stop == "cancel":
            if os.path.exists(partial):
                os.remove(partial)
            raise DownloadCancelled()
        if stop == "pause":
            raise DownloadPaused()
        request_headers = range_headers(headers, done)
        request = urllib.request.Request(url, headers=request_headers)
        try:
            response = _urlopen(request, timeout=120)
        except urllib.error.HTTPError as exc:
            if exc.code in {401, 403}:
                raise RuntimeError(
                    "Civitai needs your API key for this model. Set CIVITAI_TOKEN on the server, or save a Civitai API token in the app."
                ) from exc
            if exc.code == 416 and done > 0:
                mode = "complete"
                response = None
            elif exc.code in {408, 429, 500, 502, 503, 504}:
                attempt += 1
                if attempt > attempts:
                    raise RuntimeError(f"Download failed with HTTP {exc.code}.") from exc
                _sleep(retry_delay(attempt))
                done = os.path.getsize(partial) if os.path.exists(partial) else 0
                continue
            else:
                raise RuntimeError(f"Download failed with HTTP {exc.code}.") from exc
        else:
            status = int(getattr(response, "status", 0) or response.getcode())
            mode = transfer_mode(status, done)
            if mode == "error":
                raise RuntimeError(f"Download failed with HTTP {status}.")
            total = content_total(status, response.headers, done, total_hint) or total
        if mode == "complete":
            break
        try:
            if mode == "write":
                done = 0
                handle_mode = "wb"
            else:
                handle_mode = "ab"
            with response, open(partial, handle_mode) as handle:
                while True:
                    stop = _stopped(control)
                    if stop == "cancel":
                        if os.path.exists(partial):
                            os.remove(partial)
                        raise DownloadCancelled()
                    if stop == "pause":
                        raise DownloadPaused()
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
                    done += len(chunk)
                    if on_progress:
                        on_progress(done, total or total_hint)
        except (DownloadPaused, DownloadCancelled):
            raise
        except Exception:
            attempt += 1
            done = os.path.getsize(partial) if os.path.exists(partial) else 0
            if on_progress:
                on_progress(done, total or total_hint)
            if attempt > attempts:
                raise RuntimeError("The download stopped. The partial file is still on disk and can be resumed.")
            _sleep(retry_delay(attempt))
            continue
        if total and done < total:
            attempt += 1
            if attempt > attempts:
                raise RuntimeError("The download stopped before the file was complete. Resume keeps the partial file.")
            _sleep(retry_delay(attempt))
            continue
        break
    if not os.path.exists(partial):
        raise RuntimeError("The download did not write a file.")
    try:
        verify_download(partial, total or total_hint, expected_sha256)
    except RuntimeError:
        if expected_sha256 and os.path.exists(partial):
            os.remove(partial)
        raise
    os.replace(partial, dest)
