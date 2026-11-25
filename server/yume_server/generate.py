"""Image generation. YUME_MOCK=1 draws a tiny PNG and never imports torch."""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import struct
import threading
import uuid
import zlib
from typing import Any

_LOG = logging.getLogger("yume.generate")
FIXED_VAE_REPO = "madebyollin/sdxl-vae-fp16-fix"
ANIME_ESRGAN_URL = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"
_FIXED_VAE: str | None = None

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


def loaded_pipe() -> Any:
    return _PIPE


def note_loaded(version_id: int) -> None:
    global _LOADED_VERSION
    _LOADED_VERSION = int(version_id)


def mark_default_loaded() -> None:
    note_loaded(DEFAULT_VERSION)


def loaded_model_name() -> str:
    """The checkpoint that is actually loaded, from the catalog, not a hardcoded name."""
    from yume_server.catalog import list_models

    version = loaded_version()
    models = list_models()
    if version is not None:
        match = next((item for item in models if item.get("versionId") == version), None)
        if match and match.get("name"):
            return str(match["name"])
    default = next((item for item in models if item.get("isDefault") and (item.get("type") or "Checkpoint") == "Checkpoint"), None)
    if default and default.get("name"):
        return str(default["name"])
    return "Animagine XL 4.0"


def needs_fixed_vae(base_model: str, filename: str = "") -> bool:
    blob = f"{base_model} {filename}".lower()
    if "animagine-xl-4.0-opt" in blob or "4.0 opt" in blob:
        return False
    if "flux" in blob or "sd 1" in blob or "sd1" in blob:
        return False
    return any(token in blob for token in ("sdxl", "illustrious", "pony", "noob", "xl"))


def hires_plan(body: Any) -> dict[str, Any] | None:
    scale = float(getattr(body, "hires_scale", None) or 0)
    if scale <= 1:
        return None
    denoise = getattr(body, "hires_denoise", None)
    denoise_value = 0.4 if denoise is None else float(denoise)
    steps = int(getattr(body, "hires_steps", None) or 18)
    return {
        "scale": scale,
        "denoise": max(0.05, min(0.95, denoise_value)),
        "steps": max(1, min(50, steps)),
        "upscaler": str(getattr(body, "hires_upscaler", None) or "Latent"),
    }


def upscaler_kind(name: str) -> str:
    text = (name or "").lower()
    if "esrgan" in text or "animesharp" in text or "anime" in text:
        return "esrgan"
    return "latent"


def lora_directories() -> list[str]:
    """New installs use /models/loras. Older containers may still have files in /loras."""
    configured = os.environ.get("YUME_LORA_DIR", "").strip()
    primary = "/models/loras" if not configured or os.path.normpath(configured) == "/loras" else configured
    ordered = [primary, "/models/loras", "/loras"]
    seen: list[str] = []
    for path in ordered:
        if path and path not in seen:
            seen.append(path)
    return seen


def boot_checkpoint() -> dict[str, Any]:
    """Persisted catalog default, or YUME_DEFAULT_VERSION_ID, otherwise WAI-illustrious."""
    from yume_server.catalog import ensure_boot_default

    return ensure_boot_default()


def cache_dir() -> str:
    root = os.environ.get("HF_HOME") or os.environ.get("YUME_MODEL_DIR") or "/models"
    return os.path.join(root, "hub")


def ensure_fixed_vae() -> str | None:
    """Download the fp16-safe SDXL VAE once. A missing download does not stop boot."""
    global _FIXED_VAE
    if mock_mode():
        return None
    if _FIXED_VAE and os.path.isdir(_FIXED_VAE):
        return _FIXED_VAE
    try:
        from huggingface_hub import snapshot_download

        local = snapshot_download(FIXED_VAE_REPO, cache_dir=cache_dir(), allow_patterns=["*.json", "*.safetensors"])
    except Exception as exc:
        _LOG.warning("fixed VAE was not downloaded: %s", exc)
        return None
    _FIXED_VAE = local
    return local


def anime_upscaler_path() -> str:
    root = os.environ.get("YUME_MODEL_DIR") or "/models"
    return os.path.join(root, "upscalers", "RealESRGAN_x4plus_anime_6B.pth")


