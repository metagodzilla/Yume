"""Lazy ControlNet and IP-Adapter weights, plus the pose preview used by /reference/pose.

Annotator and adapter files download on first use into the model cache, and again
when /models/restore runs on a reallocated node. Nothing here is logged with a token.
"""

from __future__ import annotations

import base64
import logging
import os
import subprocess
import sys
import threading
from typing import Any

from yume_server.pose import adjust_pose, body_size_from_height, synthetic_reference

_LOG = logging.getLogger("yume.reference")
CONTROLNET_REPO = "xinsir/controlnet-openpose-sdxl-1.0"
IP_REPO = "h94/IP-Adapter"
IP_SUBFOLDER = "sdxl_models"
IP_WEIGHT = "ip-adapter-plus_sdxl_vit-h.safetensors"
_READY = False
_LOCK = threading.Lock()


def mock_mode() -> bool:
    return os.environ.get("YUME_MOCK", "").strip().lower() in {"1", "true", "yes"}


def style_scale(strength: float) -> dict[str, Any]:
    """Keep style blocks and turn down the blocks that copy face and layout."""
    amount = max(0.0, min(1.0, float(strength)))
    return {
        "down": {"block_2": [0.0, 0.0]},
        "mid": 0.0,
        "up": {"block_0": [0.0, amount, 0.0]},
    }


def ensure_reference_weights() -> None:
    """Download pose ControlNet and the SDXL IP-Adapter the first time they are needed."""
    global _READY
    if mock_mode() or _READY:
        return
    with _LOCK:
        if _READY:
            return
        from yume_server.features import ensure_feature

        if not ensure_feature("pose"):
            raise RuntimeError("The pose detector is still installing. Try again in a moment.")
        from huggingface_hub import snapshot_download

        cache = os.environ.get("HF_HOME") or os.environ.get("YUME_MODEL_DIR") or "/models"
        from yume_server.startup import note_file, tqdm_factory

        from yume_server.weights import download_controlnet

        download_controlnet(CONTROLNET_REPO, cache, "controlnet-pose", "OpenPose ControlNet")
        snapshot_download(IP_REPO, allow_patterns=[f"{IP_SUBFOLDER}/ip-adapter-plus_sdxl_vit-h.*", f"{IP_SUBFOLDER}/image_encoder/**"], cache_dir=cache, tqdm_class=tqdm_factory("ip-adapter", "IP-Adapter", "IP-Adapter"))
        note_file("ip-adapter", name="IP-Adapter", kind="IP-Adapter", done=1, total=1, state="done")
        _READY = True
        _LOG.info("reference weights ready: %s and %s", CONTROLNET_REPO, IP_WEIGHT)


def schedule_reference_weights() -> None:
    if mock_mode():
        return
    threading.Thread(target=_safe_download, name="yume-reference-weights", daemon=True).start()


def _safe_download() -> None:
    try:
        ensure_reference_weights()
    except Exception:
        _LOG.exception("reference weights could not be downloaded yet")
    try:
        from yume_server.upscale import ensure_upscale_weights

        ensure_upscale_weights()
    except Exception:
        _LOG.exception("upscale weights could not be downloaded yet")


def _measure(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def pose_preview(image: bytes, *, fit: bool, size: str, width: int, height: int, height_cm: float | None = None, bust_cm: float | None = None, hip_cm: float | None = None) -> dict[str, Any]:
    chosen = size if size in {"petite", "average", "tall"} else body_size_from_height(height_cm)
    detected = _detect(image, width, height)
    adjusted = adjust_pose(detected, size=chosen, width=width, height=height, fit=fit, height_cm=height_cm, bust_cm=bust_cm, hip_cm=hip_cm)
    return {
        "skeleton": base64.b64encode(adjusted["png"]).decode("ascii"),
        "points": adjusted["points"],
        "body": chosen,
        "fit": fit,
    }


def _detect(image: bytes, width: int, height: int):
    if mock_mode():
        return synthetic_reference(width, height)
    try:
        ensure_reference_weights()
        from controlnet_aux import OpenposeDetector
        from PIL import Image
        import io

        detector = OpenposeDetector.from_pretrained("lllyasviel/Annotators")
        picture = Image.open(io.BytesIO(image)).convert("RGB")
        poses = getattr(detector, "detect_poses", None)
        if callable(poses):
            bodies = poses(picture, include_hand=False, include_face=False)
            if bodies:
                body = bodies[0].body.keypoints if hasattr(bodies[0], "body") else None
                if body:
                    return _from_aux(body, width, height)
        return synthetic_reference(width, height)
    except Exception:
        _LOG.exception("OpenPose detector failed; using a standing stand-in")
        return synthetic_reference(width, height)


def _from_aux(keypoints: Any, width: int, height: int):
    points = []
    for item in list(keypoints)[:18]:
        x = getattr(item, "x", None)
        y = getattr(item, "y", None)
        if x is None or y is None or float(x) < 0 or float(y) < 0:
            points.append(None)
        else:
            points.append((float(x) * width, float(y) * height))
    while len(points) < 18:
        points.append(None)
    return points
