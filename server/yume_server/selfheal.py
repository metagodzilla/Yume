"""Move this Salad instance when the node has no outbound network.

A dead node used to fail one download, leave /ready at 503, and sit there.
Startup now retries. If the network stays unreachable for YUME_SELFHEAL_AFTER_S
seconds (default 300), this process asks Salad to reallocate itself.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import ssl
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Callable

_LOG = logging.getLogger("yume.selfheal")

SELF_HEAL_MESSAGE = "Cloud has no internet - moving to a new machine"
COOLDOWN_S = 20 * 60
PROBE_HOSTS = ("civitai.com", "huggingface.co", "github.com")
FALLBACK_ORG = "seeyeevang707"
FALLBACK_PROJECT = "default"
FALLBACK_GROUP = "yume-server"

Now = Callable[[], float]
Sleep = Callable[[float], None]
Poster = Callable[[str, str], int]


def after_seconds() -> float:
    raw = os.environ.get("YUME_SELFHEAL_AFTER_S", "").strip()
    if not raw:
        return 300.0
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 300.0


def is_network_failure(exc: BaseException) -> bool:
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, OSError) and current.errno in {101, 113, 51}:
            return True
        reason = getattr(current, "reason", None)
        if isinstance(reason, OSError) and reason.errno in {101, 113, 51}:
            return True
        text = str(current).lower()
        if "network is unreachable" in text or "errno 101" in text or "[errno 101]" in text:
            return True
        if "no route to host" in text or "network unreachable" in text:
            return True
        current = current.__cause__ or current.__context__
    return False


def reallocate_url(org: str, project: str, group: str, instance: str) -> str:
    return (
        "https://api.salad.com/api/public/organizations/"
        f"{org}/projects/{project}/containers/{group}/instances/{instance}/reallocate"
    )


def identity_from(env: dict[str, str], meta: dict[str, Any] | None) -> dict[str, str]:
    meta = meta or {}
    org = str(meta.get("salad_organization_name") or env.get("SALAD_ORGANIZATION_NAME") or FALLBACK_ORG)
    project = str(meta.get("salad_project_name") or env.get("SALAD_PROJECT_NAME") or FALLBACK_PROJECT)
    group = str(meta.get("salad_container_group_name") or env.get("SALAD_CONTAINER_GROUP_NAME") or FALLBACK_GROUP)
    instance = str(meta.get("salad_machine_id") or env.get("SALAD_MACHINE_ID") or "")
    return {"org": org, "project": project, "group": group, "instance": instance}


def read_imds(get: Callable[[str], bytes] | None = None) -> dict[str, Any]:
    """Salad IMDS is http://169.254.169.254/v1/meta with header Metadata: true."""

    def _default(path: str) -> bytes:
        request = urllib.request.Request(f"http://169.254.169.254/v1/{path}", headers={"Metadata": "true"})
        with urllib.request.urlopen(request, timeout=2) as response:
            return response.read()

    fetch = get or _default
    try:
        raw = fetch("meta")
    except Exception:
        return {}
    try:
        loaded = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def probe_host(host: str, family: socket.AddressFamily, timeout: float = 3.0) -> bool:
    try:
        infos = socket.getaddrinfo(host, 443, family, socket.SOCK_STREAM)
    except OSError:
        return False
    if not infos:
        return False
    address = infos[0][4]
    sock = socket.socket(family, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect(address)
        tls = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
        try:
            tls.sendall(f"HEAD / HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n".encode())
            data = tls.recv(32)
        finally:
            tls.close()
        return data.startswith(b"HTTP/")
    except OSError:
        return False
    finally:
        sock.close()


def network_reachable(probe: Callable[[], bool] | None = None) -> bool:
    if probe is not None:
        return probe()
    for host in PROBE_HOSTS:
        for family in (socket.AF_INET, socket.AF_INET6):
            if probe_host(host, family):
                return True
    return False


class Watch:
    def __init__(
        self,
        *,
        now: Now | None = None,
        sleep: Sleep | None = None,
        reallocate: Callable[[], bool] | None = None,
        exit_process: Callable[[int], None] | None = None,
        after: float | None = None,
        cooldown: float = COOLDOWN_S,
        stamp_path: str | None = None,
    ) -> None:
        self._now = now or time.time
        self._sleep = sleep or time.sleep
        self._reallocate = reallocate or _reallocate_live
        self._exit = exit_process or os_exit
        self._after = after_seconds if after is None else (lambda: after)
        self._cooldown = cooldown
        self._stamp = stamp_path
        self._lock = threading.Lock()
        self._first: float | None = None
        self._last_local: float | None = None
        self._error = ""
        self._health_fail = False
        self._relocating = False
        self._ready = False

    def mark_ready(self) -> None:
        with self._lock:
            self._ready = True
            self._first = None
            self._health_fail = False
            self._error = ""

    @property
    def startup(self) -> bool:
        with self._lock:
            return not self._ready

    def note_ok(self) -> None:
        with self._lock:
            self._first = None
            if not self._relocating:
                self._health_fail = False
                self._error = ""

    def note_failure(self, exc: BaseException, *, startup_probe: bool = False) -> str:
        if not is_network_failure(exc):
            return "ignore"
        if startup_probe and not self.startup:
            return "ignore"
        message = str(exc).strip() or "Network is unreachable"
        now = self._now()
        with self._lock:
            if self._first is None:
                self._first = now
            self._error = message
            elapsed = now - self._first
            if elapsed < self._after():
                return "retry"
            self._health_fail = True
            self._relocating = True
            if (self._last_local is not None and now - self._last_local < self._cooldown) or self._recent(now):
                return "cooldown"
            self._last_local = now
        self._write_stamp(now)
        _LOG.warning("yume self-heal: outbound network unreachable for %.0fs; reallocating this machine", elapsed)
        try:
            moved = self._reallocate()
        except Exception:
            _LOG.warning("yume self-heal: reallocate call failed; exiting so the container restarts")
            self._exit(1)
            return "exit"
        if not moved:
            _LOG.warning("yume self-heal: Salad did not accept reallocate; exiting so the container restarts")
            self._exit(1)
            return "exit"
        _LOG.warning("yume self-heal: Salad accepted reallocate")
        return "reallocate"

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "network": "unreachable" if self._first is not None or self._health_fail else "ok",
                "selfHeal": "reallocate" if self._relocating else "",
                "error": self._error,
                "healthFail": self._health_fail,
                "message": SELF_HEAL_MESSAGE if self._health_fail else self._error,
            }

    def reset(self) -> None:
        with self._lock:
            self._first = None
            self._last_local = None
            self._error = ""
            self._health_fail = False
            self._relocating = False
            self._ready = False
        if self._stamp and os.path.exists(self._stamp):
            try:
                os.remove(self._stamp)
            except OSError:
                pass

    def _recent(self, now: float) -> bool:
        if not self._stamp or not os.path.exists(self._stamp):
            return False
        try:
            data = json.loads(open(self._stamp, encoding="utf-8").read())
            return now - float(data.get("last") or 0) < self._cooldown
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            return False

    def _write_stamp(self, now: float) -> None:
        if not self._stamp:
            return
        try:
            os.makedirs(os.path.dirname(self._stamp) or ".", exist_ok=True)
            with open(self._stamp, "w", encoding="utf-8") as handle:
                json.dump({"last": now}, handle)
        except OSError:
            _LOG.warning("yume self-heal: could not remember the last reallocate")


