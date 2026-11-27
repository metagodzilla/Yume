"""One-pass regional prompting for two or more characters.

The shared prompt covers the whole picture. Each character prompt is mixed in
through a soft mask. Neighboring masks overlap and fade, so the characters can
touch. One character, or none, stays on the normal single prompt.

Rectangle inpaint is not used. A request that still sends hard boxes is drawn
with these soft masks instead.
"""

from __future__ import annotations

import math
import re
from typing import Any

OVERLAP = 0.36


def detect_kind(type_name: str = "", tags: list[str] | None = None, name: str = "", explicit: str = "") -> str:
    if explicit in {"character", "style"}:
        return explicit
    blob = " ".join([type_name or "", " ".join(tags or []), name or ""]).lower()
    return "character" if re.search(r"\bcharacter\b", blob) else "style"


def active_regions(body: Any) -> list[Any]:
    regions = list(getattr(body, "regions", None) or [])
    return [region for region in regions if str(getattr(region, "prompt", "") or "").strip() or str(getattr(region, "lora_name", "") or "").strip()]


def skips_regional(body: Any) -> bool:
    """A reference picture stays on the normal draw. Soft masks need one txt2img pass."""
    if not getattr(body, "reference_image", None):
        return False
    if getattr(body, "pose", False) or getattr(body, "copy_picture", False) or getattr(body, "style", False):
        return True
    return str(getattr(body, "mode", "") or "") == "img2img"


def drawing_mode(body: Any) -> str:
    """Together is the only regional mode. Hard boxes never select a second pass."""
    if len(active_regions(body)) < 2:
        return "plain"
    if skips_regional(body):
        return "reference"
    return "together"


def fold_interaction(prompt: str, interaction: str, regional: bool) -> str:
    if not regional:
        return prompt
    extra = (interaction or "").strip()
    if not extra or extra.lower() in (prompt or "").lower():
        return prompt
    return f"{prompt}, {extra}" if prompt else extra


def _smooth(t: float) -> float:
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    return t * t * (3 - 2 * t)


def _band_weight(pos: float, index: int, count: int, overlap: float = OVERLAP) -> float:
    start = index / count
    end = (index + 1) / count
    band = end - start
    feather = min(overlap * 0.5, band * 0.9)
    left = start - (feather if index > 0 else 0.0)
    right = end + (feather if index < count - 1 else 0.0)
    core_left = start + (feather if index > 0 else 0.0)
    core_right = end - (feather if index < count - 1 else 0.0)
    if pos <= left or pos >= right:
        return 0.0
    if core_left <= pos <= core_right:
        return 1.0
    if pos < core_left:
        span = core_left - left
        return 1.0 if span <= 1e-6 else _smooth((pos - left) / span)
    span = right - core_right
    return 1.0 if span <= 1e-6 else _smooth((right - pos) / span)


def feathered_masks(count: int, layout: str, width: int, height: int, overlap: float = OVERLAP) -> list[list[list[float]]]:
    """Soft masks in 0..1. Side by side fades across x. Top/bottom fades across y."""
    if count < 2 or width < 1 or height < 1:
        return []
    stacked = layout == "stack"
    masks: list[list[list[float]]] = []
    for index in range(count):
        rows: list[list[float]] = []
        for y in range(height):
            row: list[float] = []
            for x in range(width):
                pos = ((y + 0.5) / height) if stacked else ((x + 0.5) / width)
                row.append(_band_weight(pos, index, count, overlap))
            rows.append(row)
        masks.append(rows)
    return masks


def masks_overlap(masks: list[list[list[float]]], threshold: float = 0.2) -> bool:
    if len(masks) < 2:
        return False
    height = len(masks[0])
    width = len(masks[0][0]) if height else 0
    for y in range(height):
        for x in range(width):
            hot = sum(1 for mask in masks if mask[y][x] > threshold)
            if hot >= 2:
                return True
    return False


def attention_weights(region_masks: list[float]) -> list[float]:
    """Shared prompt stays on, then each character mask. Weights sum to 1."""
    raw = [1.0, *[max(0.0, float(value)) for value in region_masks]]
    total = sum(raw) or 1.0
    return [value / total for value in raw]


def spatial_hw(seq: int, width: int, height: int) -> tuple[int, int] | None:
    """Factor a token count into height, width at this picture's aspect.

    Text-token lengths such as 77 are not an image grid, so they stay unmasked.
    """
    if seq < 16 or width < 8 or height < 8:
        return None
    latent_w = max(1, width // 8)
    latent_h = max(1, height // 8)
    for div in (1, 2, 4, 8):
        grid_w = max(1, latent_w // div)
        grid_h = max(1, latent_h // div)
        if grid_w * grid_h == seq:
            return grid_h, grid_w
    aspect = width / height
    guess = max(1, int(round(math.sqrt(seq / aspect))))
    for height_try in range(max(1, guess - 4), guess + 5):
        if seq % height_try:
            continue
        width_try = seq // height_try
        if width_try < 8 or height_try < 8:
            continue
        if abs((width_try / height_try) - aspect) <= 0.05:
            return height_try, width_try
    return None


def resample(mask: list[list[float]], out_h: int, out_w: int) -> list[float]:
    """Bilinear sample, row-major, matching the UNet's flattened spatial order."""
    src_h = len(mask)
    src_w = len(mask[0]) if src_h else 0
    if src_h < 1 or src_w < 1 or out_h < 1 or out_w < 1:
        return []
    flat: list[float] = []
    for y in range(out_h):
        sy = (y + 0.5) * src_h / out_h - 0.5
        y0 = math.floor(sy)
        y1 = y0 + 1
        fy = sy - y0
        y0 = min(max(y0, 0), src_h - 1)
        y1 = min(max(y1, 0), src_h - 1)
        for x in range(out_w):
            sx = (x + 0.5) * src_w / out_w - 0.5
            x0 = math.floor(sx)
            x1 = x0 + 1
            fx = sx - x0
            x0 = min(max(x0, 0), src_w - 1)
            x1 = min(max(x1, 0), src_w - 1)
            flat.append(
                mask[y0][x0] * (1 - fx) * (1 - fy)
                + mask[y0][x1] * fx * (1 - fy)
                + mask[y1][x0] * (1 - fx) * fy
                + mask[y1][x1] * fx * fy
            )
    return flat
