"""Image-to-3D. Mock mode returns a textured GLB. The GPU container runs TRELLIS."""

from __future__ import annotations

import base64
import os
import tempfile
from typing import Any

from yume_mesh.glb import build_mock_glb

_PIPE: Any = None

MODEL = "microsoft/TRELLIS-image-large"


def mock_mode() -> bool:
    return os.environ.get("YUME_MOCK", "").strip() in {"1", "true", "yes"}


def model_id() -> str:
    return os.environ.get("YUME_MESH_MODEL", MODEL).strip() or MODEL


def start_model() -> None:
    global _PIPE
    if mock_mode():
        return
    os.environ.setdefault("SPCONV_ALGO", "native")
    from trellis.pipelines import TrellisImageTo3DPipeline

    _PIPE = TrellisImageTo3DPipeline.from_pretrained(model_id())
    _PIPE.cuda()


def generate_mesh(body: Any) -> dict[str, Any]:
    image = getattr(body, "image", None) or ""
    views = list(getattr(body, "views", None) or [])
    if not str(image).strip():
        raise ValueError("A front-view image is required.")
    if mock_mode():
        return {
            "glb": base64.b64encode(build_mock_glb()).decode("ascii"),
            "model": "yume-stand-in",
            "mode": "mock",
            "multi_view": False,
            "ignored_views": len(views),
            "note": "Mock mode built a stand-in mesh. TRELLIS is not running. Hands and hair on a real mesh often need cleanup.",
        }
    if _PIPE is None:
        raise RuntimeError("The mesh model is not loaded.")
    return _trellis(str(image), views)


def _trellis(image_b64: str, views: list[Any]) -> dict[str, Any]:
    import io

    from PIL import Image
    from trellis.utils import postprocessing_utils

    raw = base64.b64decode(image_b64)
    image = Image.open(io.BytesIO(raw)).convert("RGBA")
    outputs = _PIPE.run(image, seed=1)
    glb = postprocessing_utils.to_glb(
        outputs["gaussian"][0],
        outputs["mesh"][0],
        simplify=0.95,
        texture_size=512,
    )
    fd, path = tempfile.mkstemp(suffix=".glb")
    os.close(fd)
    try:
        glb.export(path)
        with open(path, "rb") as handle:
            data = handle.read()
    finally:
        os.remove(path)
    return {
        "glb": base64.b64encode(data).decode("ascii"),
        "model": model_id(),
        "mode": "trellis",
        "multi_view": False,
        "ignored_views": len(views),
        "note": "TRELLIS used the front view only. Hair, fingers, and thin clothes often need cleanup.",
    }
