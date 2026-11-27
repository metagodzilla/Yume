"""Download one ControlNet weight file, not the repo's preview images."""

from __future__ import annotations

import os
from typing import Any

MIN_WEIGHT_BYTES = 1_000_000
LINEART_REPO = "TheMistoAI/MistoLine"


def controlnet_weight_name(repo: str) -> str:
    if repo == LINEART_REPO:
        return "diffusion_pytorch_model.fp16.safetensors"
    return "diffusion_pytorch_model.safetensors"


def assert_real_weight(path: str) -> int:
    size = os.path.getsize(path)
    if size < MIN_WEIGHT_BYTES:
        raise RuntimeError(f"{os.path.basename(path)} is {size} bytes, which is not the ControlNet weights.")
    return size


def download_controlnet(repo: str, cache: str, key: str, label: str) -> str:
    """Fetch config plus the real safetensors. Progress follows that weight file."""
    from huggingface_hub import hf_hub_download

    from yume_server.startup import note_file, tqdm_factory

    filename = controlnet_weight_name(repo)
    path = hf_hub_download(repo, filename, cache_dir=cache, tqdm_class=tqdm_factory(key, label, "ControlNet"))
    hf_hub_download(repo, "config.json", cache_dir=cache)
    size = assert_real_weight(path)
    note_file(key, name=label, kind="ControlNet", done=size, total=size, state="done")
    return path