def os_exit(code: int) -> None:
    os._exit(code)


def _reallocate_live() -> bool:
    meta = read_imds()
    who = identity_from(dict(os.environ), meta)
    key = os.environ.get("YUME_API_KEY", "").strip()
    if not who["instance"] or not key:
        _LOG.warning("yume self-heal: missing instance id or API key, cannot reallocate")
        return False
    url = reallocate_url(who["org"], who["project"], who["group"], who["instance"])
    _LOG.warning("yume self-heal: POST reallocate org=%s project=%s group=%s instance=%s", who["org"], who["project"], who["group"], who["instance"])
    request = urllib.request.Request(
        url,
        data=b"{}",
        method="POST",
        headers={"Salad-Api-Key": key, "Content-Type": "application/json", "User-Agent": "yume-selfheal"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return 200 <= int(response.status) < 300
    except urllib.error.HTTPError as exc:
        _LOG.warning("yume self-heal: reallocate HTTP %s", exc.code)
        return False


_WATCH = Watch()
_THREAD: threading.Thread | None = None
_STOP = threading.Event()


def current() -> Watch:
    return _WATCH


def record_network_error(exc: BaseException, *, startup_probe: bool = False) -> str:
    action = _WATCH.note_failure(exc, startup_probe=startup_probe)
    if action in {"retry", "reallocate", "exit", "cooldown"}:
        from yume_server.startup import mark

        status = _WATCH.status()
        if status["healthFail"]:
            mark("relocating", SELF_HEAL_MESSAGE)
        elif status["error"]:
            mark("error", status["error"])
    return action


def note_recovered() -> None:
    _WATCH.note_ok()


def health_failed() -> bool:
    return bool(_WATCH.status()["healthFail"])


def public_status() -> dict[str, Any]:
    return _WATCH.status()


def retry_startup(action: Callable[[], None], *, max_attempts: int | None = None, sleep: Sleep | None = None, probe: Callable[[], bool] | None = None) -> None:
    """Keep trying to load the model. Network failures arm the self-heal clock."""
    pause = sleep or time.sleep
    attempt = 0
    while True:
        try:
            if probe is not None:
                if not probe():
                    raise OSError(101, "Network is unreachable")
            elif _WATCH.startup and not network_reachable():
                raise OSError(101, "Network is unreachable")
            action()
            note_recovered()
            _WATCH.mark_ready()
            return
        except Exception as exc:
            from yume_server.startup import mark

            _LOG.exception("model startup failed")
            mark("error", str(exc).strip() or "model startup failed")
            if is_network_failure(exc):
                record_network_error(exc)
            attempt += 1
            if max_attempts is not None and attempt >= max_attempts:
                raise
            pause(min(30.0, float(2 ** min(attempt, 5))))


def _probe_loop() -> None:
    while not _STOP.wait(20):
        if not _WATCH.startup:
            return
        try:
            if network_reachable():
                note_recovered()
            else:
                record_network_error(OSError(101, "Network is unreachable"), startup_probe=True)
        except Exception:
            _LOG.exception("network self-check failed")


def start_watch() -> None:
    global _THREAD
    if _THREAD and _THREAD.is_alive():
        return
    _STOP.clear()
    _THREAD = threading.Thread(target=_probe_loop, name="yume-selfheal", daemon=True)
    _THREAD.start()


def stop_watch() -> None:
    _STOP.set()
