"""Retarget an OpenPose skeleton onto the character's body, then fit it to the canvas.

Joint angles and where the pose sits stay. Limb, torso, and head lengths change
to adult anime proportions (petite, average, or tall), optionally nudged by the
casting sheet. The result is centered and scaled to fill the frame.
"""

from __future__ import annotations

import struct
import zlib
from typing import Any

# OpenPose BODY_18.
NOSE, NECK = 0, 1
R_SHOULDER, R_ELBOW, R_WRIST = 2, 3, 4
L_SHOULDER, L_ELBOW, L_WRIST = 5, 6, 7
R_HIP, R_KNEE, R_ANKLE = 8, 9, 10
L_HIP, L_KNEE, L_ANKLE = 11, 12, 13
R_EYE, L_EYE, R_EAR, L_EAR = 14, 15, 16, 17

Point = tuple[float, float]
Pose = list[Point | None]

# parent, child, group. Lengths are relative to an average torso.
BONES: tuple[tuple[int, int, str], ...] = (
    (NECK, NOSE, "head"),
    (NOSE, R_EYE, "head"),
    (NOSE, L_EYE, "head"),
    (R_EYE, R_EAR, "head"),
    (L_EYE, L_EAR, "head"),
    (NECK, R_SHOULDER, "shoulder"),
    (R_SHOULDER, R_ELBOW, "arm"),
    (R_ELBOW, R_WRIST, "arm"),
    (NECK, L_SHOULDER, "shoulder"),
    (L_SHOULDER, L_ELBOW, "arm"),
    (L_ELBOW, L_WRIST, "arm"),
    (NECK, R_HIP, "torso"),
    (R_HIP, R_KNEE, "leg"),
    (R_KNEE, R_ANKLE, "leg"),
    (NECK, L_HIP, "torso"),
    (L_HIP, L_KNEE, "leg"),
    (L_KNEE, L_ANKLE, "leg"),
)

LENGTH = {
    "head": 0.42,
    "shoulder": 0.38,
    "arm": 0.62,
    "torso": 0.72,
    "leg": 0.95,
}

SIZE_SCALE = {
    "petite": {"head": 1.2, "shoulder": 0.92, "arm": 0.84, "torso": 0.9, "leg": 0.78},
    "average": {"head": 1.0, "shoulder": 1.0, "arm": 1.0, "torso": 1.0, "leg": 1.0},
    "tall": {"head": 0.88, "shoulder": 1.04, "arm": 1.08, "torso": 1.08, "leg": 1.24},
}

DEFAULT_DIRECTION = {
    "head": (0.0, -1.0),
    "shoulder": (1.0, 0.0),
    "arm": (1.0, 1.0),
    "torso": (0.15, 1.0),
    "leg": (0.1, 1.0),
}


def body_size_from_height(height_cm: float | None) -> str:
    if height_cm is None or height_cm <= 0:
        return "average"
    if height_cm < 155:
        return "petite"
    if height_cm > 175:
        return "tall"
    return "average"


def proportion_scale(size: str, height_cm: float | None = None, bust_cm: float | None = None, hip_cm: float | None = None) -> dict[str, float]:
    base = dict(SIZE_SCALE.get(size, SIZE_SCALE["average"]))
    if height_cm and height_cm > 0:
        nudge = max(0.85, min(1.25, height_cm / 162.0))
        base["leg"] *= nudge
        base["torso"] *= 0.94 + 0.06 * nudge
    if bust_cm and hip_cm and bust_cm > 0:
        base["shoulder"] *= max(0.9, min(1.2, (hip_cm / bust_cm) ** 0.5))
    return base


def _direction(start: Point | None, end: Point | None, group: str, side: float) -> tuple[float, float]:
    if start is not None and end is not None:
        dx, dy = end[0] - start[0], end[1] - start[1]
        norm = (dx * dx + dy * dy) ** 0.5
        if norm > 1e-3:
            return dx / norm, dy / norm
    dx, dy = DEFAULT_DIRECTION[group]
    return dx * side, dy


def _children() -> dict[int, list[tuple[int, str]]]:
    graph: dict[int, list[tuple[int, str]]] = {}
    for parent, child, group in BONES:
        graph.setdefault(parent, []).append((child, group))
    return graph


def retarget(points: Pose, size: str, width: int, height: int, *, fit: bool = True, height_cm: float | None = None, bust_cm: float | None = None, hip_cm: float | None = None) -> Pose:
    """Keep angles. Optionally replace bone lengths, then center and fill the canvas."""
    width = max(8, int(width))
    height = max(8, int(height))
    current: Pose = [None if point is None else (float(point[0]), float(point[1])) for point in list(points)[:18]]
    while len(current) < 18:
        current.append(None)
    if not fit:
        return fit_canvas(current, width, height)
    root = NECK if current[NECK] is not None else next((index for index, point in enumerate(current) if point is not None), None)
    if root is None:
        return current
    scales = proportion_scale(size, height_cm, bust_cm, hip_cm)
    unit = 180.0
    rebuilt: Pose = [None] * 18
    rebuilt[root] = current[root]
    seen = {root}
    queue = [root]
    graph = _children()
    while queue:
        parent = queue.pop(0)
        for child, group in graph.get(parent, []):
            if child in seen:
                continue
            seen.add(child)
            side = -1.0 if child in {L_SHOULDER, L_ELBOW, L_WRIST, L_HIP, L_KNEE, L_ANKLE, L_EYE, L_EAR} else 1.0
            direction = _direction(current[parent], current[child], group, side)
            length = unit * LENGTH[group] * scales[group]
            origin = rebuilt[parent] or (0.0, 0.0)
            rebuilt[child] = (origin[0] + direction[0] * length, origin[1] + direction[1] * length)
            queue.append(child)
    return fit_canvas(rebuilt, width, height)


