import base64
import os
import struct
import zlib

os.environ.setdefault("YUME_MOCK", "1")
os.environ.setdefault("YUME_API_KEY", "test-key")
os.environ.setdefault("YUME_MODEL_DIR", "/tmp/yume-model-cache")

from fastapi.testclient import TestClient

from yume_server.main import app
from yume_server.tagger import read_appearance


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png(width: int, height: int, paint) -> bytes:
    raw = b""
    for y in range(height):
        raw += b"\x00"
        for x in range(width):
            raw += bytes(paint(x, y))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", zlib.compress(raw)) + _chunk(b"IEND", b"")


def test_appearance_reads_regions_and_stays_adult() -> None:
    def paint(_x: int, y: int) -> tuple[int, int, int]:
        if y < 12:
            return (230, 140, 180)
        if y < 20:
            return (40, 70, 170)
        return (170, 40, 50)

    found = read_appearance(png(24, 40, paint))
    assert found["hairColor"] == "pink"
    assert found["eyeColor"] == "blue"
    assert found["adult"] is True
    text = " ".join(found["tags"]).lower()
    assert "adult" in text and "mature female" in text
    assert "loli" not in text and "child" not in text and "teen" not in text


def test_tag_endpoint_accepts_a_png() -> None:
    image = png(24, 40, lambda _x, y: (230, 140, 180) if y < 16 else (40, 70, 170))
    with TestClient(app) as client:
        denied = client.post("/tag", json={"image": base64.b64encode(image).decode()})
        assert denied.status_code == 401
        ok = client.post(
            "/tag",
            headers={"Authorization": "Bearer test-key"},
            json={"image": base64.b64encode(image).decode()},
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["hairColor"] == "pink"
        assert ok.json()["model"] == "yume-appearance"
