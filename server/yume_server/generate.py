"""Image generation. YUME_MOCK=1 draws a tiny PNG and never imports torch."""

from __future__ import annotations

import base64
import os
import struct
import threading
import uuid
import zlib
from typing import Any

SCHEDULERS = ("euler_a", "euler", "dpm_2m", "dpm_2m_karras", "ddim", "lcm")
A1111_SAMPLERS = {
    "Euler a": "euler_a",
    "Euler": "euler",
    "DPM++ 2M": "dpm_2m",
    "DPM++ 2M Karras": "dpm_2m_karras",
    "DPM++ SDE Karras": "dpm_2m_karras",
    "DDIM": "ddim",
    "LMS": "euler",
    "Heun": "euler",
    "UniPC": "dpm_2m",
    "LCM": "lcm",
}
DEFAULT_MODEL = "cagliostrolab/animagine-xl-4.0"
# The repo also publishes these single-file checkpoints. Loading the diffusers
# folders already fetches the weights, so these files must not be downloaded too.
DIFFUSERS_IGNORE = (
    "animagine-xl-4.0.safetensors",
    "animagine-xl-4.0-opt.safetensors",
)

_PIPE: Any = None
_LOADED_VERSION: int | None = None
_LOADS: dict[str, dict[str, Any]] = {}
_LOAD_LOCK = threading.Lock()
DEFAULT_VERSION = 1337429


def mock_mode() -> bool:
    return os.environ.get("YUME_MOCK", "").strip() in {"1", "true", "yes"}


def model_id() -> str:
    return os.environ.get("YUME_MODEL_ID", DEFAULT_MODEL).strip() or DEFAULT_MODEL


def _allow_model(requested: str | None) -> str:
    chosen = (requested or "").strip() or model_id()
    if chosen == model_id():
        return chosen
    allow = [item.strip() for item in os.environ.get("YUME_MODEL_ALLOWLIST", "").split(",") if item.strip()]
    if chosen not in allow:
        raise ValueError("That checkpoint is not in YUME_MODEL_ALLOWLIST.")
    return chosen


def _png(width: int, height: int, seed: int) -> str:
    """A solid PNG so mock mode can be tested without Pillow or a GPU."""
    red = 40 + (seed % 80)
    green = 16 + ((seed >> 3) % 40)
    blue = 48 + ((seed >> 6) % 80)
    raw = bytearray()
    row = bytes([red, green, blue]) * width
    for _ in range(height):
        raw.append(0)
        raw.extend(row)
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 1)) + chunk(b"IEND", b"")
    return base64.b64encode(png).decode("ascii")


def diffusers_ignore_patterns() -> tuple[str, ...]:
    return DIFFUSERS_IGNORE


def loaded_version() -> int | None:
    return _LOADED_VERSION


def note_loaded(version_id: int) -> None:
    global _LOADED_VERSION
    _LOADED_VERSION = int(version_id)


def mark_default_loaded() -> None:
    note_loaded(DEFAULT_VERSION)


def start_model() -> None:
    global _PIPE
    from yume_server.startup import mark, note_download

    if mock_mode():
        mark_default_loaded()
        mark("ready", "Ready", done=1, total=1)
        return
    import torch
    from diffusers import StableDiffusionXLPipeline
    from huggingface_hub import snapshot_download
    from tqdm.auto import tqdm

    class _DownloadBar(tqdm):
        def update(self, n=1):
            shown = super().update(n)
            note_download(int(self.n or 0), int(self.total or 0))
            return shown

    mark("downloading", "Downloading model")
    cache = os.environ.get("HF_HOME") or os.environ.get("YUME_MODEL_DIR") or "/models"
    try:
        local = snapshot_download(
            repo_id=model_id(),
            cache_dir=os.path.join(cache, "hub"),
            ignore_patterns=list(DIFFUSERS_IGNORE),
            tqdm_class=_DownloadBar,
        )
        mark("loading", "Loading the model")
        _PIPE = StableDiffusionXLPipeline.from_pretrained(
            local,
            torch_dtype=torch.float16,
            use_safetensors=True,
            local_files_only=True,
        )
        _PIPE.to("cuda")
        _PIPE.enable_vae_slicing()
        mark_default_loaded()
        mark("ready", "Ready", done=1, total=1)
    except Exception as exc:
        mark("error", str(exc))
        raise