def ensure_anime_upscaler() -> str | None:
    """Best-effort anime ESRGAN. Generation still runs with a Lanczos upscale if this fails."""
    if mock_mode():
        return None
    path = anime_upscaler_path()
    if os.path.exists(path) and os.path.getsize(path) > 1_000_000:
        return path
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        import urllib.request

        from yume_server.startup import note_file

        def _report(block: int, block_size: int, total: int) -> None:
            note_file("upscaler", name="RealESRGAN anime", kind="Upscaler", done=block * block_size, total=total or 0, state="downloading")

        urllib.request.urlretrieve(ANIME_ESRGAN_URL, path, reporthook=_report)
        note_file("upscaler", name="RealESRGAN anime", kind="Upscaler", done=os.path.getsize(path), total=os.path.getsize(path), state="done")
    except Exception as exc:
        _LOG.warning("anime upscaler was not downloaded: %s", exc)
        return None
    return path if os.path.exists(path) else None


def start_model() -> None:
    from yume_server.selfheal import retry_startup
    from yume_server.startup import mark

    record = boot_checkpoint()
    version = int(record.get("versionId") or DEFAULT_VERSION)
    if mock_mode():
        note_loaded(version)
        mark("ready", "Ready", done=1, total=1)
        return

    def _once() -> None:
        from yume_server.catalog import materialize_checkpoint
        from yume_server.startup import note_download

        mark("downloading", "Downloading the fixed VAE")
        ensure_fixed_vae()
        ensure_anime_upscaler()
        name = str(record.get("name") or "WAI-illustrious-SDXL")
        path = str(record.get("path") or "")
        diffusers = record.get("source") == "diffusers" or (version == DEFAULT_VERSION and not path)
        if diffusers:
            note_download(0, 0, name=name)
            _load_default_diffusers()
        else:
            note_download(0, int(record.get("bytes") or 0), name=name)
            saved = materialize_checkpoint(dict(record))
            mark("loading", f"Loading {name}")
            _load_single_file(saved)
        note_loaded(int(record.get("versionId") or version))
        mark("ready", "Ready", done=1, total=1)

    retry_startup(_once)


def looks_v_prediction(record: dict[str, Any] | None, path: str = "") -> bool:
    """Illustrious is epsilon. NoobAI and some SDXL finetunes are v-prediction."""
    fields = " ".join(str((record or {}).get(key) or "") for key in ("filename", "name", "version", "predictionType", "baseModel"))
    if re.search(r"v[\s_-]?pred|v_prediction", fields, re.IGNORECASE):
        return True
    explicit = str((record or {}).get("predictionType") or "").lower()
    if explicit in {"v", "v_prediction", "vpred"}:
        return True
    if not path or not os.path.exists(path):
        return False
    try:
        with open(path, "rb") as handle:
            length = int.from_bytes(handle.read(8), "little")
            if length <= 0 or length > 5_000_000:
                return False
            header = json.loads(handle.read(length))
        meta = header.get("__metadata__") or {}
        pred = str(meta.get("modelspec.prediction_type") or meta.get("prediction_type") or "").lower()
        return pred in {"v", "v_prediction", "vpred"}
    except (OSError, json.JSONDecodeError, UnicodeError, ValueError):
        return False


def scheduler_updates(v_prediction: bool) -> dict[str, Any]:
    if not v_prediction:
        return {}
    return {"prediction_type": "v_prediction", "rescale_betas_zero_snr": True, "timestep_spacing": "trailing"}


def clip_skip_index(clip_skip: int) -> int:
    return -max(1, min(12, int(clip_skip or 2)))


_CHUNK = 75
_STYLE_BLOCKLIST = {
    "monochrome",
    "greyscale",
    "grayscale",
    "sketch",
    "lineart",
    "line art",
    "manga",
    "comic",
    "1koma",
    "4koma",
    "speech bubble",
    "partially colored",
    "spot color",
}


def _norm_tag(tag: str) -> str:
    return " ".join(tag.strip().casefold().split())


def split_prompt_tags(text: str) -> list[str]:
    """Split on commas, but leave <lora:...> and weighted (...) groups intact."""
    parts: list[str] = []
    buf: list[str] = []
    paren = 0
    angle = 0
    for char in text or "":
        if char == "(":
            paren += 1
        elif char == ")" and paren:
            paren -= 1
        elif char == "<":
            angle += 1
        elif char == ">" and angle:
            angle -= 1
        if char == "," and paren == 0 and angle == 0:
            piece = "".join(buf).strip()
            if piece:
                parts.append(piece)
            buf = []
            continue
        buf.append(char)
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def blocked_lora_tags(triggers: list[str]) -> set[str]:
    blocked: set[str] = set()
    for trigger in triggers:
        for part in split_prompt_tags(trigger):
            if _norm_tag(part) in _STYLE_BLOCKLIST:
                blocked.add(_norm_tag(part))
    return blocked


