"""A1111 parameters text, stored in a PNG tEXt chunk named parameters."""

from __future__ import annotations

import struct
import zlib
from typing import Any


def parameters_text(body: Any, seed: int) -> str:
    loras = getattr(body, "loras", None) or []
    parts = [
        f"Steps: {body.steps}",
        f"Sampler: {body.scheduler}",
        f"CFG scale: {body.cfg}",
        f"Seed: {seed}",
        f"Size: {body.width}x{body.height}",
        f"Model: {getattr(body, 'model_name', None) or body.model or 'Animagine XL 4.0'}",
        f"Model hash: {getattr(body, 'model_hash', None) or '1d5b43ff75'}",
        f"Clip skip: {getattr(body, 'clip_skip', None) or 2}",
    ]
    if loras:
        rendered = ", ".join(f"{item.name}: {item.weight}" for item in loras)
        parts.append(f'Lora hashes: "{rendered}"')
    hires = getattr(body, "hires", None)
    if hires is not None:
        parts.append(f"Hires upscale: {hires.scale}")
        parts.append(f"Hires upscaler: {hires.upscaler}")
        parts.append(f"Hires steps: {hires.steps}")
        parts.append(f"Denoising strength: {hires.denoise}")
    negative = getattr(body, "negative_prompt", "") or ""
    return f"{body.prompt}\nNegative prompt: {negative}\n{', '.join(parts)}"


def embed_parameters(png: bytes, text: str) -> bytes:
    data = b"parameters\x00" + text.encode("latin-1", "replace")
    chunk = struct.pack(">I", len(data)) + b"tEXt" + data + struct.pack(">I", zlib.crc32(b"tEXt" + data) & 0xFFFFFFFF)
    marker = png.rfind(b"IEND")
    if marker < 4:
        return png
    start = marker - 4
    return png[:start] + chunk + png[start:]
