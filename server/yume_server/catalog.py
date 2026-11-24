"""Civitai model cache. Mock mode writes a stub instead of the multi-gigabyte file."""

from __future__ import annotations

import json
import logging
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Callable

DEFAULT_VERSION = 1337429
HF_ANIMAGINE_URL = "https://huggingface.co/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0.safetensors"


class CivitaiAuthError(RuntimeError):
    """Civitai refused a download because no token was available."""


_INSTALLS: dict[str, dict[str, Any]] = {}
_INSTALL_LOCK = threading.Lock()
_LOG = logging.getLogger("yume.install")
DEFAULT_RECORD: dict[str, Any] = {
    "versionId": DEFAULT_VERSION,
    "modelId": 1188071,
    "name": "Animagine XL 4.0",
    "version": "v4.0",
    "type": "Checkpoint",
    "baseModel": "SDXL 1.0",
    "filename": "animagine-xl-4.0.safetensors",
    "hash": "1d5b43ff75",
    "sha256": "1D5B43FF75B6AB598502D4C779D2FBFA3DCECA51C60C3B609640A60772333916",
    "triggers": [],
    "isDefault": True,
    "recommended": {
        "sampler": "Euler a",
        "steps": 25,
        "cfg": 6,
        "clipSkip": 2,
        "width": 832,
        "height": 1216,
        "quality": "masterpiece, high score, great score, absurdres",
        "negative": "lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry",
    },
}


def model_dir() -> str:
    root = os.environ.get("YUME_MODEL_DIR", "/models")
    os.makedirs(root, exist_ok=True)
    return root


def _path() -> str:
    return os.path.join(model_dir(), "catalog.json")