def tidy_prompt(text: str, lora_triggers: list[str] | None = None) -> str:
    """Trim, drop empties, and dedupe. Strip blocklisted style words that came from a LoRA trigger."""
    blocked = blocked_lora_tags(lora_triggers or [])
    seen: set[str] = set()
    kept: list[str] = []
    for part in split_prompt_tags(text):
        key = _norm_tag(part)
        if not key or key in seen:
            continue
        if key in blocked:
            continue
        seen.add(key)
        kept.append(part.strip())
    return ", ".join(kept)


def chunk_token_ids(token_ids: list[int], bos: int, eos: int, size: int = _CHUNK) -> list[list[int]]:
    """75 content tokens per CLIP chunk, with BOS and EOS, padded to 77."""
    body = [int(token) for token in token_ids]
    chunks: list[list[int]] = []
    start = 0
    while True:
        piece = body[start : start + size]
        if not piece and chunks:
            break
        if len(piece) < size:
            piece = piece + [eos] * (size - len(piece))
        chunks.append([bos, *piece, eos])
        start += size
        if start >= len(body):
            break
    if not chunks:
        chunks.append([bos, *([eos] * size), eos])
    return chunks


def align_chunk_lists(groups: list[list[Any]], empty: Any) -> list[list[Any]]:
    count = max((len(group) for group in groups), default=1)
    aligned: list[list[Any]] = []
    for group in groups:
        padded = list(group)
        while len(padded) < count:
            padded.append(empty)
        aligned.append(padded)
    return aligned


def _lora_trigger_texts(body: Any) -> list[str]:
    texts: list[str] = []
    for lora in getattr(body, "loras", None) or []:
        for trigger in getattr(lora, "triggers", None) or []:
            if str(trigger).strip():
                texts.append(str(trigger))
    return texts


def _prepare_prompt_text(body: Any) -> int:
    triggers = _lora_trigger_texts(body)
    body.prompt = tidy_prompt(getattr(body, "prompt", "") or "", triggers)
    body.negative_prompt = tidy_prompt(getattr(body, "negative_prompt", "") or "")
    return len(split_prompt_tags(body.prompt))


def _log_generate(body: Any, token_count: int) -> None:
    checkpoint = find_checkpoint((getattr(body, "model", None) or "").strip())
    checkpoint_base = str((checkpoint or {}).get("baseModel") or "")
    parts = []
    for lora in getattr(body, "loras", None) or []:
        path = resolve_lora_path(lora) or str(getattr(lora, "name", "") or "")
        parts.append(
            f"file={path} weight={getattr(lora, 'weight', '')} lora_base={getattr(lora, 'baseModel', '') or ''}"
        )
    _LOG.info(
        "generate %s checkpoint_base=%s tokens=%s",
        " ".join(parts) if parts else "lora=none",
        checkpoint_base,
        token_count,
    )


def _apply_scheduler(pipe: Any, name: str, v_prediction: bool = False) -> None:
    from diffusers import (
        DDIMScheduler,
        DPMSolverMultistepScheduler,
        EulerAncestralDiscreteScheduler,
        EulerDiscreteScheduler,
        LCMScheduler,
    )

    config = dict(pipe.scheduler.config)
    config.update(scheduler_updates(v_prediction or bool(getattr(pipe, "_yume_vpred", False))))
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


class _ClipSkipEncoder:
    """SDXL reads hidden_states[-2]. Put the requested clip-skip layer there."""

    def __init__(self, inner: Any, skip: int) -> None:
        self._inner = inner
        self._skip = skip

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        kwargs["output_hidden_states"] = True
        output = self._inner(*args, **kwargs)
        states = getattr(output, "hidden_states", None)
        if not states:
            return output
        rewritten = list(states)
        if len(rewritten) >= 2:
            rewritten[-2] = states[clip_skip_index(self._skip)]
            try:
                output.hidden_states = tuple(rewritten)
            except Exception:
                return output
        return output


def unwrap_clip_skip(pipe: Any) -> None:
    """Put the real CLIP modules back so LoRA load and unload can see their attention blocks."""
    for attr in ("text_encoder", "text_encoder_2"):
        encoder = getattr(pipe, attr, None)
        if isinstance(encoder, _ClipSkipEncoder):
            setattr(pipe, attr, encoder._inner)


