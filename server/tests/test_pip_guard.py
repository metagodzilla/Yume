from yume_server.pip_guard import looks_like_stray_install
from yume_server.runtime_guard import is_protected_package
from yume_server.startup import ready_detail


def test_a_leftover_feature_pip_is_stray_and_peft_is_not() -> None:
    stray = "/usr/bin/python -m pip install --target /data/features/pose controlnet_aux==0.0.9"
    assert looks_like_stray_install(stray)
    assert looks_like_stray_install("pip install nvidia_cudnn_cu13 torch")
    assert not looks_like_stray_install("/usr/bin/python -m pip install --no-deps peft==0.14.0")
    assert not looks_like_stray_install("uvicorn yume_server.main:app")


def test_ready_says_which_stage_is_blocking() -> None:
    reason = ready_detail(ready=False, error=None, progress={"stage": "downloading", "message": "Downloading the fixed VAE", "bytesDone": 8, "bytesTotal": 20})
    assert reason is not None
    assert "Downloading the fixed VAE" in reason
    assert "stage downloading" in reason
    assert "8/20 bytes" in reason
    assert ready_detail(ready=True, error=None, progress={"stage": "ready", "message": "Ready"}) is None
    assert ready_detail(ready=True, error="CUDA out of memory", progress={"stage": "ready", "message": "Ready"}) == "CUDA out of memory"
    assert is_protected_package("triton") and is_protected_package("nvidia_cudnn_cu13")
