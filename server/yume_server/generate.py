"""Image generation. YUME_MOCK=1 draws a tiny PNG and never imports torch."""

from __future__ import annotations

import base64
import os
import struct
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

_PIPE: Any = None


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


def start_model() -> None:
    global _PIPE
    if mock_mode():
        return
    import torch
    from diffusers import StableDiffusionXLPipeline

    _PIPE = StableDiffusionXLPipeline.from_pretrained(
        model_id(),
        torch_dtype=torch.float16,
        use_safetensors=True,
    )
    _PIPE.to("cuda")
    _PIPE.enable_vae_slicing()


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


def generate_images(body: Any) -> tuple[list[str], list[int], str, str]:
    base = body.seed if body.seed is not None else 1
    seeds = [(int(base) + index) % 2_147_483_647 for index in range(body.count)]
    consistency = _consistency(body)
    if mock_mode():
        from yume_server.metadata import embed_parameters, parameters_text

        bump = len(getattr(body, "reference_image", None) or "") % 97
        note = parameters_text(body, seeds[0] if seeds else 1)
        images = []
        for seed in seeds:
            raw = base64.b64decode(_png(body.width, body.height, seed + bump))
            images.append(base64.b64encode(embed_parameters(raw, note)).decode("ascii"))
        chosen = (getattr(body, "model", None) or "").strip() or "Animagine XL 4.0"
        return images, seeds, chosen, consistency

    chosen = _activate_catalog(body)
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


def _activate_catalog(body: Any) -> str:
    """Load a Civitai file from the cache. SD1.5, SDXL-family, and Flux each use their pipeline."""
    global _PIPE
    from yume_server.catalog import list_models

    requested = (getattr(body, "model", None) or "").strip()
    if requested in {"", model_id()}:
        if _PIPE is None:
            raise RuntimeError("Model is not loaded.")
        return model_id()
    match = next(
        (
            item
            for item in list_models()
            if requested in {item.get("filename"), item.get("name"), str(item.get("versionId"))}
        ),
        None,
    )
    if match is None:
        raise ValueError("That checkpoint is not installed. Install it from Civitai first.")
    path = match.get("path") or ""
    if not os.path.exists(path) or os.path.getsize(path) < 1_000_000:
        raise RuntimeError("The weight file is not on disk yet. The first download of a checkpoint is several gigabytes.")
    import torch

    dtype = torch.float16
    base = match.get("baseModel") or ""
    if str(base).startswith("Flux"):
        from diffusers import FluxPipeline

        pipe = FluxPipeline.from_single_file(path, torch_dtype=dtype)
    elif base == "SD 1.5":
        from diffusers import StableDiffusionPipeline

        pipe = StableDiffusionPipeline.from_single_file(path, torch_dtype=dtype)
    else:
        from diffusers import StableDiffusionXLPipeline

        pipe = StableDiffusionXLPipeline.from_single_file(path, torch_dtype=dtype)
    pipe.to("cuda")
    _PIPE = pipe
    return match.get("name") or requested


def _open_reference(body: Any):
    import io

    from PIL import Image

    raw = base64.b64decode(body.reference_image)
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    return image.resize((body.width, body.height))