def _wrap_clip_skip(pipe: Any, clip_skip: int) -> None:
    skip = max(1, min(4, int(clip_skip or 2)))
    # SDXL already reads hidden_states[-2], which is clip skip 2. Leave the modules alone.
    if skip == 2:
        unwrap_clip_skip(pipe)
        return
    for attr in ("text_encoder", "text_encoder_2"):
        encoder = getattr(pipe, attr, None)
        if isinstance(encoder, _ClipSkipEncoder):
            encoder._skip = skip
            continue
        if encoder is None:
            continue
        setattr(pipe, attr, _ClipSkipEncoder(encoder, skip))


class _clip_skip_applied:
    """Wrap only while drawing. Load and unload run outside this, on the real encoders."""

    def __init__(self, pipe: Any, clip_skip: int) -> None:
        self.pipe = pipe
        self.clip_skip = clip_skip

    def __enter__(self) -> Any:
        unwrap_clip_skip(self.pipe)
        _wrap_clip_skip(self.pipe, self.clip_skip)
        return self.pipe

    def __exit__(self, *exc: object) -> None:
        unwrap_clip_skip(self.pipe)


class LoraInstalling(RuntimeError):
    """The LoRA download has started and /generate should be retried."""


def lora_stem(name: str) -> str:
    base = os.path.basename(str(name or "")).strip().lower()
    for ext in (".safetensors", ".pt", ".ckpt", ".bin"):
        if base.endswith(ext):
            return base[: -len(ext)]
    return base


def friendly_lora_error(message: str) -> str:
    if "lora not found" in message.lower():
        return "That LoRA is not on the cloud yet. Install it from Civitai, then try again."
    return message


def _is_lora_record(item: dict[str, Any]) -> bool:
    kind = str(item.get("type") or "").lower().replace(" ", "").replace("_", "")
    return kind in {"lora", "locon", "dora", "lycoris"}


def resolve_lora_path(lora: Any) -> str | None:
    from yume_server.catalog import list_models

    models = list_models()
    version = getattr(lora, "versionId", None)
    if version:
        match = next((item for item in models if int(item.get("versionId") or 0) == int(version)), None)
        path = str((match or {}).get("path") or "")
        if path and os.path.exists(path):
            return path
    stem = lora_stem(getattr(lora, "name", "") or "")
    if not stem:
        return None
    for item in models:
        if not _is_lora_record(item):
            continue
        if stem in {lora_stem(item.get("filename") or ""), lora_stem(item.get("name") or "")}:
            path = str(item.get("path") or "")
            if path and os.path.exists(path):
                return path
    for root in lora_directories():
        if not os.path.isdir(root):
            continue
        for entry in os.listdir(root):
            if lora_stem(entry) == stem:
                return os.path.join(root, entry)
    return None


def prepare_loras(body: Any, token: str | None) -> None:
    """Install a missing LoRA by version id, or say it is still installing."""
    from yume_server.catalog import install_progress, start_install

    for lora in getattr(body, "loras", None) or []:
        if resolve_lora_path(lora):
            continue
        version = getattr(lora, "versionId", None)
        label = str(getattr(lora, "name", "") or "").strip() or (f"version {version}" if version else "LoRA")
        if not version:
            if mock_mode():
                continue
            raise FileNotFoundError(f"LoRA not found on the server: {label}.")
        filename = label if "." in os.path.basename(label) else f"{label}.safetensors"
        hint = {
            "type": "LORA",
            "name": label,
            "filename": filename,
            "baseModel": getattr(lora, "baseModel", None) or "",
            "triggers": list(getattr(lora, "triggers", None) or []),
        }
        job = start_install(int(version), token, {key: value for key, value in hint.items() if value})
        if job.get("state") != "done":
            try:
                job = install_progress(job["id"])
            except KeyError:
                pass
        if job.get("state") != "done":
            raise LoraInstalling(f"installing {label}")