def load_catalog() -> dict[str, Any]:
    try:
        with open(_path(), encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        data = {"models": []}
    if not isinstance(data.get("models"), list):
        data["models"] = []
    return data


def save_catalog(data: dict[str, Any]) -> None:
    with open(_path(), "w", encoding="utf-8") as handle:
        json.dump(data, handle)


def list_models() -> list[dict[str, Any]]:
    return list(load_catalog()["models"])


def ensure_default() -> dict[str, Any]:
    """Register Animagine without downloading the single-file checkpoint.

    Startup loads the diffusers folders once. The root ``*.safetensors`` files
    are the same weights again, so they are not fetched here.
    """
    data = load_catalog()
    found = next((item for item in data["models"] if item.get("versionId") == DEFAULT_VERSION), None)
    if found:
        return found
    record = dict(DEFAULT_RECORD)
    record["source"] = "diffusers"
    record["path"] = ""
    data["models"].insert(0, record)
    save_catalog(data)
    return record


def civitai_token(explicit: str | None) -> str | None:
    value = (explicit or os.environ.get("CIVITAI_TOKEN") or "").strip()
    return value or None


def download_plan(record: dict[str, Any], token: str | None) -> tuple[str, dict[str, str]]:
    """Default Animagine comes from Hugging Face. Other Civitai files need a token."""
    headers = {"User-Agent": "yume"}
    if record.get("versionId") == DEFAULT_VERSION:
        return HF_ANIMAGINE_URL, headers
    resolved = civitai_token(token)
    if not resolved:
        raise CivitaiAuthError(
            "Civitai needs your API key for this model. "
            "Set CIVITAI_TOKEN on the server, or save a Civitai API token in the app. "
            "The default Animagine XL 4.0 checkpoint downloads from Hugging Face and does not need one."
        )
    headers["Authorization"] = f"Bearer {resolved}"
    return f"https://civitai.com/api/download/models/{record['versionId']}?token={urllib.parse.quote(resolved, safe='')}", headers


def _public_url(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def _download(
    url: str,
    dest: str,
    headers: dict[str, str],
    on_progress: Callable[[int, int], None] | None = None,
    total_hint: int = 0,
) -> None:
    class _Redirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, hdrs, newurl):  # noqa: ANN001
            host = urllib.parse.urlparse(newurl).hostname or ""
            forwarded = {
                key: value
                for key, value in headers.items()
                if not (key.lower() == "authorization" and "civitai.com" not in host)
            }
            return urllib.request.Request(newurl, headers=forwarded, method="GET")

    opener = urllib.request.build_opener(_Redirect)
    request = urllib.request.Request(url, headers=headers)
    partial = dest + ".part"
    try:
        response = opener.open(request, timeout=120)
    except urllib.error.HTTPError as exc:
        _LOG.error("download HTTP %s from %s", exc.code, _public_url(url))
        if exc.code in {401, 403}:
            raise CivitaiAuthError(
                "Civitai needs your API key for this model. Set CIVITAI_TOKEN on the server, or save a Civitai API token in the app."
            ) from exc
        raise RuntimeError(f"Download failed with HTTP {exc.code}.") from exc
    total = int(response.headers.get("Content-Length") or total_hint or 0)
    done = 0
    try:
        with response, open(partial, "wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
                done += len(chunk)
                if on_progress:
                    on_progress(done, total)
    except Exception:
        _LOG.exception("download stream failed for %s", _public_url(url))
        if os.path.exists(partial):
            os.remove(partial)
        raise
    os.replace(partial, dest)


def _materialize(
    record: dict[str, Any],
    token: str | None,
    on_progress: Callable[[int, int], None] | None = None,
) -> None:
    dest = os.path.join(model_dir(), record["filename"])
    record["path"] = dest
    expected = int(record.get("bytes") or 0)
    mock = os.environ.get("YUME_MOCK", "").strip() in {"1", "true", "yes"}
    if mock:
        if not os.path.exists(dest):
            with open(dest, "wb") as handle:
                handle.write(b"yume-stub")
        size = os.path.getsize(dest)
        if on_progress:
            on_progress(size, size)
        return
    if os.path.exists(dest) and ((expected and os.path.getsize(dest) >= expected) or (not expected and os.path.getsize(dest) > 1_000_000)):
        size = os.path.getsize(dest)
        if on_progress:
            on_progress(size, expected or size)
        return
    url, headers = download_plan(record, token)
    _download(url, dest, headers, on_progress, expected)


def install_version(version_id: int, token: str | None) -> dict[str, Any]:
    if version_id == DEFAULT_VERSION:
        ensure_default()
        return next(item for item in list_models() if item["versionId"] == DEFAULT_VERSION)
    mock = os.environ.get("YUME_MOCK", "").strip() in {"1", "true", "yes"}
    if mock:
        record = {
            "versionId": version_id,
            "modelId": 0,
            "name": f"Civitai {version_id}",
            "version": "mock",
            "type": "Checkpoint",
            "baseModel": "SDXL 1.0",
            "filename": f"civitai-{version_id}.safetensors",
            "hash": "",
            "sha256": "",
            "triggers": [],
            "isDefault": False,
        }
    else:
        request = urllib.request.Request(
            f"https://civitai.com/api/v1/model-versions/{version_id}",
            headers={"User-Agent": "yume", **({"Authorization": f"Bearer {token}"} if token else {})},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            remote = json.load(response)
        files = remote.get("files") or [{}]
        primary = next((item for item in files if item.get("primary")), files[0])
        hashes = primary.get("hashes") or {}
        record = {
            "versionId": version_id,
            "modelId": remote.get("modelId") or 0,
            "name": (remote.get("model") or {}).get("name") or remote.get("name") or f"Civitai {version_id}",
            "version": remote.get("name") or "",
            "type": (remote.get("model") or {}).get("type") or "Checkpoint",
            "baseModel": remote.get("baseModel") or "",
            "filename": primary.get("name") or f"civitai-{version_id}.safetensors",
            "hash": (hashes.get("AutoV2") or "")[:10].lower(),
            "sha256": hashes.get("SHA256") or "",
            "triggers": remote.get("trainedWords") or [],
            "isDefault": False,
            "bytes": int(float(primary.get("sizeKB") or 0) * 1024),
        }
    _materialize(record, token)
    _store_record(record)
    return record


def _store_record(record: dict[str, Any]) -> None:
    data = load_catalog()
    data["models"] = [item for item in data["models"] if item.get("versionId") != record.get("versionId")]
    data["models"].append(record)
    save_catalog(data)


def _install_view(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": job["id"],
        "versionId": job["versionId"],
        "state": job["state"],
        "bytesDone": job["bytesDone"],
        "bytesTotal": job["bytesTotal"],
        "error": job["error"],
        "record": job["record"],
    }


def _set_install(job_id: str, **fields: Any) -> None:
    with _INSTALL_LOCK:
        job = _INSTALLS[job_id]
        job.update(fields)


def install_progress(job_id: str) -> dict[str, Any]:
    with _INSTALL_LOCK:
        job = _INSTALLS.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return _install_view(job)


def _run_install(job_id: str, version_id: int, token: str | None) -> None:
    try:
        if version_id == DEFAULT_VERSION:
            record = ensure_default()
            _set_install(job_id, state="done", record=record, error="")
            return
        record = _describe_version(version_id, token)

        def on_progress(done: int, total: int) -> None:
            _set_install(job_id, state="downloading", bytesDone=done, bytesTotal=total or record.get("bytes") or 0)

        _set_install(job_id, state="downloading", bytesTotal=int(record.get("bytes") or 0))
        _materialize(record, token, on_progress)
        _store_record(record)
        size = os.path.getsize(record["path"]) if record.get("path") and os.path.exists(record["path"]) else 0
        _set_install(job_id, state="done", bytesDone=size, bytesTotal=size or int(record.get("bytes") or 0), record=record, error="")
    except CivitaiAuthError as exc:
        _LOG.warning("install refused for %s: %s", version_id, exc)
        _set_install(job_id, state="error", error=str(exc))
    except Exception as exc:
        _LOG.exception("install failed for version %s", version_id)
        _set_install(job_id, state="error", error=str(exc) or "The download failed.")


def _describe_version(version_id: int, token: str | None) -> dict[str, Any]:
    mock = os.environ.get("YUME_MOCK", "").strip() in {"1", "true", "yes"}
    if mock:
        return {
            "versionId": version_id,
            "modelId": 0,
            "name": f"Civitai {version_id}",
            "version": "mock",
            "type": "Checkpoint",
            "baseModel": "SDXL 1.0",
            "filename": f"civitai-{version_id}.safetensors",
            "hash": "",
            "sha256": "",
            "triggers": [],
            "isDefault": False,
            "bytes": 0,
        }
    resolved = civitai_token(token)
    headers = {"User-Agent": "yume"}
    if resolved:
        headers["Authorization"] = f"Bearer {resolved}"
    request = urllib.request.Request(f"https://civitai.com/api/v1/model-versions/{version_id}", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            remote = json.load(response)
    except urllib.error.HTTPError as exc:
        _LOG.error("Civitai model version %s returned HTTP %s", version_id, exc.code)
        if exc.code in {401, 403}:
            raise CivitaiAuthError(
                "Civitai needs your API key for this model. Set CIVITAI_TOKEN on the server, or save a Civitai API token in the app."
            ) from exc
        raise RuntimeError(f"Civitai returned HTTP {exc.code} for that version.") from exc
    files = remote.get("files") or [{}]
    primary = next((item for item in files if item.get("primary")), files[0])
    hashes = primary.get("hashes") or {}
    return {
        "versionId": version_id,
        "modelId": remote.get("modelId") or 0,
        "name": (remote.get("model") or {}).get("name") or remote.get("name") or f"Civitai {version_id}",
        "version": remote.get("name") or "",
        "type": (remote.get("model") or {}).get("type") or "Checkpoint",
        "baseModel": remote.get("baseModel") or "",
        "filename": primary.get("name") or f"civitai-{version_id}.safetensors",
        "hash": (hashes.get("AutoV2") or "")[:10].lower(),
        "sha256": hashes.get("SHA256") or "",
        "triggers": remote.get("trainedWords") or [],
        "isDefault": False,
        "bytes": int(float(primary.get("sizeKB") or 0) * 1024),
    }


def start_install(version_id: int, token: str | None) -> dict[str, Any]:
    """Start a download and return immediately. The gateway times out around 100 seconds."""
    with _INSTALL_LOCK:
        for job in _INSTALLS.values():
            if job["versionId"] == version_id and job["state"] in {"queued", "downloading"}:
                return _install_view(job)
        job_id = uuid.uuid4().hex[:12]
        job = {
            "id": job_id,
            "versionId": version_id,
            "state": "queued",
            "bytesDone": 0,
            "bytesTotal": 0,
            "error": "",
            "record": None,
        }
        _INSTALLS[job_id] = job
        view = _install_view(job)
    threading.Thread(target=_run_install, args=(job_id, version_id, civitai_token(token)), daemon=True).start()
    return view


def delete_version(version_id: int) -> None:
    data = load_catalog()
    target = next((item for item in data["models"] if item.get("versionId") == version_id), None)
    if target is None:
        raise FileNotFoundError("That model is not installed.")
    remaining = [item for item in data["models"] if item.get("versionId") != version_id]
    checkpoints = [item for item in remaining if item.get("type") == "Checkpoint"]
    if target.get("type") == "Checkpoint" and not checkpoints:
        raise ValueError("Keep at least one checkpoint installed.")
    if target.get("isDefault") and checkpoints:
        checkpoints[0]["isDefault"] = True
    path = target.get("path")
    if path and os.path.exists(path) and not str(path).endswith(DEFAULT_RECORD["filename"]):
        os.remove(path)
    data["models"] = remaining
    save_catalog(data)


def set_default(version_id: int) -> dict[str, Any]:
    data = load_catalog()
    chosen = next((item for item in data["models"] if item.get("versionId") == version_id), None)
    if chosen is None:
        raise FileNotFoundError("Install that model before making it the default.")
    if chosen.get("type") != "Checkpoint":
        raise ValueError("Only a checkpoint can be the default model.")
    for item in data["models"]:
        item["isDefault"] = item.get("versionId") == version_id
    save_catalog(data)
    return chosen
