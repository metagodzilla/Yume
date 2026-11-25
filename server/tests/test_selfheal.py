import json
import logging
import os
import urllib.error

os.environ.setdefault("YUME_MOCK", "1")
os.environ.setdefault("YUME_API_KEY", "test-key")
os.environ.setdefault("YUME_MODEL_DIR", "/tmp/yume-model-cache")

from fastapi.testclient import TestClient  # noqa: E402

from yume_server.main import app  # noqa: E402
from yume_server.selfheal import (  # noqa: E402
    SELF_HEAL_MESSAGE,
    Watch,
    identity_from,
    is_network_failure,
    reallocate_url,
    retry_startup,
)
from yume_server import selfheal  # noqa: E402
from yume_server.startup import mark  # noqa: E402


def test_urlerror_101_is_a_network_failure() -> None:
    exc = urllib.error.URLError(OSError(101, "Network is unreachable"))
    assert is_network_failure(exc)
    assert not is_network_failure(RuntimeError("Civitai needs your API key"))


def test_identity_falls_back_to_the_live_group() -> None:
    who = identity_from({}, None)
    assert who == {"org": "seeyeevang707", "project": "default", "group": "yume-server", "instance": ""}
    merged = identity_from({"SALAD_MACHINE_ID": "machine-9"}, {"salad_organization_name": "org"})
    assert merged["org"] == "org" and merged["instance"] == "machine-9"
    assert reallocate_url("seeyeevang707", "default", "yume-server", "machine-9").endswith("/instances/machine-9/reallocate")


def test_self_heal_waits_then_reallocates_once(tmp_path) -> None:
    clock = {"t": 0.0}
    calls: list[str] = []
    watch = Watch(
        now=lambda: clock["t"],
        after=300,
        reallocate=lambda: calls.append("go") or True,
        exit_process=lambda code: calls.append(f"exit{code}"),
        stamp_path=str(tmp_path / "stamp"),
    )
    assert watch.note_failure(OSError(101, "Network is unreachable")) == "retry"
    clock["t"] = 299
    assert watch.note_failure(OSError(101, "Network is unreachable")) == "retry"
    clock["t"] = 300
    assert watch.note_failure(OSError(101, "Network is unreachable")) == "reallocate"
    assert calls == ["go"]
    clock["t"] = 301
    assert watch.note_failure(OSError(101, "Network is unreachable")) == "cooldown"
    assert calls == ["go"]
    clock["t"] = 300 + 20 * 60
    assert watch.note_failure(OSError(101, "Network is unreachable")) == "reallocate"
    assert calls == ["go", "go"]


def test_failed_reallocate_exits_and_a_stamp_blocks_a_restart(tmp_path) -> None:
    clock = {"t": 500.0}
    calls: list[int] = []
    stamp = tmp_path / "stamp"
    watch = Watch(now=lambda: clock["t"], after=300, reallocate=lambda: False, exit_process=calls.append, stamp_path=str(stamp))
    watch._first = 0.0
    assert watch.note_failure(OSError(101, "Network is unreachable")) == "exit"
    assert calls == [1]
    restarted = Watch(now=lambda: clock["t"], after=300, reallocate=lambda: True, exit_process=calls.append, stamp_path=str(stamp))
    restarted._first = 0.0
    assert restarted.note_failure(OSError(101, "Network is unreachable")) == "cooldown"


def test_reallocate_log_does_not_include_the_key(monkeypatch, caplog) -> None:
    monkeypatch.setenv("YUME_API_KEY", "salad-secret-value")
    monkeypatch.setenv("SALAD_MACHINE_ID", "machine-1")

    class Response:
        status = 202

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    def opener(request, timeout=0):
        assert request.get_header("Salad-api-key") == "salad-secret-value"
        assert "salad-secret-value" not in request.full_url
        return Response()

    monkeypatch.setattr(selfheal.urllib.request, "urlopen", opener)
    monkeypatch.setattr(selfheal, "read_imds", lambda get=None: {})
    with caplog.at_level(logging.WARNING):
        assert selfheal._reallocate_live() is True
    assert "salad-secret-value" not in caplog.text
    assert "machine-1" in caplog.text


def test_startup_retries_then_succeeds() -> None:
    original = selfheal._WATCH
    selfheal._WATCH = Watch(now=lambda: 0.0, after=300, reallocate=lambda: True, exit_process=lambda _code: None)
    tries = {"n": 0}

    def load() -> None:
        tries["n"] += 1
        if tries["n"] < 3:
            raise OSError(101, "Network is unreachable")

    try:
        retry_startup(load, probe=lambda: True, sleep=lambda _seconds: None)
    finally:
        selfheal._WATCH = original
        mark("ready", "Ready", done=1, total=1)
    assert tries["n"] == 3


def test_ready_reports_the_error_then_health_fails(tmp_path) -> None:
    original = selfheal._WATCH
    clock = {"t": 0.0}
    calls: list[str] = []
    watch = Watch(
        now=lambda: clock["t"],
        after=300,
        reallocate=lambda: calls.append("go") or True,
        exit_process=lambda code: calls.append(f"exit{code}"),
        stamp_path=str(tmp_path / "stamp"),
    )
    selfheal._WATCH = watch
    try:
        with TestClient(app) as client:
            assert selfheal.record_network_error(OSError(101, "Network is unreachable")) == "retry"
            early = client.get("/ready")
            assert early.status_code == 503
            assert "unreachable" in early.json()["detail"].lower()
            clock["t"] = 300
            assert selfheal.record_network_error(OSError(101, "Network is unreachable")) == "reallocate"
            assert calls == ["go"]
            ready = client.get("/ready")
            startup = client.get("/startup")
            health = client.get("/health")
        assert ready.status_code == 503
        assert ready.json()["detail"] == SELF_HEAL_MESSAGE
        assert startup.json()["message"] == SELF_HEAL_MESSAGE
        assert "unreachable" in startup.json()["error"].lower()
        assert health.status_code == 503
        assert health.json()["detail"] == SELF_HEAL_MESSAGE
    finally:
        selfheal._WATCH = original
        original.reset()
        mark("ready", "Ready", done=1, total=1)