def _apply_loras(pipe: Any, loras: list[Any]) -> list[str]:
    if not loras:
        return []
    from yume_server.peft_setup import MISSING, ensure_peft

    if not ensure_peft():
        raise RuntimeError(MISSING)
    names: list[str] = []
    weights: list[float] = []
    for index, lora in enumerate(loras):
        filename = str(getattr(lora, "name", "") or "").strip() or str(getattr(lora, "versionId", "") or "")
        if not filename:
            continue
        path = resolve_lora_path(lora)
        if path is None:
            raise FileNotFoundError(f"LoRA not found on the server: {filename}.")
        adapter = f"lora_{index}"
        pipe.load_lora_weights(path, adapter_name=adapter)
        names.append(adapter)
        weights.append(float(lora.weight))
    if names:
        pipe.set_adapters(names, weights)
    return names


def _clear_loras(pipe: Any, adapters: list[str]) -> None:
    if not adapters:
        return
    try:
        pipe.unload_lora_weights()
    except Exception:
        try:
            pipe.delete_adapters(adapters)
        except Exception:
            _LOG.warning("could not unload LoRA adapters %s", adapters)


def _reference_flags(body: Any) -> tuple[bool, bool, bool]:
    has_image = bool(getattr(body, "reference_image", None))
    pose = bool(getattr(body, "pose", False)) and has_image
    copy = bool(getattr(body, "copy_picture", False)) and has_image
    style = bool(getattr(body, "style", False)) and has_image
    if has_image and not (pose or copy or style):
        flag = os.environ.get("YUME_IP_ADAPTER", "").strip().lower()
        if flag in {"1", "true", "yes"}:
            style = True
        elif str(getattr(body, "mode", "") or "") == "img2img":
            copy = True
    return pose, copy, style


def _consistency(body: Any) -> str:
    pose, copy, style = _reference_flags(body)
    parts = []
    if pose:
        parts.append("pose")
    if copy:
        parts.append("img2img")
    if style:
        parts.append("style")
    return "+".join(parts) or "txt2img"


def _seed_list(body: Any) -> list[int]:
    count = max(1, int(getattr(body, "count", 1) or 1))
    raw = getattr(body, "seed", None)
    if raw is None or int(raw) < 0:
        import random

        base = random.randrange(0, 2_147_483_647)
    else:
        base = int(raw) % 2_147_483_647
    return [(base + index) % 2_147_483_647 for index in range(count)]


def ensure_requested_loaded(body: Any, on_progress: Any = None) -> tuple[str, bool]:
    """Load an installed checkpoint that /generate asked for instead of returning 503."""
    requested = (getattr(body, "model", None) or "").strip()
    match = find_checkpoint(requested)
    if requested and match is None:
        raise ValueError("That checkpoint is not installed. Install it from Civitai first.")
    if match is None:
        if loaded_version() is None and not mock_mode():
            raise RuntimeError("Model is not loaded.")
        return loaded_model_name(), False
    version = int(match.get("versionId") or 0)
    loaded = loaded_version()
    switched = loaded != version
    if switched:
        name = str(match.get("name") or requested or "checkpoint")
        if on_progress:
            on_progress(f"Switching to {name}")
        _load_record(match)
    elif loaded is None and not mock_mode():
        raise RuntimeError("Model is not loaded.")
    return str(match.get("name") or requested or loaded_model_name()), switched


def _tokenizer_ids(tokenizer: Any, text: str) -> tuple[list[int], int, int]:
    encoded = tokenizer(
        text or "",
        truncation=False,
        padding=False,
        add_special_tokens=False,
        return_attention_mask=False,
    )
    ids = encoded["input_ids"]
    if ids and isinstance(ids[0], (list, tuple)):
        ids = ids[0]
    bos = int(tokenizer.bos_token_id)
    eos = int(tokenizer.eos_token_id if tokenizer.eos_token_id is not None else bos)
    return [int(token) for token in ids], bos, eos


def _encode_chunks(encoder: Any, tokenizer: Any, text: str, clip_skip: int, device: Any) -> tuple[Any, Any, int]:
    import torch

    ids, bos, eos = _tokenizer_ids(tokenizer, text)
    sequences = []
    pooled = None
    for index, chunk in enumerate(chunk_token_ids(ids, bos, eos)):
        output = encoder(torch.tensor([chunk], device=device), output_hidden_states=True)
        states = output.hidden_states
        sequences.append(states[clip_skip_index(clip_skip)])
        if index == 0:
            pooled = getattr(output, "text_embeds", None)
            if pooled is None and getattr(output[0], "ndim", 1) == 2:
                pooled = output[0]
            if pooled is None:
                pooled = getattr(output, "pooler_output", None)
    return torch.cat(sequences, dim=1), pooled, len(ids)


