"""Civitai model cache. Mock mode writes a stub instead of the multi-gigabyte file."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

DEFAULT_VERSION = 1337429
HF_ANIMAGINE_URL = "https://huggingface.co/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0.safetensors"


class CivitaiAuthError(RuntimeError):
    """Civitai refused a download because no token was available."""
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
    data = load_catalog()
    found = next((item for item in data["models"] if item.get("versionId") == DEFAULT_VERSION), None)
    if found:
        return found
    record = dict(DEFAULT_RECORD)
    _materialize(record, None)
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
            "Civitai refused the download (401) because no token is set. "
            "Set CIVITAI_TOKEN on the server, or save a Civitai API token in the app. "
            "The default Animagine XL 4.0 checkpoint downloads from Hugging Face and does not need one."
        )
    headers["Authorization"] = f"Bearer {resolved}"
    return f"https://civitai.com/api/download/models/{record['versionId']}", headers


def _download(url: str, dest: str, headers: dict[str, str]) -> None:
    request = urllib.request.Request(url, headers=headers)
    try:
        response = urllib.request.urlopen(request, timeout=300)
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            raise CivitaiAuthError(
                "Civitai refused the download (401). Set CIVITAI_TOKEN on the server, or save a Civitai API token in the app."
            ) from exc
        raise RuntimeError(f"Download failed with HTTP {exc.code}.") from exc
    with response, open(dest, "wb") as handle:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)


def _materialize(record: dict[str, Any], token: str | None) -> None:
    dest = os.path.join(model_dir(), record["filename"])
    record["path"] = dest
    mock = os.environ.get("YUME_MOCK", "").strip() in {"1", "true", "yes"}
    if mock:
        if not os.path.exists(dest):
            with open(dest, "wb") as handle:
                handle.write(b"yume-stub")
        return
    if os.path.exists(dest) and os.path.getsize(dest) > 1_000_000:
        return
    url, headers = download_plan(record, token)
    _download(url, dest, headers)


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
        }
    _materialize(record, token)
    data = load_catalog()
    data["models"] = [item for item in data["models"] if item.get("versionId") != version_id]
    data["models"].append(record)
    save_catalog(data)
    return record


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
