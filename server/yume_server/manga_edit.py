"""Swap one person on a manga page for a Cast character.

The person is chosen by a tap, with brush strokes to fix the mask. The pose is
retargeted onto the character's body, the mask grows or shrinks with that body,
and the uncovered background is filled back in. Speech bubbles stay untouched.
"""

from __future__ import annotations

import base64
from typing import Any

from yume_server.pose import point_box, retarget_anchored, synthetic_reference
from yume_server.tagger import load_rgb
from yume_server.upscale import compose_prompt, find_bubbles, find_panels, plan_target, redraw_denoise, scale_rects


def page_is_color(pixels: list[tuple[int, int, int]]) -> bool:
    if not pixels:
        return False
    step = max(1, len(pixels) // 400)
    colorful = 0
    seen = 0
    for index in range(0, len(pixels), step):
        red, green, blue = pixels[index]
        seen += 1
        if max(red, green, blue) - min(red, green, blue) > 28:
            colorful += 1
    return seen > 0 and colorful / seen > 0.08


def _panel_for(panels: list[tuple[int, int, int, int]], x: int, y: int) -> tuple[int, int, int, int]:
    for left, top, width, height in panels:
        if left <= x < left + width and top <= y < top + height:
            return left, top, width, height
    return panels[0] if panels else (0, 0, 1, 1)


def segment_person(pixels: list[tuple[int, int, int]], width: int, height: int, x: float, y: float, strokes: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Ink silhouette around the tap, limited to that panel. Brush strokes add or erase."""
    px = min(width - 1, max(0, int(float(x) * (width if x <= 1 else 1))))
    py = min(height - 1, max(0, int(float(y) * (height if y <= 1 else 1))))
    if x > 1:
        px = min(width - 1, max(0, int(x)))
    if y > 1:
        py = min(height - 1, max(0, int(y)))
    panels = find_panels(pixels, width, height)
    panel = _panel_for(panels, px, py)
    left, top, pw, ph = panel
    ink = [False] * (width * height)
    for yy in range(top, min(height, top + ph)):
        row = yy * width
        for xx in range(left, min(width, left + pw)):
            red, green, blue = pixels[row + xx]
            if (red + green + blue) / 3 < 90:
                ink[row + xx] = True
    seen = [False] * (width * height)
    chosen: list[int] = []
    best_distance = 10**12
    for index, mark in enumerate(ink):
        if not mark or seen[index]:
            continue
        stack = [index]
        seen[index] = True
        component = [index]
        while stack:
            current = stack.pop()
            cx, cy = current % width, current // width
            for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                if left <= nx < left + pw and top <= ny < top + ph:
                    nxt = ny * width + nx
                    if ink[nxt] and not seen[nxt]:
                        seen[nxt] = True
                        stack.append(nxt)
                        component.append(nxt)
        distance = min((abs(item % width - px) + abs(item // width - py) for item in component), default=10**12)
        contains = any(abs(item % width - px) <= 2 and abs(item // width - py) <= 2 for item in component)
        if contains:
            distance = 0
        if distance < best_distance:
            best_distance = distance
            chosen = component
    mask = [False] * (width * height)
    if chosen:
        rows: dict[int, list[int]] = {}
        for index in chosen:
            rows.setdefault(index // width, []).append(index % width)
        for yy, xs in rows.items():
            start, end = min(xs), max(xs)
            for xx in range(max(left, start - 2), min(left + pw, end + 3)):
                mask[yy * width + xx] = True
    else:
        bw, bh = max(8, pw // 3), max(8, ph // 2)
        bx, by = min(left + pw - bw, max(left, px - bw // 2)), min(top + ph - bh, max(top, py - bh // 3))
        for yy in range(by, by + bh):
            row = yy * width
            for xx in range(bx, bx + bw):
                mask[row + xx] = True
    for stroke in strokes or []:
        erase = bool(stroke.get("erase"))
        sx = float(stroke.get("x") or 0)
        sy = float(stroke.get("y") or 0)
        radius = float(stroke.get("r") or 0.04)
        cx = int(sx * width) if sx <= 1 else int(sx)
        cy = int(sy * height) if sy <= 1 else int(sy)
        rad = max(2, int(radius * max(width, height)))
        for yy in range(max(0, cy - rad), min(height, cy + rad + 1)):
            for xx in range(max(0, cx - rad), min(width, cx + rad + 1)):
                if (xx - cx) ** 2 + (yy - cy) ** 2 <= rad * rad:
                    mask[yy * width + xx] = not erase
    xs = [index % width for index, on in enumerate(mask) if on]
    ys = [index // width for index, on in enumerate(mask) if on]
    if not xs:
        box = (px, py, 8, 8)
    else:
        box = (min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1)
    return {"mask": mask, "box": box, "panel": panel}


def subtract_box(old: tuple[int, int, int, int], new: tuple[int, int, int, int]) -> list[tuple[int, int, int, int]]:
    ox, oy, ow, oh = old
    nx, ny, nw, nh = new
    holes: list[tuple[int, int, int, int]] = []
    if oy < ny:
        holes.append((ox, oy, ow, min(oh, ny - oy)))
    bottom = ny + nh
    if oy + oh > bottom:
        holes.append((ox, max(oy, bottom), ow, oy + oh - max(oy, bottom)))
    left = max(oy, ny)
    right_h = min(oy + oh, ny + nh) - left
    if right_h > 0 and ox < nx:
        holes.append((ox, left, min(ow, nx - ox), right_h))
    if right_h > 0 and ox + ow > nx + nw:
        holes.append((max(ox, nx + nw), left, ox + ow - max(ox, nx + nw), right_h))
    return [hole for hole in holes if hole[2] > 1 and hole[3] > 1]


def expand_for_body(box: tuple[int, int, int, int], source: Any, placed: Any) -> dict[str, Any]:
    src = point_box(source)
    dst = point_box(placed)
    if src is None or dst is None:
        return {"box": box, "holes": []}
    grown = (int(dst[0]), int(dst[1]), max(8, int(dst[2])), max(8, int(dst[3])))
    pad = int(max(grown[2], grown[3]) * 0.08)
    grown = (grown[0] - pad, grown[1] - pad, grown[2] + pad * 2, grown[3] + pad * 2)
    return {"box": grown, "holes": subtract_box(box, grown)}


def edit_prompt(*, color: bool, colorize: bool, tags: str, clothes: str, outfit: str, prompt: str) -> str:
    use_color = colorize or color
    outfit_text = clothes if outfit != "original" else "same outfit, original clothes"
    return compose_prompt(kind="manga", prompt=prompt, hints=outfit_text, tags=tags, colorize=use_color)


def run_segment(body: Any) -> dict[str, Any]:
    raw = base64.b64decode(body.image, validate=False)
    width, height, pixels = load_rgb(raw)
    found = segment_person(pixels, width, height, float(getattr(body, "x", 0.5) or 0.5), float(getattr(body, "y", 0.5) or 0.5), list(getattr(body, "strokes", None) or []))
    left, top, box_w, box_h = found["box"]
    return {"box": [left, top, box_w, box_h], "panel": list(found["panel"]), "mask": _mask_png(found["mask"], width, height), "segmenter": "ink"}


def run_edit(body: Any, progress: Any = None) -> dict[str, Any]:
    from yume_server.upscale import _png, _tags_from, mock_mode

    raw = base64.b64decode(body.image, validate=False)
    width, height, pixels = load_rgb(raw)
    preset = str(getattr(body, "preset", "2k") or "2k")
    planned = plan_target(width, height, preset)
    tap_x = getattr(body, "x", None)
    tap_y = getattr(body, "y", None)
    found = segment_person(pixels, width, height, 0.5 if tap_x is None else float(tap_x), 0.4 if tap_y is None else float(tap_y), list(getattr(body, "strokes", None) or []))
    detected = synthetic_reference(width, height)
    # Put the detected pose on the selected person so the swap stays in that panel.
    box = found["box"]
    detected = _move_pose(detected, box)
    size = str(getattr(body, "body", "average") or "average")
    placed = retarget_anchored(detected, size, height_cm=getattr(body, "height_cm", None), bust_cm=getattr(body, "bust_cm", None), hip_cm=getattr(body, "hip_cm", None))
    expanded = expand_for_body(box, detected, placed)
    references = [base64.b64decode(item, validate=False) for item in (getattr(body, "references", None) or []) if item]
    tags = _tags_from(references, str(getattr(body, "character_tags", "") or ""))
    color = page_is_color(pixels)
    prompt = edit_prompt(
        color=color,
        colorize=bool(getattr(body, "colorize", False)),
        tags=tags,
        clothes=str(getattr(body, "clothes", "") or ""),
        outfit=str(getattr(body, "outfit", "clothes") or "clothes"),
        prompt=str(getattr(body, "prompt", "") or ""),
    )
    bubbles = find_bubbles(pixels, width, height)
    strength = redraw_denoise(float(getattr(body, "strength", None) if getattr(body, "strength", None) is not None else getattr(body, "redraw", 0.55)))
    loras = [str(getattr(lora, "name", "") or "") for lora in (getattr(body, "loras", None) or []) if str(getattr(lora, "name", "") or "").strip()]
    payload = {
        "image": _png(planned["width"], planned["height"], 28, 28, 32),
        "width": planned["width"],
        "height": planned["height"],
        "preset": "4k" if preset.lower().replace(" ", "") == "4k" else "2k",
        "mode": "edit",
        "passes": planned["passes"],
        "panels": len(find_panels(pixels, width, height)),
        "bubbles": len(bubbles),
        "holes": len(expanded["holes"]),
        "box": list(expanded["box"]),
        "denoise": strength,
        "prompt": prompt,
        "page": "color" if color or bool(getattr(body, "colorize", False)) else "bw",
        "outfit": "original" if str(getattr(body, "outfit", "") or "") == "original" else "clothes",
        "controlnet": ["pose", "lineart"],
        "ip_adapter": "plus-face" if references else "",
        "loras": loras,
        "body": size if size in {"petite", "average", "tall"} else "average",
        "segmenter": "ink",
        "mask": _mask_png(found["mask"], width, height),
    }
    if mock_mode():
        return payload
    from yume_server.pose import render_skeleton
    from yume_server.upscale import _gpu

    sx = planned["width"] / max(1, width)
    sy = planned["height"] / max(1, height)
    scaled_pose = [None if point is None else (point[0] * sx, point[1] * sy) for point in placed]
    pose = render_skeleton(scaled_pose, planned["width"], planned["height"])
    holes = scale_rects(expanded["holes"], width, height, planned["width"], planned["height"])
    payload["image"] = base64.b64encode(
        _gpu(
            raw,
            references,
            planned,
            "edit",
            strength,
            prompt,
            list(getattr(body, "loras", None) or []),
            scale_rects(bubbles, width, height, planned["width"], planned["height"]),
            pose,
            holes,
            progress=progress,
        )
    ).decode("ascii")
    return payload


def _move_pose(points: list[Any], box: tuple[int, int, int, int]) -> list[Any]:
    present = [point for point in points if point is not None]
    if not present:
        return points
    min_x = min(point[0] for point in present)
    min_y = min(point[1] for point in present)
    max_x = max(point[0] for point in present)
    max_y = max(point[1] for point in present)
    span_x = max(1.0, max_x - min_x)
    span_y = max(1.0, max_y - min_y)
    left, top, width, height = box
    moved = []
    for point in points:
        if point is None:
            moved.append(None)
        else:
            moved.append((left + (point[0] - min_x) / span_x * width, top + (point[1] - min_y) / span_y * height))
    return moved


def _mask_png(mask: list[bool], width: int, height: int) -> str:
    import struct
    import zlib

    step = max(1, int(max(width, height) / 160))
    sw, sh = max(1, width // step), max(1, height // step)
    raw = bytearray()
    for y in range(sh):
        raw.append(0)
        sy = min(height - 1, y * step)
        for x in range(sw):
            sx = min(width - 1, x * step)
            on = mask[sy * width + sx]
            raw.extend(b"\xff\xff\xff" if on else b"\x00\x00\x00")
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", sw, sh, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(raw), 1)) + chunk(b"IEND", b"")
    return base64.b64encode(png).decode("ascii")


def page_style_prompt(color: bool) -> str:
    return "full color" if color else "monochrome"