def _pad_sequence(sequence: Any, empty: Any, width: int) -> Any:
    import torch

    while sequence.shape[1] < width:
        sequence = torch.cat([sequence, empty], dim=1)
    return sequence


def sdxl_conditioning(pipe: Any, prompt: str, negative: str, clip_skip: int) -> tuple[dict[str, Any], int]:
    """Encode past 77 tokens in 75-token CLIP chunks. Pooled values come from the first chunk."""
    device = getattr(pipe, "device", None)
    if device is None:
        device = next(pipe.unet.parameters()).device
    skip = max(1, min(4, int(clip_skip or 2)))
    pos_1, _, count_1 = _encode_chunks(pipe.text_encoder, pipe.tokenizer, prompt, skip, device)
    pos_2, pooled, count_2 = _encode_chunks(pipe.text_encoder_2, pipe.tokenizer_2, prompt, skip, device)
    neg_1, _, _ = _encode_chunks(pipe.text_encoder, pipe.tokenizer, negative or "", skip, device)
    neg_2, negative_pooled, _ = _encode_chunks(pipe.text_encoder_2, pipe.tokenizer_2, negative or "", skip, device)
    empty_1, _, _ = _encode_chunks(pipe.text_encoder, pipe.tokenizer, "", skip, device)
    empty_2, _, _ = _encode_chunks(pipe.text_encoder_2, pipe.tokenizer_2, "", skip, device)
    width = max(pos_1.shape[1], pos_2.shape[1], neg_1.shape[1], neg_2.shape[1])
    pos_1 = _pad_sequence(pos_1, empty_1, width)
    pos_2 = _pad_sequence(pos_2, empty_2, width)
    neg_1 = _pad_sequence(neg_1, empty_1, width)
    neg_2 = _pad_sequence(neg_2, empty_2, width)
    import torch

    return {
        "prompt_embeds": torch.cat([pos_1, pos_2], dim=-1),
        "negative_prompt_embeds": torch.cat([neg_1, neg_2], dim=-1),
        "pooled_prompt_embeds": pooled,
        "negative_pooled_prompt_embeds": negative_pooled,
    }, max(count_1, count_2)


def generate_images(body: Any, on_progress: Any = None) -> tuple[list[str], list[int], str, str, bool]:
    chosen, switched = ensure_requested_loaded(body, on_progress)
    _prepare_prompt_text(body)
    seeds = _seed_list(body)
    consistency = _consistency(body)
    if mock_mode():
        _log_generate(body, len(split_prompt_tags(body.prompt)))
        from yume_server.metadata import embed_parameters, parameters_text

        bump = len(getattr(body, "reference_image", None) or "") % 97
        note = parameters_text(body, seeds[0] if seeds else 1)
        images = []
        for seed in seeds:
            raw = base64.b64decode(_png(body.width, body.height, seed + bump))
            images.append(base64.b64encode(embed_parameters(raw, note)).decode("ascii"))
        return images, seeds, chosen, consistency, switched

    if _PIPE is None:
        raise RuntimeError("Model is not loaded.")
    requested_prediction = str(getattr(body, "prediction_type", "") or "").lower()
    v_prediction = requested_prediction == "v_prediction" or (
        requested_prediction not in {"epsilon", "eps"} and bool(getattr(_PIPE, "_yume_vpred", False))
    )
    _apply_scheduler(_PIPE, A1111_SAMPLERS.get(body.scheduler, body.scheduler), v_prediction)
    # LoRA must see the real CLIP modules. Clip skip is applied only for the draw.
    unwrap_clip_skip(_PIPE)
    adapters = _apply_loras(_PIPE, body.loras)
    strength = float(getattr(body, "strength", 0.45) or 0.45)
    conditioning: dict[str, Any] | None = None
    token_count = len(split_prompt_tags(body.prompt))
    try:
        conditioning, token_count = sdxl_conditioning(
            _PIPE,
            body.prompt,
            body.negative_prompt or "",
            int(getattr(body, "clip_skip", 2) or 2),
        )
    except Exception:
        _LOG.exception("long prompt encode failed; sending the text instead")
        conditioning = None
    _log_generate(body, token_count)
    try:
        images = _draw_seeds(_PIPE, body, seeds, consistency, strength, conditioning)
    finally:
        unwrap_clip_skip(_PIPE)
        _clear_loras(_PIPE, adapters)
    return images, seeds, chosen, consistency, switched