def fit_canvas(points: Pose, width: int, height: int, margin: float = 0.08) -> Pose:
    present = [point for point in points if point is not None]
    if not present:
        return points
    min_x = min(point[0] for point in present)
    max_x = max(point[0] for point in present)
    min_y = min(point[1] for point in present)
    max_y = max(point[1] for point in present)
    span_x = max(1.0, max_x - min_x)
    span_y = max(1.0, max_y - min_y)
    usable_x = width * (1 - margin * 2)
    usable_y = height * (1 - margin * 2)
    scale = min(usable_x / span_x, usable_y / span_y)
    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2
    fitted: Pose = []
    for point in points:
        if point is None:
            fitted.append(None)
            continue
        fitted.append(((point[0] - center_x) * scale + width / 2, (point[1] - center_y) * scale + height / 2))
    return fitted


def bone_length(points: Pose, parent: int, child: int) -> float:
    start, end = points[parent], points[child]
    if start is None or end is None:
        return 0.0
    dx, dy = end[0] - start[0], end[1] - start[1]
    return (dx * dx + dy * dy) ** 0.5


def bone_angle(points: Pose, parent: int, child: int) -> float | None:
    start, end = points[parent], points[child]
    if start is None or end is None:
        return None
    return end[1] - start[1], end[0] - start[0]  # type: ignore[return-value]


def render_skeleton(points: Pose, width: int, height: int) -> bytes:
    """Black canvas, colored bones. Enough for a preview and a ControlNet condition."""
    width = max(8, int(width))
    height = max(8, int(height))
    pixels = bytearray(width * height * 3)
    colors = {
        "head": (255, 220, 180),
        "shoulder": (120, 220, 255),
        "arm": (80, 180, 255),
        "torso": (255, 160, 200),
        "leg": (180, 255, 160),
    }

    def plot(x: float, y: float, color: tuple[int, int, int]) -> None:
        ix, iy = int(round(x)), int(round(y))
        if 0 <= ix < width and 0 <= iy < height:
            index = (iy * width + ix) * 3
            pixels[index : index + 3] = bytes(color)

    def line(a: Point, b: Point, color: tuple[int, int, int]) -> None:
        steps = int(max(abs(b[0] - a[0]), abs(b[1] - a[1]))) + 1
        for step in range(steps + 1):
            blend = step / max(1, steps)
            plot(a[0] + (b[0] - a[0]) * blend, a[1] + (b[1] - a[1]) * blend, color)

    for parent, child, group in BONES:
        if points[parent] is None or points[child] is None:
            continue
        line(points[parent], points[child], colors[group])  # type: ignore[arg-type]
    for point in points:
        if point is None:
            continue
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                plot(point[0] + dx, point[1] + dy, (255, 255, 255))
    return _png(width, height, bytes(pixels))


def _png(width: int, height: int, rgb: bytes) -> bytes:
    raw = b"".join(b"\x00" + rgb[y * width * 3 : (y + 1) * width * 3] for y in range(height))
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def synthetic_reference(width: int = 512, height: int = 768) -> Pose:
    """A short, big-headed figure in the corner. Used when the detector is not loaded."""
    cx, cy = width * 0.28, height * 0.22
    def p(x: float, y: float) -> Point:
        return (cx + x, cy + y)

    points: Pose = [None] * 18
    points[NOSE] = p(0, -70)
    points[NECK] = p(0, -20)
    points[R_SHOULDER] = p(28, -16)
    points[R_ELBOW] = p(40, 10)
    points[R_WRIST] = p(36, 36)
    points[L_SHOULDER] = p(-28, -16)
    points[L_ELBOW] = p(-18, 18)
    points[L_WRIST] = p(-8, 40)
    points[R_HIP] = p(16, 30)
    points[R_KNEE] = p(18, 55)
    points[R_ANKLE] = p(18, 78)
    points[L_HIP] = p(-16, 30)
    points[L_KNEE] = p(-18, 52)
    points[L_ANKLE] = p(-16, 74)
    points[R_EYE] = p(8, -78)
    points[L_EYE] = p(-8, -78)
    points[R_EAR] = p(18, -74)
    points[L_EAR] = p(-18, -74)
    return points


def adjust_pose(points: Pose, *, size: str, width: int, height: int, fit: bool, height_cm: float | None = None, bust_cm: float | None = None, hip_cm: float | None = None) -> dict[str, Any]:
    adjusted = retarget(points, size, width, height, fit=fit, height_cm=height_cm, bust_cm=bust_cm, hip_cm=hip_cm)
    return {
        "points": [[None, None] if point is None else [round(point[0], 2), round(point[1], 2)] for point in adjusted],
        "png": render_skeleton(adjusted, width, height),
    }
