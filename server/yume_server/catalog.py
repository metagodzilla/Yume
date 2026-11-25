"""Civitai model cache. Mock mode writes a stub instead of the multi-gigabyte file."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Callable

from yume_server.downloads import DownloadCancelled, DownloadPaused, download_resumable, resource_root

DEFAULT_VERSION = 1337429
OPT_VERSION = 1408658
HF_ANIMAGINE_URL = "https://huggingface.co/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0.safetensors"
HF_OPT_URL = "https://huggingface.co/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors"


class CivitaiAuthError(RuntimeError):
    """Civitai refused a download because no token was available."""


_INSTALLS: dict[str, dict[str, Any]] = {}
_INSTALL_LOCK = threading.Lock()
_PENDING_LOAD: int | None = None
_LOADED_DIR: str | None = None
_LAST_SAVE = 0.0
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
    "isDefault": False,
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


OPT_RECORD: dict[str, Any] = {
    "versionId": OPT_VERSION,
    "modelId": 1188071,
    "name": "Animagine XL 4.0 Opt",
    "version": "opt",
    "type": "Checkpoint",
    "baseModel": "SDXL 1.0",
    "filename": "animagine-xl-4.0-opt.safetensors",
    "hash": "",
    "sha256": "",
    "triggers": [],
    "isDefault": True,
    "source": "huggingface",
    "downloadUrl": HF_OPT_URL,
    "recommended": {"sampler": "Euler a", "steps": 26, "cfg": 6, "clipSkip": 2, "width": 896, "height": 1152},
}


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


def ensure_opt_default() -> dict[str, Any]:
    """Register the Anime Studio checkpoint and make it the default the first time it appears."""
    ensure_default()
    data = load_catalog()
    opt = next((item for item in data["models"] if item.get("versionId") == OPT_VERSION), None)
    if opt:
        return opt
    for item in data["models"]:
        if (item.get("type") or "Checkpoint") == "Checkpoint":
            item["isDefault"] = False
    record = dict(OPT_RECORD)
    data["models"].insert(0, record)
    save_catalog(data)
    return record


def materialize_opt() -> dict[str, Any]:
    """Download the Anime Studio single-file checkpoint. Its own VAE stays in the file."""
    record = dict(ensure_opt_default())
    path = os.path.join(model_dir(), record["filename"])
    record["path"] = path
    record["source"] = "huggingface"
    mock = os.environ.get("YUME_MOCK", "").strip() in {"1", "true", "yes"}
    if not mock and not (os.path.exists(path) and os.path.getsize(path) > 1_000_000):
        _materialize(record, None)
    elif mock and not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(b"yume-opt")
    _store_record(record)
    return record


def civitai_token(explicit: str | None) -> str | None:
    value = (explicit or os.environ.get("CIVITAI_TOKEN") or "").strip()
    return value or None


def download_plan(record: dict[str, Any], token: str | None) -> tuple[str, dict[str, str]]:
    """Default Animagine comes from Hugging Face. Other Civitai files need a token."""
    headers = {"User-Agent": "yume"}
    if record.get("versionId") == DEFAULT_VERSION:
        return HF_ANIMAGINE_URL, headers
    if record.get("versionId") == OPT_VERSION:
        return HF_OPT_URL, headers
    resolved = civitai_token(token)
    if not resolved:
        raise CivitaiAuthError(
            "Civitai needs your API key for this model. "
            "Set CIVITAI_TOKEN on the server, or save a Civitai API token in the app. "
            "The default Animagine XL 4.0 checkpoint downloads from Hugging Face and does not need one."
        )
    headers["Authorization"] = f"Bearer {resolved}"
    return f"https://civitai.com/api/download/models/{record['versionId']}?token={urllib.parse.quote(resolved, safe='')}", headers


def _materialize(
    record: dict[str, Any],
    token: str | None,
    on_progress: Callable[[int, int], None] | None = None,
    control: dict[str, Any] | None = None,
) -> None:
    dest = os.path.join(resource_root(record), record["filename"])
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
    try:
        download_resumable(
            url,
            dest,
            headers,
            on_progress,
            expected,
            str(record.get("sha256") or ""),
            control,
        )
    except RuntimeError as exc:
        if "Civitai needs your API key" in str(exc):
            raise CivitaiAuthError(str(exc)) from exc
        raise


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
    record = job.get("record") or {}
    return {
        "id": job["id"],
        "versionId": job["versionId"],
        "state": job["state"],
        "bytesDone": job.get("bytesDone") or 0,
        "bytesTotal": job.get("bytesTotal") or 0,
        "bytesPerSecond": job.get("bytesPerSecond") or 0,
        "etaSeconds": job.get("etaSeconds"),
        "error": job.get("error") or "",
        "record": job.get("record"),
        "type": record.get("type") or job.get("type") or "Checkpoint",
        "name": record.get("name") or job.get("name") or "",
    }


def _jobs_path() -> str:
    return os.path.join(model_dir(), "installs.json")


def _persistable(job: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in job.items() if not key.startswith("_")}


def _save_jobs(force: bool = False) -> None:
    global _LAST_SAVE
    now = time.monotonic()
    if not force and now - _LAST_SAVE < 1:
        return
    _LAST_SAVE = now
    with _INSTALL_LOCK:
        blob = {"jobs": [_persistable(job) for job in _INSTALLS.values()]}
    path = _jobs_path()
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(blob, handle)
    os.replace(temporary, path)


def _attach_control(job: dict[str, Any]) -> None:
    job.setdefault("_pause", threading.Event())
    job.setdefault("_cancel", threading.Event())
    if job.get("state") == "paused":
        job["_pause"].set()


def _partial_bytes(job: dict[str, Any]) -> int:
    record = job.get("record") or {}
    path = record.get("path")
    partial = f"{path}.part" if path else ""
    if partial and os.path.exists(partial):
        return os.path.getsize(partial)
    return int(job.get("bytesDone") or 0)


def ensure_jobs_loaded() -> None:
    global _LOADED_DIR
    root = model_dir()
    if _LOADED_DIR == root:
        return
    _LOADED_DIR = root
    with _INSTALL_LOCK:
        _INSTALLS.clear()
    try:
        with open(_jobs_path(), encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return
    for job in data.get("jobs") or []:
        if not isinstance(job, dict) or not job.get("id"):
            continue
        if job.get("state") in {"queued", "downloading"}:
            job["state"] = "paused"
            job["bytesDone"] = _partial_bytes(job)
            job["error"] = ""
        _attach_control(job)
        _INSTALLS[job["id"]] = job


def _set_install(job_id: str, **fields: Any) -> None:
    with _INSTALL_LOCK:
        job = _INSTALLS[job_id]
        if job.get("_cancel") is not None and job["_cancel"].is_set() and fields.get("state") in {"downloading", "done"}:
            return
        if job.get("_pause") is not None and job["_pause"].is_set() and fields.get("state") == "downloading":
            fields = {key: value for key, value in fields.items() if key != "state"}
        job.update(fields)
        job["updatedAt"] = time.time()
        done = int(job.get("bytesDone") or 0)
        total = int(job.get("bytesTotal") or 0)
        now = time.monotonic()
        stamp = float(job.get("_speed_at") or now)
        base = int(job.get("_speed_bytes") or done)
        elapsed = now - stamp
        if elapsed >= 0.4:
            job["bytesPerSecond"] = max(0, (done - base) / elapsed) if done >= base else 0
            job["_speed_at"] = now
            job["_speed_bytes"] = done
        speed = float(job.get("bytesPerSecond") or 0)
        job["etaSeconds"] = int((total - done) / speed) if speed > 0 and total > done else None
    _save_jobs(force=fields.get("state") in {"done", "error", "paused", "cancelled", "queued"})


def install_progress(job_id: str) -> dict[str, Any]:
    ensure_jobs_loaded()
    with _INSTALL_LOCK:
        job = _INSTALLS.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return _install_view(job)


def list_installs() -> list[dict[str, Any]]:
    ensure_jobs_loaded()
    with _INSTALL_LOCK:
        jobs = sorted(_INSTALLS.values(), key=lambda item: item.get("updatedAt") or 0, reverse=True)
        return [_install_view(job) for job in jobs]


def _run_install(job_id: str, version_id: int, token: str | None, hint: dict[str, Any] | None = None) -> None:
    try:
        if version_id == DEFAULT_VERSION:
            record = ensure_default()
            _set_install(job_id, state="done", record=record, error="", type="Checkpoint", name=record.get("name") or "")
            return
        if version_id == OPT_VERSION:
            record = materialize_opt()
            size = os.path.getsize(record["path"]) if record.get("path") and os.path.exists(record["path"]) else 0
            _set_install(job_id, state="done", record=record, error="", type="Checkpoint", name=record.get("name") or "", bytesDone=size, bytesTotal=size)
            _maybe_load_restored(OPT_VERSION, "Checkpoint")
            return
        with _INSTALL_LOCK:
            existing = (_INSTALLS.get(job_id) or {}).get("record")
            control = {
                "pause": _INSTALLS[job_id]["_pause"],
                "cancel": _INSTALLS[job_id]["_cancel"],
            }
        record = existing or _describe_version(version_id, token, hint)
        _set_install(job_id, record=record, type=record.get("type") or "Checkpoint", name=record.get("name") or "")

        def on_progress(done: int, total: int) -> None:
            _set_install(job_id, state="downloading", bytesDone=done, bytesTotal=total or int(record.get("bytes") or 0))

        if control["cancel"].is_set():
            raise DownloadCancelled()
        if control["pause"].is_set():
            raise DownloadPaused()
        _set_install(job_id, state="downloading", bytesTotal=int(record.get("bytes") or 0), error="")
        _materialize(record, token, on_progress, control)
        _store_record(record)
        size = os.path.getsize(record["path"]) if record.get("path") and os.path.exists(record["path"]) else 0
        _set_install(job_id, state="done", bytesDone=size, bytesTotal=size or int(record.get("bytes") or 0), record=record, error="")
        _maybe_load_restored(int(version_id), str(record.get("type") or "Checkpoint"))
    except DownloadPaused:
        _set_install(job_id, state="paused", error="")
    except DownloadCancelled:
        _set_install(job_id, state="cancelled", error="", bytesPerSecond=0, etaSeconds=None)
    except CivitaiAuthError as exc:
        _LOG.warning("install refused for %s: %s", version_id, exc)
        _set_install(job_id, state="error", error=str(exc))
    except Exception as exc:
        from yume_server.selfheal import record_network_error

        record_network_error(exc)
        _LOG.exception("install failed for version %s", version_id)
        _set_install(job_id, state="error", error=str(exc) or "The download failed.")


def _describe_version(version_id: int, token: str | None, hint: dict[str, Any] | None = None) -> dict[str, Any]:
    hint = hint or {}
    mock = os.environ.get("YUME_MOCK", "").strip() in {"1", "true", "yes"}
    if mock:
        kind = str(hint.get("type") or "Checkpoint")
        return {
            "versionId": version_id,
            "modelId": 0,
            "name": str(hint.get("name") or f"Civitai {version_id}"),
            "version": "mock",
            "type": kind,
            "baseModel": str(hint.get("baseModel") or "SDXL 1.0"),
            "filename": str(hint.get("filename") or f"civitai-{version_id}.safetensors"),
            "hash": "",
            "sha256": "",
            "triggers": list(hint.get("triggers") or []),
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


def _begin(job_id: str, version_id: int, token: str | None, hint: dict[str, Any] | None) -> None:
    threading.Thread(target=_run_install, args=(job_id, version_id, civitai_token(token), hint), daemon=True).start()


def _maybe_load_restored(version_id: int, kind: str) -> None:
    global _PENDING_LOAD
    if kind != "Checkpoint" or _PENDING_LOAD != version_id:
        return
    _PENDING_LOAD = None
    try:
        from yume_server.generate import start_use

        start_use(version_id)
    except Exception:
        _LOG.exception("restored checkpoint %s could not be loaded", version_id)


def restore_models(version_ids: list[int], last_used: int | None, hints: dict[int, dict[str, Any]], token: str | None) -> dict[str, Any]:
    """Download missing Civitai models, then load the last-used checkpoint."""
    global _PENDING_LOAD
    installed = {int(item.get("versionId") or 0) for item in list_models()}
    pending = None
    if last_used and last_used != DEFAULT_VERSION and last_used not in installed:
        _PENDING_LOAD = last_used
        pending = last_used
    jobs = []
    for version_id in version_ids:
        if version_id == DEFAULT_VERSION or version_id in installed:
            continue
        jobs.append(start_install(version_id, token, hints.get(version_id)))
    if last_used and last_used in installed:
        from yume_server.generate import loaded_version, start_use

        if loaded_version() != last_used:
            start_use(last_used)
    return {"jobs": jobs, "pendingLoad": pending, "installed": sorted(installed)}


def start_install(version_id: int, token: str | None, hint: dict[str, Any] | None = None) -> dict[str, Any]:
    """Start a download and return immediately. The same version reattaches to a live or paused job."""
    ensure_jobs_loaded()
    hint = hint or {}
    with _INSTALL_LOCK:
        for job in _INSTALLS.values():
            if job["versionId"] != version_id or job["state"] in {"done", "cancelled"}:
                continue
            if job["state"] in {"queued", "downloading"}:
                return _install_view(job)
            job_id = job["id"]
            job["_pause"].clear()
            job["_cancel"].clear()
            job["state"] = "queued"
            job["error"] = ""
            view = _install_view(job)
            break
        else:
            job_id = uuid.uuid4().hex[:12]
            job = {
                "id": job_id,
                "versionId": version_id,
                "state": "queued",
                "bytesDone": 0,
                "bytesTotal": 0,
                "bytesPerSecond": 0,
                "etaSeconds": None,
                "error": "",
                "record": None,
                "type": hint.get("type") or "Checkpoint",
                "name": hint.get("name") or "",
                "updatedAt": time.time(),
            }
            _attach_control(job)
            _INSTALLS[job_id] = job
            view = _install_view(job)
    _save_jobs(force=True)
    _begin(job_id, version_id, token, hint)
    return view


def pause_install(job_id: str) -> dict[str, Any]:
    ensure_jobs_loaded()
    with _INSTALL_LOCK:
        job = _INSTALLS.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job["state"] in {"done", "cancelled"}:
            raise ValueError("That download is not running.")
        job["_pause"].set()
        job["_cancel"].clear()
        job["state"] = "paused"
        job["bytesPerSecond"] = 0
        job["etaSeconds"] = None
        job["updatedAt"] = time.time()
        view = _install_view(job)
    _save_jobs(force=True)
    return view


def resume_install(job_id: str, token: str | None) -> dict[str, Any]:
    ensure_jobs_loaded()
    with _INSTALL_LOCK:
        job = _INSTALLS.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job["state"] == "cancelled":
            raise ValueError("That download was cancelled. Start it again.")
        if job["state"] in {"queued", "downloading", "done"}:
            return _install_view(job)
        job["_pause"].clear()
        job["_cancel"].clear()
        job["state"] = "queued"
        job["error"] = ""
        job["updatedAt"] = time.time()
        version_id = int(job["versionId"])
        view = _install_view(job)
    _save_jobs(force=True)
    _begin(job_id, version_id, token, None)
    return view


def cancel_install(job_id: str) -> dict[str, Any]:
    ensure_jobs_loaded()
    partial = ""
    with _INSTALL_LOCK:
        job = _INSTALLS.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job["state"] == "done":
            raise ValueError("That download already finished.")
        job["_cancel"].set()
        job["_pause"].clear()
        record = job.get("record") or {}
        if record.get("path"):
            partial = str(record["path"]) + ".part"
        if job["state"] != "downloading":
            job["state"] = "cancelled"
            job["error"] = ""
            job["bytesPerSecond"] = 0
            job["etaSeconds"] = None
            job["updatedAt"] = time.time()
        view = _install_view(job)
    if partial and os.path.exists(partial):
        os.remove(partial)
    _save_jobs(force=True)
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
