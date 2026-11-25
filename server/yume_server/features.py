"""Install optional packages on first use into /data, not into the image.

The slim runtime has torch and diffusers only. 3D, pose detection, and the
upscaler runtime download here, report a progress bar, and are restored later
only when the phone says they were used.
"""

from __future__ import annotations

import importlib
import json
import logging
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

_LOG = logging.getLogger("yume.features")
_LOCK = threading.Lock()

FEATURES: dict[str, dict[str, Any]] = {
    "peft": {
        "packages": ["peft==0.14.0"],
        "no_deps": True,
        "import_name": "peft",
        "label": "LoRA support",
        "kind": "Feature",
    },
    "upscaler": {
        "packages": ["spandrel==0.4.1"],
        "no_deps": False,
        "import_name": "spandrel",
        "label": "Anime upscaler runtime",
        "kind": "Upscaler",
    },
    "pose": {
        "packages": ["controlnet_aux==0.0.9", "opencv-python-headless==4.10.0.84"],
        "no_deps": False,
        "import_name": "controlnet_aux",
        "label": "OpenPose detector",
        "kind": "Annotator",
    },
    "triposr": {
        "packages": [
            "einops==0.7.0",
            "omegaconf==2.3.0",
            "antlr4-python3-runtime==4.9.3",
            "trimesh==4.0.5",
            "scikit-image==0.24.0",
            "imageio==2.36.1",
            "lazy_loader==0.4",
            "tifffile==2024.9.20",
            "networkx==3.2.1",
            "packaging==24.2",
        ],
        "no_deps": True,
        "import_name": "trimesh",
        "label": "3D TripoSR",
        "kind": "3D",
    },
}


def feature_root() -> Path:
    root = Path(os.environ.get("YUME_FEATURE_ROOT", "/data/features"))
    root.mkdir(parents=True, exist_ok=True)
    return root


def known_features(names: list[str]) -> list[str]:
    seen: list[str] = []
    for name in names:
        key = str(name or "").strip()
        if key in FEATURES and key not in seen:
            seen.append(key)
    return seen


def read_used() -> list[str]:
    path = feature_root() / "used.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    return known_features([str(item) for item in data])


def remember_used(name: str) -> None:
    if name not in FEATURES:
        return
    current = read_used()
    if name in current:
        return
    path = feature_root() / "used.json"
    path.write_text(json.dumps([*current, name]), encoding="utf-8")


def _imported(name: str) -> bool:
    module = FEATURES[name]["import_name"]
    try:
        importlib.import_module(module)
    except Exception:
        return False
    return True


def _activate(name: str) -> None:
    path = str(feature_root() / name)
    if path not in sys.path:
        sys.path.insert(0, path)


def ensure_feature(name: str) -> bool:
    if name not in FEATURES:
        return False
    _activate(name)
    if _imported(name):
        remember_used(name)
        return True
    if os.environ.get("YUME_MOCK", "").strip().lower() in {"1", "true", "yes"}:
        return False
    with _LOCK:
        _activate(name)
        if _imported(name):
            remember_used(name)
            return True
        spec = FEATURES[name]
        target = feature_root() / name
        target.mkdir(parents=True, exist_ok=True)
        from yume_server.startup import note_file

        packages: list[str] = list(spec["packages"])
        note_file(f"feature-{name}", name=spec["label"], kind=spec["kind"], done=0, total=len(packages), state="downloading", feature=name)
        command = [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--no-cache-dir",
            "--target",
            str(target),
            *packages,
        ]
        if spec["no_deps"]:
            command.insert(-len(packages), "--no-deps")
        _LOG.info("installing feature %s into %s", name, target)
        try:
            subprocess.run(command, check=True, timeout=600)
        except (OSError, subprocess.SubprocessError):
            _LOG.exception("feature %s failed to install", name)
            note_file(f"feature-{name}", name=spec["label"], kind=spec["kind"], done=0, total=len(packages), state="error", feature=name)
            return False
        importlib.invalidate_caches()
        _activate(name)
        ok = _imported(name)
        note_file(
            f"feature-{name}",
            name=spec["label"],
            kind=spec["kind"],
            done=len(packages) if ok else 0,
            total=len(packages),
            state="done" if ok else "error",
            feature=name,
        )
        if ok:
            remember_used(name)
        return ok


def restore_features(names: list[str]) -> list[str]:
    """Install only features the phone says were used. Unknown names are ignored."""
    chosen = known_features(names)
    ready = [name for name in chosen if ensure_feature(name)]
    return ready