def _draw_seeds(
    pipe: Any,
    body: Any,
    seeds: list[int],
    consistency: str,
    strength: float,
    conditioning: dict[str, Any] | None = None,
) -> list[str]:
    import torch
    from io import BytesIO

    images: list[str] = []
    for seed in seeds:
        generator = torch.Generator(device="cuda").manual_seed(seed)
        common: dict[str, Any] = {
            "num_inference_steps": body.steps,
            "guidance_scale": body.cfg,
            "generator": generator,
        }
        if conditioning:
            common.update(conditioning)
            common["prompt"] = None
            common["negative_prompt"] = None
        else:
            common["prompt"] = body.prompt
            common["negative_prompt"] = body.negative_prompt or None
        pose_on, copy_on, style_on = _reference_flags(body)
        if pose_on or copy_on or style_on:
            result = _draw_reference(pipe, body, common, strength, pose_on, copy_on, style_on)
        else:
            result = _draw_with_hires(pipe, common, body)
        buffer = BytesIO()
        result.images[0].save(buffer, format="PNG")
        images.append(base64.b64encode(buffer.getvalue()).decode("ascii"))
    return images


def _pose_image(body: Any) -> Any:
    from io import BytesIO

    from PIL import Image

    from yume_server.reference import pose_preview

    preview = pose_preview(
        base64.b64decode(body.reference_image),
        fit=bool(getattr(body, "pose_fit", True)),
        size=str(getattr(body, "pose_body", "average") or "average"),
        width=int(body.width),
        height=int(body.height),
        height_cm=getattr(body, "pose_height_cm", None),
        bust_cm=getattr(body, "pose_bust_cm", None),
        hip_cm=getattr(body, "pose_hip_cm", None),
    )
    return Image.open(BytesIO(base64.b64decode(preview["skeleton"]))).convert("RGB")


def _attach_style(pipe: Any, body: Any) -> None:
    from yume_server.reference import IP_REPO, IP_SUBFOLDER, IP_WEIGHT, ensure_reference_weights, style_scale

    ensure_reference_weights()
    if not getattr(pipe, "_yume_style", False):
        pipe.load_ip_adapter(IP_REPO, subfolder=IP_SUBFOLDER, weight_name=IP_WEIGHT)
        pipe._yume_style = True
    strength = float(getattr(body, "style_strength", 0.55) or 0.55)
    try:
        pipe.set_ip_adapter_scale(style_scale(strength))
    except Exception:
        pipe.set_ip_adapter_scale(max(0.0, min(1.0, strength)) * 0.7)


def _draw_reference(pipe: Any, body: Any, common: dict[str, Any], strength: float, pose_on: bool, copy_on: bool, style_on: bool) -> Any:
    from yume_server.reference import CONTROLNET_REPO, ensure_reference_weights

    image = _open_reference(body)
    denoise = max(0.05, min(0.95, float(getattr(body, "strength", strength) or strength)))
    pose_scale = max(0.0, min(1.5, float(getattr(body, "pose_strength", 0.85) or 0.85)))
    control = _pose_image(body) if pose_on else None
    if pose_on:
        ensure_reference_weights()
        from diffusers import ControlNetModel, StableDiffusionXLControlNetImg2ImgPipeline, StableDiffusionXLControlNetPipeline

        controlnet = ControlNetModel.from_pretrained(CONTROLNET_REPO, torch_dtype=pipe.unet.dtype)
        if copy_on:
            runner = StableDiffusionXLControlNetImg2ImgPipeline(**pipe.components, controlnet=controlnet)
            if style_on:
                _attach_style(runner, body)
            result = runner(
                **common,
                image=image,
                control_image=control,
                controlnet_conditioning_scale=pose_scale,
                strength=denoise,
                **({"ip_adapter_image": image} if style_on else {}),
            )
        else:
            runner = StableDiffusionXLControlNetPipeline(**pipe.components, controlnet=controlnet)
            if style_on:
                _attach_style(runner, body)
            result = runner(
                **common,
                image=control,
                controlnet_conditioning_scale=pose_scale,
                width=body.width,
                height=body.height,
                **({"ip_adapter_image": image} if style_on else {}),
            )
        return result
    if copy_on:
        from diffusers import StableDiffusionXLImg2ImgPipeline

        runner = StableDiffusionXLImg2ImgPipeline(**pipe.components)
        if style_on:
            _attach_style(runner, body)
        return runner(**common, image=image, strength=denoise, **({"ip_adapter_image": image} if style_on else {}))
    if style_on:
        _attach_style(pipe, body)
        return pipe(**common, width=body.width, height=body.height, ip_adapter_image=image)
    return pipe(**common, width=body.width, height=body.height)


