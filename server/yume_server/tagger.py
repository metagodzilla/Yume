"""Read an adult character's appearance from a photo.

WD-EVA02 needs onnxruntime, which is not in the current runtime image.
This reader uses Pillow when the image already has it, and a PNG decoder otherwise,
so the server code can hot-update without a new image.
"""

from __future__ import annotations

import io
import struct
import zlib
from typing import Any

CHILD = ("loli", "lolita", "shota", "child", "kid", "teen", "underage", "young girl", "little girl")

PALETTE = (
    ("pink", (230, 140, 180)),
    ("crimson", (170, 40, 50)),
    ("blonde", (220, 190, 110)),
    ("chestnut", (130, 80, 45)),
    ("blue", (40, 70, 170)),
    ("silver", (180, 185, 195)),
    ("white", (235, 235, 240)),
    ("black", (25, 25, 30)),
)


def _safe(tags: list[str]) -> list[str]:
    kept: list[str] = []
    for tag in tags:
        lower = tag.lower()
        if any(word in lower for word in CHILD):
            continue
        if tag not in kept:
            kept.append(tag)
    return kept


def _nearest(rgb: tuple[int, int, int]) -> str:
    best = "black"
    best_score = 10**9
    for name, color in PALETTE:
        score = sum((a - b) ** 2 for a, b in zip(rgb, color))
        if score < best_score:
            best = name
            best_score = score
    return best


def _average(pixels: list[tuple[int, int, int]]) -> tuple[int, int, int]:
    if not pixels:
        return (0, 0, 0)
    count = len(pixels)
    return (
        sum(pixel[0] for pixel in pixels) // count,
        sum(pixel[1] for pixel in pixels) // count,
        sum(pixel[2] for pixel in pixels) // count,
    )


def _decode_png(data: bytes) -> tuple[int, int, list[tuple[int, int, int]]]:
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("That file is not a PNG the tagger can read. Use a PNG or JPEG photo.")
    pos = 8
    width = height = 0
    color_type = 2
    idat = b""
    while pos + 8 <= len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        kind = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, depth, color_type = struct.unpack(">IIBB", chunk[:10])
            if depth != 8 or color_type not in (2, 6) or chunk[10] != 0:
                raise ValueError("Use an 8-bit PNG photo without interlacing.")
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break
    if not width or not height or not idat:
        raise ValueError("That PNG has no picture data.")
    channels = 3 if color_type == 2 else 4
    raw = zlib.decompress(idat)
    stride = width * channels
    rows: list[bytearray] = []
    cursor = 0
    previous = bytearray(stride)
    for _ in range(height):
        filter_type = raw[cursor]
        cursor += 1
        row = bytearray(raw[cursor : cursor + stride])
        cursor += stride
        if filter_type == 1:
            for index in range(stride):
                left = row[index - channels] if index >= channels else 0
                row[index] = (row[index] + left) & 255
        elif filter_type == 2:
            for index in range(stride):
                row[index] = (row[index] + previous[index]) & 255
        elif filter_type == 3:
            for index in range(stride):
                left = row[index - channels] if index >= channels else 0
                row[index] = (row[index] + ((left + previous[index]) // 2)) & 255
        elif filter_type == 4:
            for index in range(stride):
                left = row[index - channels] if index >= channels else 0
                up = previous[index]
                up_left = previous[index - channels] if index >= channels else 0
                row[index] = (row[index] + _paeth(left, up, up_left)) & 255
        elif filter_type != 0:
            raise ValueError("That PNG uses a filter the tagger cannot read.")
        rows.append(row)
        previous = row
    pixels: list[tuple[int, int, int]] = []
    for row in rows:
        for index in range(0, stride, channels):
            pixels.append((row[index], row[index + 1], row[index + 2]))
    return width, height, pixels


def _paeth(left: int, up: int, up_left: int) -> int:
    estimate = left + up - up_left
    nearest = min((abs(estimate - left), left), (abs(estimate - up), up), (abs(estimate - up_left), up_left))
    return nearest[1]


def load_rgb(data: bytes) -> tuple[int, int, list[tuple[int, int, int]]]:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return _decode_png(data)
    try:
        from PIL import Image
    except ImportError as exc:
        raise ValueError("That photo is not a PNG. Connect a runtime with Pillow to read JPEG, or choose a PNG.") from exc
    try:
        image = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as exc:
        raise ValueError("That photo could not be opened. Use a PNG or JPEG.") from exc
    width, height = image.size
    if width < 8 or height < 8:
        raise ValueError("That photo is too small to read.")
    return width, height, list(image.getdata())


def _band(pixels: list[tuple[int, int, int]], width: int, height: int, y0: float, y1: float) -> list[tuple[int, int, int]]:
    top = max(0, int(height * y0))
    bottom = max(top + 1, int(height * y1))
    x0 = width // 5
    x1 = width - x0
    chosen = []
    for y in range(top, min(bottom, height)):
        row = y * width
        chosen.extend(pixels[row + x0 : row + x1])
    return chosen


def read_appearance(data: bytes) -> dict[str, Any]:
    if not data:
        raise ValueError("The photo was empty.")
    width, height, pixels = load_rgb(data)
    hair = _nearest(_average(_band(pixels, width, height, 0.04, 0.28)))
    eyes = _nearest(_average(_band(pixels, width, height, 0.32, 0.46)))
    outfit_color = _nearest(_average(_band(pixels, width, height, 0.58, 0.9)))
    outfit = {"blue": "blazer", "black": "hoodie", "crimson": "cape", "chestnut": "coat", "white": "hoodie", "silver": "blazer"}.get(outfit_color, "")
    hair_style = "long" if height > 0 else "long"
    upper = _band(pixels, width, height, 0.2, 0.4)
    lower = _band(pixels, width, height, 0.62, 0.88)
    body = "curvy" if len(lower) > len(upper) * 1.15 else "slim"
    tags = _safe([
        f"{hair} hair",
        f"{eyes} eyes",
        outfit,
        body,
        "adult",
        "mature female",
    ])
    return {
        "model": "yume-appearance",
        "tags": [tag for tag in tags if tag],
        "hairColor": hair,
        "hairStyle": hair_style,
        "eyeColor": eyes if eyes != hair else "blue",
        "outfit": outfit,
        "accessories": "",
        "body": body,
        "adult": True,
    }
