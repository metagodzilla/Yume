"""Image-to-GLB jobs on the same picture server.

Mock mode writes a tiny GLB immediately. A real GPU run downloads TripoSR on
first use, frees the SDXL pipeline while the mesh is built, then loads that
checkpoint again. Marching cubes uses scikit-image so this needs no nvcc.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import struct
import subprocess
import sys
import threading
import uuid
from pathlib import Path
from typing import Any

_LOG = logging.getLogger("yume.threed")
_JOBS: dict[str, dict[str, Any]] = {}
_LOCK = threading.Lock()
_TRIPOSR = "stabilityai/TripoSR"
_CODE_URL = "https://github.com/VAST-AI-Research/TripoSR/archive/refs/heads/main.zip"
_DEPS = (
    "einops==0.7.0",
    "omegaconf==2.3.0",
    "antlr4-python3-runtime==4.9.3",
    "trimesh==4.0.5",
    "scikit-image==0.24.0",
    "imageio==2.36.1",
    "lazy_loader==0.4",
    "tifffile==2024.9.20",
    "networkx==3.2.1",
    "packaging==24.2",
)


def minimal_glb() -> bytes:
    positions = struct.pack("<9f", 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0)
    document = {
        "asset": {"version": "2.0"},
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "buffers": [{"byteLength": len(positions)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(positions)}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}],
    }
    payload = json.dumps(document, separators=(",", ":")).encode("utf-8")
    payload += b" " * ((4 - len(payload) % 4) % 4)
    blob = positions + b"\x00" * ((4 - len(positions) % 4) % 4)
    total = 12 + 8 + len(payload) + 8 + len(blob)
    return b"".join(
        (
            struct.pack("<4sII", b"glTF", 2, total),
            struct.pack("<I4s", len(payload), b"JSON"),
            payload,
            struct.pack("<I4s", len(blob), b"BIN\x00"),
            blob,
        )
    )


def _root() -> Path:
    root = Path(os.environ.get("YUME_MODEL_DIR", "/models")) / "triposr"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _job_dir() -> Path:
    path = _root() / "jobs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def job_view(job_id: str) -> dict[str, Any] | None:
    with _LOCK:
        item = _JOBS.get(job_id)
        if item is None:
            return None
        return {"id": job_id, "status": item["status"], "error": item.get("error") or "", "model": item.get("model") or ""}


def glb_path(job_id: str) -> str:
    with _LOCK:
        item = _JOBS.get(job_id) or {}
        return str(item.get("glb") or "")


def start_job(image_b64: str, views: list[dict[str, str]] | None = None) -> str:
    from yume_server.generate import mock_mode

    raw = base64.b64decode(image_b64, validate=False)
    if not raw:
        raise ValueError("The 3D request needs an image.")
    job_id = uuid.uuid4().hex
    extra = len(views or [])
    if mock_mode():
        path = _job_dir() / f"{job_id}.glb"
        path.write_bytes(minimal_glb())
        with _LOCK:
            _JOBS[job_id] = {"status": "done", "error": "", "glb": str(path), "model": "yume-mock-mesh"}
        return job_id
    with _LOCK:
        _JOBS[job_id] = {"status": "queued", "error": "", "glb": "", "model": _TRIPOSR}
    threading.Thread(target=_run, args=(job_id, raw, extra), daemon=True).start()
    return job_id


def install_marching_cubes_shim() -> None:
    """TripoSR imports torchmcubes. Serve it from scikit-image instead of a CUDA build."""
    import types

    import torch
    from skimage.measure import marching_cubes as skimage_cubes

    def marching_cubes(volume: Any, level: float) -> tuple[Any, Any]:
        array = volume.detach().cpu().numpy() if hasattr(volume, "detach") else volume
        verts, faces, _normals, _values = skimage_cubes(array, level=float(level))
        return torch.as_tensor(verts, dtype=torch.float32), torch.as_tensor(faces.astype("int64"))

    module = types.ModuleType("torchmcubes")
    module.marching_cubes = marching_cubes  # type: ignore[attr-defined]
    sys.modules["torchmcubes"] = module


def install_import_shims() -> None:
    """Skip rembg. Background removal needs onnxruntime, which this image does not have."""
    import types

    if "rembg" not in sys.modules:
        rembg = types.ModuleType("rembg")

        def remove(image: Any, session: Any = None, **_kwargs: Any) -> Any:
            return image.convert("RGBA") if hasattr(image, "convert") else image

        rembg.remove = remove  # type: ignore[attr-defined]
        rembg.new_session = lambda *_args, **_kwargs: None  # type: ignore[attr-defined]
        sys.modules["rembg"] = rembg


def ensure_threed_deps() -> None:
    missing = []
    for name in ("einops", "omegaconf", "trimesh", "skimage", "imageio"):
        try:
            __import__(name)
        except Exception:
            missing.append(name)
    if not missing:
        return
    _LOG.info("installing 3d packages %s", " ".join(_DEPS))
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-deps", *_DEPS])


def _code_dir() -> Path:
    dest = _root() / "TripoSR-main"
    if (dest / "tsr" / "system.py").is_file():
        return dest
    import io
    import zipfile
    from urllib.request import urlopen

    _LOG.info("downloading TripoSR code")
    with urlopen(_CODE_URL, timeout=120) as response:
        blob = response.read()
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        archive.extractall(_root())
    if not (dest / "tsr" / "system.py").is_file():
        raise RuntimeError("TripoSR code did not unpack.")
    return dest


def _weights_dir() -> Path:
    dest = _root() / "weights"
    config = dest / "config.yaml"
    weight = dest / "model.ckpt"
    if config.is_file() and weight.is_file():
        return dest
    from huggingface_hub import hf_hub_download

    dest.mkdir(parents=True, exist_ok=True)
    _LOG.info("downloading TripoSR weights")
    for name in ("config.yaml", "model.ckpt"):
        saved = hf_hub_download(_TRIPOSR, name, cache_dir=str(_root() / "hf"))
        target = dest / name
        if not target.is_file():
            target.write_bytes(Path(saved).read_bytes())
    return dest


def run_triposr(image: bytes) -> bytes:
    ensure_threed_deps()
    install_import_shims()
    install_marching_cubes_shim()
    code = _code_dir()
    if str(code) not in sys.path:
        sys.path.insert(0, str(code))
    import torch
    from PIL import Image
    import io

    from tsr.system import TSR

    weights = _weights_dir()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = TSR.from_pretrained(str(weights), config_name="config.yaml", weight_name="model.ckpt")
    model.renderer.set_chunk_size(8192)
    model.to(device)
    picture = Image.open(io.BytesIO(image)).convert("RGBA")
    with torch.no_grad():
        codes = model([picture], device=device)
        meshes = model.extract_mesh(codes, resolution=256)
    mesh = meshes[0]
    out = _root() / "last.glb"
    mesh.export(out)
    model.to("cpu")
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return out.read_bytes()


def _restore_checkpoint(version: int | None) -> None:
    if version is None:
        return
    from yume_server.generate import _load_record, find_checkpoint

    listed = find_checkpoint(str(version))
    if listed is None:
        return
    _load_record(listed)


def _run(job_id: str, image: bytes, _extra_views: int) -> None:
    from yume_server.generate import loaded_version, release_loaded

    version = loaded_version()
    try:
        with _LOCK:
            _JOBS[job_id]["status"] = "running"
        release_loaded()
        blob = run_triposr(image)
        path = _job_dir() / f"{job_id}.glb"
        path.write_bytes(blob)
        with _LOCK:
            _JOBS[job_id]["status"] = "done"
            _JOBS[job_id]["glb"] = str(path)
    except Exception as exc:
        _LOG.exception("3d job failed")
        with _LOCK:
            _JOBS[job_id]["status"] = "error"
            _JOBS[job_id]["error"] = str(exc) or "The mesh could not be built."
    finally:
        try:
            _restore_checkpoint(version)
        except Exception:
            _LOG.exception("checkpoint reload after 3d failed")