def _draw_with_hires(pipe: Any, common: dict[str, Any], body: Any) -> Any:
    plan = hires_plan(body)
    width = body.width
    height = body.height
    if plan:
        width = max(512, int(body.width / plan["scale"]) // 8 * 8)
        height = max(512, int(body.height / plan["scale"]) // 8 * 8)
    result = pipe(**common, width=width, height=height)
    if not plan:
        return result
    from diffusers import StableDiffusionXLImg2ImgPipeline

    upscaled = _upscale_image(result.images[0], body.width, body.height, plan["upscaler"])
    img2img = StableDiffusionXLImg2ImgPipeline(**pipe.components)
    second = dict(common)
    second["num_inference_steps"] = plan["steps"]
    return img2img(**second, image=upscaled, strength=plan["denoise"])


def _upscale_image(image: Any, width: int, height: int, upscaler: str) -> Any:
    if upscaler_kind(upscaler) == "esrgan":
        restored = _esrgan_upscale(image, width, height)
        if restored is not None:
            return restored
    from PIL import Image as PILImage

    return image.resize((width, height), PILImage.Resampling.LANCZOS)


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


def _snapshot_animagine() -> str:
    from huggingface_hub import snapshot_download
    from tqdm.auto import tqdm

    from yume_server.startup import note_download

    class _DownloadBar(tqdm):
        def update(self, n=1):
            shown = super().update(n)
            note_download(int(self.n or 0), int(self.total or 0), name=model_id())
            return shown

    try:
        return snapshot_download(
            repo_id=model_id(),
            cache_dir=cache_dir(),
            ignore_patterns=list(DIFFUSERS_IGNORE),
            local_files_only=True,
        )
    except Exception:
        return snapshot_download(
            repo_id=model_id(),
            cache_dir=cache_dir(),
            ignore_patterns=list(DIFFUSERS_IGNORE),
            tqdm_class=_DownloadBar,
        )


def _load_default_diffusers() -> None:
    global _PIPE
    import torch
    from diffusers import StableDiffusionXLPipeline

    local = _snapshot_animagine()
    pipe = StableDiffusionXLPipeline.from_pretrained(
        local,
        torch_dtype=torch.float16,
        use_safetensors=True,
        local_files_only=True,
    )
    pipe.to("cuda")
    pipe.enable_vae_slicing()
    _PIPE = pipe


def _fixed_vae(dtype: Any) -> Any:
    local = ensure_fixed_vae()
    if not local:
        return None
    from diffusers import AutoencoderKL

    return AutoencoderKL.from_pretrained(local, torch_dtype=dtype)


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

        vae = _fixed_vae(dtype) if needs_fixed_vae(base, os.path.basename(path)) else None
        kwargs: dict[str, Any] = {"torch_dtype": dtype}
        if vae is not None:
            kwargs["vae"] = vae
        pipe = StableDiffusionXLPipeline.from_single_file(path, **kwargs)
    pipe.to("cuda")
    pipe.enable_vae_slicing()
    pipe._yume_vpred = looks_v_prediction(record, path)
    _PIPE = pipe


def _esrgan_upscale(image: Any, width: int, height: int) -> Any:
    weight = anime_upscaler_path()
    if not os.path.exists(weight):
        return None
    try:
        import torch
        from spandrel import ImageModelDescriptor, ModelLoader

        model = ModelLoader().load_from_file(weight)
        if not isinstance(model, ImageModelDescriptor):
            return None
        model.to("cuda" if torch.cuda.is_available() else "cpu").eval()
        array = __import__("numpy").asarray(image)
        tensor = torch.from_numpy(array).permute(2, 0, 1).unsqueeze(0).float().div(255.0)
        tensor = tensor.to(next(model.model.parameters()).device)
        with torch.no_grad():
            out = model(tensor).clamp(0, 1)
        restored = (out[0].permute(1, 2, 0).cpu().numpy() * 255).astype("uint8")
        from PIL import Image as PILImage

        return PILImage.fromarray(restored).resize((width, height), PILImage.Resampling.LANCZOS)
    except Exception as exc:
        _LOG.warning("anime ESRGAN upscale failed: %s", exc)
        return None


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
