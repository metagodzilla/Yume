import os

os.environ.setdefault("YUME_MOCK", "1")
os.environ.setdefault("YUME_API_KEY", "test-key")
os.environ.setdefault("YUME_MODEL_DIR", "/tmp/yume-model-cache")

from yume_server.peft_setup import MISSING, PEFT_SPEC, ensure_peft  # noqa: E402


def test_mock_mode_does_not_pip_install_peft(monkeypatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr("yume_server.peft_setup._can_import", lambda: False)
    monkeypatch.setattr("yume_server.peft_setup._pip_install", lambda: calls.append("pip") or True)
    assert ensure_peft() is False
    assert calls == []
    assert "peft" in MISSING and PEFT_SPEC == "peft==0.14.0"