def _apply_scheduler(pipe: Any, name: str) -> None:
    from diffusers import (
        DDIMScheduler,
        DPMSolverMultistepScheduler,
        EulerAncestralDiscreteScheduler,
        EulerDiscreteScheduler,
        LCMScheduler,
    )

    config = pipe.scheduler.config
    if name == "euler_a":
        pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(config)
    elif name == "euler":
        pipe.scheduler = EulerDiscreteScheduler.from_config(config)
    elif name == "dpm_2m":
        pipe.scheduler = DPMSolverMultistepScheduler.from_config(config)
    elif name == "dpm_2m_karras":
        pipe.scheduler = DPMSolverMultistepScheduler.from_config(config, use_karras_sigmas=True)
    elif name == "ddim":
        pipe.scheduler = DDIMScheduler.from_config(config)
    elif name == "lcm":
        pipe.scheduler = LCMScheduler.from_config(config)


def _apply_loras(pipe: Any, loras: list[Any]) -> None:
    if not loras:
        return
    root = os.environ.get("YUME_LORA_DIR", "/loras")
    names: list[str] = []
    weights: list[float] = []
    for index, lora in enumerate(loras):
        filename = lora.name.strip()
        path = os.path.join(root, filename)
        if not os.path.exists(path):
            alt = path if path.endswith(".safetensors") else path + ".safetensors"
            path = alt if os.path.exists(alt) else path
        if not os.path.exists(path):
            raise FileNotFoundError(f"LoRA not found on the server: {filename}. Put the file in {root}.")
        adapter = f"lora_{index}"
        pipe.load_lora_weights(path, adapter_name=adapter)
        names.append(adapter)
        weights.append(float(lora.weight))
    pipe.set_adapters(names, weights)


def _consistency(body: Any) -> str:
    if not getattr(body, "reference_image", None):
        return "txt2img"
    flag = os.environ.get("YUME_IP_ADAPTER", "").strip().lower()
    if flag in {"1", "true", "yes"}:
        return "ip-adapter"
    return "img2img"


def _seed_list(body: Any) -> list[int]:
    count = max(1, int(getattr(body, "count", 1) or 1))
    raw = getattr(body, "seed", None)
    if raw is None or int(raw) < 0:
        import random

        base = random.randrange(0, 2_147_483_647)
    else:
        base = int(raw) % 2_147_483_647
    return [(base + index) % 2_147_483_647 for index in range(count)]


