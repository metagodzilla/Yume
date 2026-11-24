"""Host stats for /stats and /diagnostics. Mock mode never invents a real GPU."""

from __future__ import annotations

import os
import shutil
import time
from typing import Any

STARTED = time.time()


def collect() -> dict[str, Any]:
    mock = os.environ.get("YUME_MOCK", "").strip() in {"1", "true", "yes"}
    gpu = _gpu()
    ram = _ram()
    disk = _disk()
    return {
        "gpu": gpu.get("name") or ("Mock (no GPU in this process)" if mock else "Unavailable"),
        "utilPercent": gpu.get("util"),
        "vramUsedMb": gpu.get("used"),
        "vramTotalMb": gpu.get("total"),
        "ramUsedMb": ram.get("used"),
        "ramTotalMb": ram.get("total"),
        "diskFreeMb": disk.get("free"),
        "diskTotalMb": disk.get("total"),
        "uptimeSec": int(time.time() - STARTED),
        "model": "Animagine XL 4.0",
        "modelLoaded": os.environ.get("YUME_READY", "1") != "0",
        "source": gpu.get("source") or ("mock" if mock else "host"),
    }


def _gpu() -> dict[str, Any]:
    try:
        import pynvml  # type: ignore

        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        name = pynvml.nvmlDeviceGetName(handle)
        mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
        util = pynvml.nvmlDeviceGetUtilizationRates(handle)
        return {
            "name": name.decode() if isinstance(name, bytes) else str(name),
            "used": int(mem.used / (1024 * 1024)),
            "total": int(mem.total / (1024 * 1024)),
            "util": int(util.gpu),
            "source": "pynvml",
        }
    except Exception:
        pass
    try:
        import subprocess

        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"],
            text=True,
            timeout=3,
        ).strip().splitlines()
        if out:
            name, used, total, util = [part.strip() for part in out[0].split(",")]
            return {"name": name, "used": int(float(used)), "total": int(float(total)), "util": int(float(util)), "source": "nvidia-smi"}
    except Exception:
        pass
    return {}


def _ram() -> dict[str, Any]:
    try:
        import psutil  # type: ignore

        mem = psutil.virtual_memory()
        return {"used": int(mem.used / (1024 * 1024)), "total": int(mem.total / (1024 * 1024))}
    except Exception:
        return {}


def _disk() -> dict[str, Any]:
    root = os.environ.get("YUME_MODEL_DIR", "/tmp")
    try:
        usage = shutil.disk_usage(root if os.path.exists(root) else "/")
    except OSError:
        return {}
    return {"free": int(usage.free / (1024 * 1024)), "total": int(usage.total / (1024 * 1024))}
