"""Place two or more character LoRAs in separate rectangles.

One character, or none, stays on the normal single prompt. Style LoRAs stay global.
"""

from __future__ import annotations

import re
from typing import Any


def detect_kind(type_name: str = "", tags: list[str] | None = None, name: str = "", explicit: str = "") -> str:
    if explicit in {"character", "style"}:
        return explicit
    blob = " ".join([type_name or "", " ".join(tags or []), name or ""]).lower()
    return "character" if re.search(r"\bcharacter\b", blob) else "style"


def region_boxes(count: int, layout: str) -> list[dict[str, float]]:
    if count < 2:
        return []
    boxes = []
    span = 1 / count
    stacked = layout == "stack"
    for index in range(count):
        if stacked:
            boxes.append({"x": 0.0, "y": index * span, "w": 1.0, "h": span})
        else:
            boxes.append({"x": index * span, "y": 0.0, "w": span, "h": 1.0})
    return boxes


def plan_regions(loras: list[Any], layout: str = "side") -> list[dict[str, Any]] | None:
    characters = []
    for lora in loras:
        kind = str(getattr(lora, "kind", None) or (lora.get("kind") if isinstance(lora, dict) else "") or "style")
        enabled = True if isinstance(lora, dict) else getattr(lora, "enabled", True)
        if isinstance(lora, dict):
            enabled = lora.get("enabled", True)
        if kind != "character" or enabled is False:
            continue
        name = str(getattr(lora, "name", None) or (lora.get("name") if isinstance(lora, dict) else "") or "")
        weight = float(getattr(lora, "weight", None) or (lora.get("weight") if isinstance(lora, dict) else 0.8) or 0.8)
        prompt = str(getattr(lora, "prompt", None) or (lora.get("prompt") if isinstance(lora, dict) else "") or "")
        characters.append({"name": name, "weight": weight, "prompt": prompt.strip()})
    boxes = region_boxes(len(characters), "stack" if layout == "stack" else "side")
    if len(boxes) < 2:
        return None
    planned = []
    for index, (character, box) in enumerate(zip(characters, boxes)):
        planned.append({**box, "index": index, "prompt": character["prompt"], "lora_name": character["name"], "lora_weight": character["weight"]})
    return planned


def active_regions(body: Any) -> list[Any]:
    regions = list(getattr(body, "regions", None) or [])
    return [region for region in regions if str(getattr(region, "prompt", "") or "").strip() or str(getattr(region, "lora_name", "") or "").strip()]
