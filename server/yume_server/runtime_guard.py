"""Keep the image's torch and numpy. A feature install must not replace them."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

_LOG = logging.getLogger("yume.runtime")
IMAGE_TORCH = "2.5.1"


def is_protected_package(name: str) -> bool:
    low = name.lower().replace("_", "-")
    return low in {"torch", "numpy", "triton"} or low.startswith("nvidia-") or low.startswith("nvidia") or low.startswith("cuda")


def constraint_text(packages: list[tuple[str, str]]) -> str:
    lines = [f"{name}=={version}" for name, version in packages if is_protected_package(name)]
    return "\n".join(lines) + ("\n" if lines else "")


def runtime_problem(torch_version: str, torch_file: str, numpy_file: str) -> str | None:
    problems: list[str] = []
    if not str(torch_version or "").startswith(IMAGE_TORCH):
        problems.append(f"torch {torch_version} is not the image pin {IMAGE_TORCH}")
    shadow = "/data/features"
    if shadow in (torch_file or "") or shadow in (numpy_file or ""):
        problems.append(f"torch or numpy is loading from a feature install ({torch_file}, {numpy_file})")
    if not problems:
        return None
    return "RUNTIME MISMATCH: " + "; ".join(problems) + ". Generation can break until the image's torch and numpy are the ones imported."


def quarantine_runtime_packages(target: Path) -> list[str]:
    """Move a feature copy of torch, numpy, or CUDA out of the import path."""
    if not target.is_dir():
        return []
    moved: list[str] = []
    for child in list(target.iterdir()):
        if not is_protected_package(child.name):
            continue
        dest = target / f"{child.name}.removed"
        if dest.exists():
            shutil.rmtree(dest) if dest.is_dir() else dest.unlink()
        child.rename(dest)
        moved.append(child.name)
        _LOG.error("moved %s out of the feature import path so it cannot replace the image runtime", child.name)
    return moved


def audit_runtime() -> str | None:
    try:
        import numpy
        import torch
    except Exception as exc:
        _LOG.info("runtime audit skipped: %s", exc)
        return None
    problem = runtime_problem(getattr(torch, "__version__", ""), getattr(torch, "__file__", "") or "", getattr(numpy, "__file__", "") or "")
    if problem:
        _LOG.error(problem)
    else:
        _LOG.info("runtime torch=%s numpy=%s", torch.__version__, numpy.__version__)
    return problem
