import threading
import time
from pathlib import Path

from yume_server.downloads import STALL_SECONDS, download_resumable
from yume_server.features import pip_command
from yume_server.runtime_guard import constraint_text, is_protected_package, quarantine_runtime_packages, runtime_problem
from yume_server.weights import assert_real_weight, controlnet_weight_name
from yume_server.catalog import DOWNLOAD_LIMIT


def test_constraints_pin_torch_numpy_and_cuda_only() -> None:
    text = constraint_text([
        ("torch", "2.5.1"),
        ("numpy", "1.26.4"),
        ("nvidia-cublas-cu12", "12.4.5.8"),
        ("einops", "0.8.0"),
    ])
    assert "torch==2.5.1" in text and "numpy==1.26.4" in text and "nvidia-cublas-cu12==12.4.5.8" in text
    assert "einops" not in text
    assert is_protected_package("cuda-toolkit")


def test_annotator_install_cannot_upgrade_torch() -> None:
    command = pip_command(Path("/data/features/pose"), ["controlnet_aux==0.0.9"], Path("/data/features/pose/runtime-constraints.txt"))
    assert "--no-deps" in command and "--constraint" in command
    assert "controlnet_aux==0.0.9" in command


def test_shadowed_torch_is_logged_and_moved_aside(tmp_path: Path) -> None:
    assert runtime_problem("2.15.0", "/data/features/pose/torch/__init__.py", "/usr/lib/numpy/__init__.py")
    assert runtime_problem("2.5.1+cu124", "/usr/local/lib/torch/__init__.py", "/usr/local/lib/numpy/__init__.py") is None
    (tmp_path / "torch").mkdir()
    (tmp_path / "torch" / "__init__.py").write_text("x", encoding="utf-8")
    (tmp_path / "controlnet_aux").mkdir()
    moved = quarantine_runtime_packages(tmp_path)
    assert moved == ["torch"]
    assert not (tmp_path / "torch").exists()
    assert (tmp_path / "torch.removed").is_dir()
    assert (tmp_path / "controlnet_aux").is_dir()


def test_tile_controlnet_is_the_safetensors_weights(tmp_path: Path) -> None:
    assert controlnet_weight_name("xinsir/controlnet-tile-sdxl-1.0") == "diffusion_pytorch_model.safetensors"
    assert controlnet_weight_name("TheMistoAI/MistoLine") == "diffusion_pytorch_model.fp16.safetensors"
    tiny = tmp_path / "diffusion_pytorch_model.safetensors"
    tiny.write_bytes(b"x" * 20)
    try:
        assert_real_weight(str(tiny))
    except RuntimeError as exc:
        assert "20 bytes" in str(exc)
    else:
        raise AssertionError("a 20 byte file was treated as ControlNet weights")


def test_a_stalled_download_resumes_with_range(tmp_path: Path, monkeypatch) -> None:
    import yume_server.downloads as downloads

    payload = b"abcdefghij"
    calls = {"n": 0}

    class Fake:
        def __init__(self, chunks: list[bytes], fail: bool = False):
            self.status = 206 if calls["n"] > 1 else 200
            self.headers = {"Content-Length": "10"} if calls["n"] == 1 else {"Content-Range": "bytes 5-9/10", "Content-Length": "5"}
            self._chunks = chunks
            self._i = 0
            self.fail = fail

        def read(self, _size: int) -> bytes:
            if self.fail and self._i >= 1:
                raise TimeoutError("stalled")
            if self._i >= len(self._chunks):
                return b""
            chunk = self._chunks[self._i]
            self._i += 1
            return chunk

        def __enter__(self) -> "Fake":
            return self

        def __exit__(self, *_args: object) -> bool:
            return False

    def fake_open(request, timeout=STALL_SECONDS):  # noqa: ANN001
        calls["n"] += 1
        assert timeout == 60
        header = {key.lower(): value for key, value in request.header_items()}
        if calls["n"] == 1:
            return Fake([b"abcde"], fail=True)
        assert header.get("range") == "bytes=5-"
        return Fake([b"fghij"])

    monkeypatch.setattr(downloads, "_urlopen", fake_open)
    monkeypatch.setattr(downloads, "_sleep", lambda _seconds: None)
    dest = tmp_path / "weight.safetensors"
    download_resumable("http://example.test/weight", str(dest), {"User-Agent": "yume"}, total_hint=10)
    assert dest.read_bytes() == payload


def test_only_two_downloads_run_at_once(tmp_path: Path, monkeypatch) -> None:
    assert DOWNLOAD_LIMIT == 2
    monkeypatch.setenv("YUME_MODEL_DIR", str(tmp_path))
    monkeypatch.setenv("YUME_LORA_DIR", str(tmp_path / "loras"))
    monkeypatch.setenv("YUME_MOCK", "1")
    from yume_server import catalog

    catalog._LOADED_DIR = None
    state = {"n": 0, "max": 0}
    lock = threading.Lock()
    original = catalog._materialize

    def slow(*args, **kwargs):  # noqa: ANN002, ANN003
        with lock:
            state["n"] += 1
            state["max"] = max(state["max"], state["n"])
        time.sleep(0.15)
        with lock:
            state["n"] -= 1
        return original(*args, **kwargs)

    monkeypatch.setattr(catalog, "_materialize", slow)
    ids = [catalog.start_install(400 + index, None, {"type": "LORA", "name": f"L{index}", "filename": f"l{index}.safetensors"})["id"] for index in range(4)]
    pending = set(ids)
    deadline = time.time() + 5
    while pending and time.time() < deadline:
        pending = {job_id for job_id in pending if catalog.install_progress(job_id)["state"] not in {"done", "error"}}
        time.sleep(0.02)
    assert not pending
    assert state["max"] == 2