def generate_images(body: Any) -> tuple[list[str], list[int], str, str]:
    seeds = _seed_list(body)
    consistency = _consistency(body)
    chosen = selected_checkpoint_name(body)
    if mock_mode():
        from yume_server.metadata import embed_parameters, parameters_text

        bump = len(getattr(body, "reference_image", None) or "") % 97
        note = parameters_text(body, seeds[0] if seeds else 1)
        images = []
        for seed in seeds:
            raw = base64.b64decode(_png(body.width, body.height, seed + bump))
            images.append(base64.b64encode(embed_parameters(raw, note)).decode("ascii"))
        return images, seeds, chosen, consistency

    if _PIPE is None:
        raise RuntimeError("Model is not loaded.")
    _apply_scheduler(_PIPE, A1111_SAMPLERS.get(body.scheduler, body.scheduler))
    _apply_loras(_PIPE, body.loras)
    images: list[str] = []
    strength = float(getattr(body, "strength", 0.45) or 0.45)
    for seed in seeds:
        import torch

        generator = torch.Generator(device="cuda").manual_seed(seed)
        import inspect

        common = {
            "prompt": body.prompt,
            "negative_prompt": body.negative_prompt or None,
            "num_inference_steps": body.steps,
            "guidance_scale": body.cfg,
            "generator": generator,
        }
        if "clip_skip" in inspect.signature(_PIPE.__call__).parameters:
            common["clip_skip"] = getattr(body, "clip_skip", 2)
        if consistency == "ip-adapter":
            if not getattr(_PIPE, "_yume_ip", False):
                _PIPE.load_ip_adapter("h94/IP-Adapter", subfolder="sdxl_models", weight_name="ip-adapter_sdxl.bin")
                _PIPE.set_ip_adapter_scale(0.6)
                _PIPE._yume_ip = True
            result = _PIPE(**common, width=body.width, height=body.height, ip_adapter_image=_open_reference(body))
        elif consistency == "img2img":
            from diffusers import StableDiffusionXLImg2ImgPipeline

            img2img = StableDiffusionXLImg2ImgPipeline(**_PIPE.components)
            result = img2img(**common, image=_open_reference(body), strength=max(0.05, min(0.95, strength)))
        else:
            scale = float(getattr(body, "hires_scale", None) or 0)
            width = body.width
            height = body.height
            if scale > 1:
                width = max(512, int(body.width / scale) // 8 * 8)
                height = max(512, int(body.height / scale) // 8 * 8)
            result = _PIPE(**common, width=width, height=height)
            if scale > 1:
                from PIL import Image as PILImage

                from diffusers import StableDiffusionXLImg2ImgPipeline

                upscaled = result.images[0].resize((body.width, body.height), PILImage.Resampling.LANCZOS)
                img2img = StableDiffusionXLImg2ImgPipeline(**_PIPE.components)
                second = dict(common)
                second["num_inference_steps"] = int(getattr(body, "hires_steps", None) or body.steps)
                result = img2img(
                    **second,
                    image=upscaled,
                    strength=max(0.05, min(0.95, float(getattr(body, "hires_denoise", 0.45) or 0.45))),
                )
        from io import BytesIO

        buffer = BytesIO()
        result.images[0].save(buffer, format="PNG")
        images.append(base64.b64encode(buffer.getvalue()).decode("ascii"))
    return images, seeds, chosen, consistency


def uses_loaded_pipeline(requested: str, models: list[dict[str, Any]]) -> bool:
    """The default Animagine checkpoint is already loaded from diffusers, not a single file."""
    text = (requested or "").strip()
    if text in {"", model_id()}:
        return True
    match = next(
        (item for item in models if text in {item.get("filename"), item.get("name"), str(item.get("versionId") or "")}),
        None,
    )
    if match is None:
        return False
    if match.get("source") == "diffusers":
        return True
    return match.get("versionId") == 1337429 and not match.get("path")


def _checkpoints() -> list[dict[str, Any]]:
    from yume_server.catalog import list_models

    return [item for item in list_models() if (item.get("type") or "Checkpoint") == "Checkpoint"]


def find_checkpoint(requested: str | None) -> dict[str, Any] | None:
    """Match an installed checkpoint by version id, then by filename or display name."""
    models = _checkpoints()
    text = (requested or "").strip()
    if not text:
        return _active_or_default(models)
    if text.isdigit():
        match = next((item for item in models if str(item.get("versionId")) == text), None)
        if match:
            return match
    if text == model_id():
        return next((item for item in models if item.get("versionId") == DEFAULT_VERSION), None) or _active_or_default(models)
    return next(
        (item for item in models if text in {item.get("filename"), item.get("name"), str(item.get("versionId") or "")}),
        None,
    )


def _active_or_default(models: list[dict[str, Any]]) -> dict[str, Any] | None:
    active = loaded_version()
    if active is not None:
        found = next((item for item in models if item.get("versionId") == active), None)
        if found:
            return found
    return next((item for item in models if item.get("isDefault")), None) or (models[0] if models else None)


def selected_checkpoint_name(body: Any) -> str:
    requested = (getattr(body, "model", None) or "").strip()
    match = find_checkpoint(requested)
    if requested and match is None:
        raise ValueError("That checkpoint is not installed. Install it from Civitai first.")
    if match is None:
        return "Animagine XL 4.0"
    loaded = loaded_version()
    version = int(match.get("versionId") or 0)
    if loaded is not None and version != int(loaded):
        raise RuntimeError("That checkpoint is installed but not loaded. Tap Use and wait until it is ready.")
    if loaded is None and not mock_mode():
        raise RuntimeError("Model is not loaded.")
    return str(match.get("name") or requested or "Animagine XL 4.0")


def release_loaded() -> None:
    """Drop the resident pipeline before another checkpoint is loaded or deleted."""
    global _PIPE, _LOADED_VERSION
    pipe = _PIPE
    _PIPE = None
    _LOADED_VERSION = None
    if pipe is not None:
        try:
            pipe.to("cpu")
        except Exception:
            pass
        del pipe
    try:
        import gc

        gc.collect()
    except Exception:
        pass
    if mock_mode():
        return
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def _load_default_diffusers() -> None:
    global _PIPE
    import torch
    from diffusers import StableDiffusionXLPipeline
    from huggingface_hub import snapshot_download

    cache = os.environ.get("HF_HOME") or os.environ.get("YUME_MODEL_DIR") or "/models"
    local = snapshot_download(
        repo_id=model_id(),
        cache_dir=os.path.join(cache, "hub"),
        ignore_patterns=list(DIFFUSERS_IGNORE),
        local_files_only=True,
    )
    pipe = StableDiffusionXLPipeline.from_pretrained(
        local,
        torch_dtype=torch.float16,
        use_safetensors=True,
        local_files_only=True,
    )
    pipe.to("cuda")
    pipe.enable_vae_slicing()
    _PIPE = pipe


def _load_single_file(record: dict[str, Any]) -> None:
    global _PIPE
    path = record.get("path") or ""
    if not path or not os.path.exists(path) or os.path.getsize(path) < 1_000_000:
        raise ValueError("The weight file is not on disk yet. The first download of a checkpoint is several gigabytes.")
    import torch

    dtype = torch.float16
    base = str(record.get("baseModel") or "")
    if base.lower().startswith("flux"):
        from diffusers import FluxPipeline

        pipe = FluxPipeline.from_single_file(path, torch_dtype=dtype)
    elif base == "SD 1.5" or base.lower().startswith("sd 1"):
        from diffusers import StableDiffusionPipeline

        pipe = StableDiffusionPipeline.from_single_file(path, torch_dtype=dtype)
    else:
        from diffusers import StableDiffusionXLPipeline

        pipe = StableDiffusionXLPipeline.from_single_file(path, torch_dtype=dtype)
    pipe.to("cuda")
    pipe.enable_vae_slicing()
    _PIPE = pipe


def _load_record(record: dict[str, Any]) -> None:
    version = int(record.get("versionId") or 0)
    if mock_mode():
        note_loaded(version)
        return
    release_loaded()
    if record.get("source") == "diffusers" or (version == DEFAULT_VERSION and not record.get("path")):
        _load_default_diffusers()
    else:
        _load_single_file(record)
    note_loaded(version)


def _use_view(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": job["id"],
        "versionId": job["versionId"],
        "state": job["state"],
        "stage": job["stage"],
        "percent": job["percent"],
        "error": job["error"],
        "record": job["record"],
    }


def use_progress(job_id: str) -> dict[str, Any]:
    with _LOAD_LOCK:
        job = _LOADS.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return _use_view(job)


def _set_use(job_id: str, **fields: Any) -> None:
    with _LOAD_LOCK:
        _LOADS[job_id].update(fields)


def _run_use(job_id: str, version_id: int) -> None:
    from yume_server.catalog import set_default

    try:
        _set_use(job_id, state="loading", stage="Freeing video memory", percent=None)
        record = next(item for item in _checkpoints() if item.get("versionId") == version_id)
        if not mock_mode():
            release_loaded()
        _set_use(job_id, state="loading", stage="Loading checkpoint", percent=None)
        _load_record(record)
        chosen = set_default(version_id)
        _set_use(job_id, state="done", stage="Ready", percent=100, record=chosen, error="")
    except Exception as exc:
        _set_use(job_id, state="error", stage="Could not load", percent=None, error=str(exc) or "The checkpoint could not be loaded.")


def start_use(version_id: int) -> dict[str, Any]:
    """Load one installed checkpoint. The previous pipeline is released first so only one model stays in VRAM."""
    from yume_server.catalog import set_default

    record = next((item for item in _checkpoints() if item.get("versionId") == version_id), None)
    if record is None:
        raise FileNotFoundError("Install that checkpoint before using it.")
    if loaded_version() == version_id and (mock_mode() or _PIPE is not None):
        chosen = set_default(version_id)
        return {
            "id": "current",
            "versionId": version_id,
            "state": "done",
            "stage": "Ready",
            "percent": 100,
            "error": "",
            "record": chosen,
        }
    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "versionId": version_id,
        "state": "queued",
        "stage": "Queued",
        "percent": None,
        "error": "",
        "record": record,
    }
    with _LOAD_LOCK:
        _LOADS[job_id] = job
        view = _use_view(job)
    threading.Thread(target=_run_use, args=(job_id, version_id), daemon=True).start()
    return view


def _open_reference(body: Any):
    import io

    from PIL import Image

    raw = base64.b64decode(body.reference_image)
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    return image.resize((body.width, body.height))
