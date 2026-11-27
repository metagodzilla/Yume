"""Stop a pip left behind by the previous server process.

A reload exits the app and reparents its children to the supervisor. Those
children keep writing torch and CUDA into the feature folder after the boot
cleanup has already run. Each boot, and every few seconds after that, kills
those installs and quarantines the packages they dropped.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

_LOG = logging.getLogger("yume.pip")
_OURS: set[int] = set()
_LOCK = threading.Lock()
_SWEEPER = False


def looks_like_stray_install(command: str) -> bool:
    text = (command or "").lower().replace("\x00", " ")
    if "pip" not in text or "install" not in text:
        return False
    markers = ("/data/features", "controlnet_aux", "controlnet-aux", "nvidia", "torch", "triton")
    return any(marker in text for marker in markers)


def _cmdline(pid: int) -> str:
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
    except OSError:
        return ""
    return raw.replace(b"\x00", b" ").decode("utf-8", "replace")


def _alive(pid: int) -> bool:
    if pid <= 1:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _record_path() -> Path:
    from yume_server.features import feature_root

    return feature_root() / "pip-pids.json"


def _read_recorded() -> list[int]:
    try:
        data = json.loads(_record_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    pids = []
    for item in data:
        try:
            pids.append(int(item))
        except (TypeError, ValueError):
            continue
    return pids


def _write_recorded(pids: list[int]) -> None:
    path = _record_path()
    path.write_text(json.dumps(sorted(set(pids))), encoding="utf-8")


def _remember(pid: int) -> None:
    pids = [item for item in _read_recorded() if _alive(item)]
    pids.append(pid)
    _write_recorded(pids)


def _forget(pid: int) -> None:
    _write_recorded([item for item in _read_recorded() if item != pid and _alive(item)])


def kill_pid(pid: int) -> bool:
    """Kill one install. Never signal this server's own process group."""
    if pid <= 1 or pid == os.getpid() or pid in _OURS:
        return False
    if not _alive(pid):
        return False
    try:
        pgid = os.getpgid(pid)
    except ProcessLookupError:
        return False
    if pgid == os.getpgrp():
        os.kill(pid, signal.SIGKILL)
        return True
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return False
    time.sleep(0.2)
    if _alive(pid):
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    _LOG.error("killed stray install pid=%s pgid=%s cmd=%s", pid, pgid, _cmdline(pid)[:240])
    return True


def stray_pids() -> list[int]:
    found: set[int] = set()
    for pid in _read_recorded():
        if pid not in _OURS and _alive(pid):
            found.add(pid)
    proc = Path("/proc")
    if proc.is_dir():
        for entry in proc.iterdir():
            if not entry.name.isdigit():
                continue
            pid = int(entry.name)
            if pid in _OURS or pid == os.getpid() or pid <= 1:
                continue
            if looks_like_stray_install(_cmdline(pid)):
                found.add(pid)
    return sorted(found)


def reap_stray_installs() -> list[int]:
    killed = [pid for pid in stray_pids() if kill_pid(pid)]
    if killed:
        _LOG.error("stray pip installs killed: %s", killed)
    return killed


def run_install(command: list[str], timeout: int = 600) -> int:
    """Run pip in its own process group and remember the pid across a reload."""
    proc = subprocess.Popen(command, start_new_session=True)
    with _LOCK:
        _OURS.add(proc.pid)
    _remember(proc.pid)
    _LOG.info("pip pid=%s pgid=%s", proc.pid, proc.pid)
    try:
        return proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        kill_pid(proc.pid)
        raise
    finally:
        with _LOCK:
            _OURS.discard(proc.pid)
        _forget(proc.pid)


def sweep_feature_installs() -> dict[str, Any]:
    """Kill leftover pip processes, then move torch, numpy, CUDA, and triton aside."""
    from yume_server.features import feature_root
    from yume_server.runtime_guard import quarantine_runtime_packages

    killed = reap_stray_installs()
    moved: list[str] = []
    root = feature_root()
    if root.is_dir():
        for child in list(root.iterdir()):
            if child.is_dir() and not child.name.endswith(".removed"):
                moved.extend(quarantine_runtime_packages(child))
    if killed or moved:
        _LOG.error("feature sweep killed=%s quarantined=%s", killed, moved)
    return {"killed": killed, "quarantined": moved}


def start_sweeper(interval: float = 15.0) -> None:
    global _SWEEPER
    with _LOCK:
        if _SWEEPER:
            return
        _SWEEPER = True

    def loop() -> None:
        while True:
            time.sleep(interval)
            try:
                sweep_feature_installs()
            except Exception:
                _LOG.exception("feature sweep failed")

    threading.Thread(target=loop, name="yume-feature-sweep", daemon=True).start()
