"""Make LoRA loading work when the runtime image forgot the peft package.

The pinned build installs peft==0.14.0 next to diffusers 0.32.2 and transformers 4.48.1.
A hot-updated process can install that same pin with pip --no-deps so torch and diffusers stay put.
Checkpoint restore never calls this.
"""

from __future__ import annotations

import importlib
import logging
import subprocess
import sys
import threading

from yume_server.generate import mock_mode

PEFT_SPEC = "peft==0.14.0"
MISSING = (
    "This server cannot apply a LoRA because the peft package is missing and could not be installed. "
    "Draw again without the LoRA, or switch to a runtime image that includes peft."
)

_LOG = logging.getLogger("yume.peft")
_LOCK = threading.Lock()


def _can_import() -> bool:
    try:
        import peft  # noqa: F401
    except ImportError:
        return False
    return True


def _pip_install() -> bool:
    _LOG.info("installing %s without upgrading torch or diffusers", PEFT_SPEC)
    try:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--no-cache-dir",
                "--no-deps",
                PEFT_SPEC,
            ],
            check=True,
            timeout=180,
        )
    except (OSError, subprocess.SubprocessError):
        _LOG.exception("peft install failed")
        return False
    importlib.invalidate_caches()
    return _can_import()


def ensure_peft() -> bool:
    if _can_import():
        return True
    if mock_mode():
        return False
    with _LOCK:
        if _can_import():
            return True
        return _pip_install()
