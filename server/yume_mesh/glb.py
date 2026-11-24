"""A tiny textured GLB for mock mode. No third-party mesh library."""

from __future__ import annotations

import json
import struct
import zlib


def _png(colors: list[tuple[int, int, int]]) -> bytes:
    width = len(colors)
    raw = bytearray([0])
    for red, green, blue in colors:
        raw.extend((red, green, blue))

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, 1, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 1)) + chunk(b"IEND", b"")


def _box(parts: dict[str, list[float] | list[int]], origin: tuple[float, float, float], size: tuple[float, float, float], uv: tuple[float, float]) -> None:
    ox, oy, oz = origin
    sx, sy, sz = size
    corners = [
        (ox, oy, oz + sz),
        (ox + sx, oy, oz + sz),
        (ox + sx, oy + sy, oz + sz),
        (ox, oy + sy, oz + sz),
        (ox, oy, oz),
        (ox + sx, oy, oz),
        (ox + sx, oy + sy, oz),
        (ox, oy + sy, oz),
    ]
    faces = [
        (0, 1, 2, 3, (0, 0, 1)),
        (5, 4, 7, 6, (0, 0, -1)),
        (4, 0, 3, 7, (-1, 0, 0)),
        (1, 5, 6, 2, (1, 0, 0)),
        (3, 2, 6, 7, (0, 1, 0)),
        (4, 5, 1, 0, (0, -1, 0)),
    ]
    positions = parts["positions"]
    normals = parts["normals"]
    uvs = parts["uvs"]
    indices = parts["indices"]
    assert isinstance(positions, list) and isinstance(normals, list) and isinstance(uvs, list) and isinstance(indices, list)
    for a, b, c, d, normal in faces:
        start = len(positions) // 3
        for corner in (a, b, c, d):
            x, y, z = corners[corner]
            positions.extend((x, y, z))
            normals.extend(normal)
            uvs.extend(uv)
        indices.extend((start, start + 1, start + 2, start, start + 2, start + 3))


def _pad(data: bytes, fill: int) -> bytes:
    extra = (4 - (len(data) % 4)) % 4
    return data + bytes([fill]) * extra


def build_mock_glb() -> bytes:
    png = _png([(242, 196, 176), (255, 142, 199), (72, 40, 96), (64, 140, 210)])
    parts: dict[str, list[float] | list[int]] = {"positions": [], "normals": [], "uvs": [], "indices": []}
    _box(parts, (-0.34, 1.05, -0.28), (0.68, 0.7, 0.56), (0.125, 0.5))
    _box(parts, (-0.4, 0.05, -0.22), (0.8, 0.95, 0.44), (0.625, 0.5))
    _box(parts, (-0.4, 1.45, -0.32), (0.8, 0.42, 0.6), (0.375, 0.5))
    _box(parts, (-0.16, 1.28, 0.28), (0.1, 0.1, 0.06), (0.875, 0.5))
    _box(parts, (0.06, 1.28, 0.28), (0.1, 0.1, 0.06), (0.875, 0.5))
    positions = parts["positions"]
    assert isinstance(positions, list)
    index_list = parts["indices"]
    assert isinstance(index_list, list)
    index_bytes = b"".join(struct.pack("<H", int(value)) for value in index_list)
    pos_bytes = b"".join(struct.pack("<f", float(value)) for value in positions)
    nrm_bytes = b"".join(struct.pack("<f", float(value)) for value in parts["normals"])
    uv_bytes = b"".join(struct.pack("<f", float(value)) for value in parts["uvs"])
    blocks = [index_bytes, pos_bytes, nrm_bytes, uv_bytes, png]
    cursor = 0
    views = []
    bin_parts = []
    for index, block in enumerate(blocks):
        views.append({"buffer": 0, "byteOffset": cursor, "byteLength": len(block), **({"target": 34963} if index == 0 else {"target": 34962} if index < 4 else {})})
        padded = _pad(block, 0)
        bin_parts.append(padded)
        cursor += len(padded)
    blob = b"".join(bin_parts)
    xs = positions[0::3]
    ys = positions[1::3]
    zs = positions[2::3]
    payload = {
        "asset": {"version": "2.0", "generator": "yume"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "stand-in"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 1, "NORMAL": 2, "TEXCOORD_0": 3}, "indices": 0, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 0.85}, "doubleSided": True}],
        "textures": [{"sampler": 0, "source": 0}],
        "samplers": [{"magFilter": 9728, "minFilter": 9728}],
        "images": [{"mimeType": "image/png", "bufferView": 4}],
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": views,
        "accessors": [
            {"bufferView": 0, "componentType": 5123, "count": len(index_list), "type": "SCALAR"},
            {"bufferView": 1, "componentType": 5126, "count": len(positions) // 3, "type": "VEC3", "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]},
            {"bufferView": 2, "componentType": 5126, "count": len(parts["normals"]) // 3, "type": "VEC3"},
            {"bufferView": 3, "componentType": 5126, "count": len(parts["uvs"]) // 2, "type": "VEC2"},
        ],
    }
    json_bytes = _pad(json.dumps(payload, separators=(",", ":")).encode("utf-8"), 0x20)
    def chunk(kind: int, data: bytes) -> bytes:
        return struct.pack("<II", len(data), kind) + data
    body = chunk(0x4E4F534A, json_bytes) + chunk(0x004E4942, blob)
    return struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body
