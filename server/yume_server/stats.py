"""Host stats for /stats and /diagnostics. Mock mode never invents a real GPU."""

from __future__ import annotations

import os
import shutil
import time
from typing import Any

STARTED = time.time()


def _loaded_name() -> str:
    try:
        from yume_server.generate import loaded_model_name

        return loaded_model_name()
    except Exception:
        return "Animagine XL 4.0"


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
        "model": _loaded_name(),
        "modelLoaded": os.environ.get("YUME_READY", "1") != "0",
        "source": gpu.get("source") or ("mock" if mock else "host"),
        "powerWatts": gpu.get("power"),
        "powerLimitWatts": gpu.get("powerLimit"),
    }


def _gpu() -> dict[str, Any]:
    try:
        import pynvml  # type: ignore

        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        name = pynvml.nvmlDeviceGetName(handle)
        mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
        util = pynvml.nvmlDeviceGetUtilizationRates(handle)
        power = _nvml_watts(lambda: pynvml.nvmlDeviceGetPowerUsage(handle))
        limit = _nvml_watts(lambda: pynvml.nvmlDeviceGetPowerManagementLimit(handle))
        return {
            "name": name.decode() if isinstance(name, bytes) else str(name),
            "used": int(mem.used / (1024 * 1024)),
            "total": int(mem.total / (1024 * 1024)),
            "util": int(util.gpu),
            "power": power,
            "powerLimit": limit,
            "source": "pynvml",
        }
    except Exception:
        pass
    try:
        import subprocess

        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu,power.draw,power.limit", "--format=csv,noheader,nounits"],
            text=True,
            timeout=3,
        ).strip().splitlines()
        if out:
            parts = [part.strip() for part in out[0].split(",")]
            name, used, total, util = parts[:4]
            power = _smi_float(parts[4]) if len(parts) > 4 else None
            limit = _smi_float(parts[5]) if len(parts) > 5 else None
            return {
                "name": name,
                "used": int(float(used)),
                "total": int(float(total)),
                "util": int(float(util)),
                "power": power,
                "powerLimit": limit,
                "source": "nvidia-smi",
            }
    except Exception:
        pass
    return {}


def _nvml_watts(read: Any) -> float | None:
    try:
        return round(float(read()) / 1000.0, 1)
    except Exception:
        return None


def _smi_float(value: str) -> float | None:
    try:
        if not value or value.upper() == "N/A":
            return None
        return float(value)
    except ValueError:
        return None


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
