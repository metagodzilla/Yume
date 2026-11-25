import os

os.environ.setdefault("YUME_MOCK", "1")
os.environ.setdefault("YUME_API_KEY", "test-key")
os.environ.setdefault("YUME_MODEL_DIR", "/tmp/yume-model-cache")

from fastapi.testclient import TestClient  # noqa: E402

from yume_server.main import app  # noqa: E402
from yume_server.threed import install_marching_cubes_shim, minimal_glb  # noqa: E402


def test_minimal_glb_is_gltf() -> None:
    raw = minimal_glb()
    assert raw.startswith(b"glTF")


def test_picture_server_3d_job_returns_a_glb() -> None:
    headers = {"Salad-Api-Key": "test-key"}
    with TestClient(app) as client:
        denied = client.post("/3d/generate", json={"image": "aW1hZ2U="})
        assert denied.status_code == 401
        started = client.post("/3d/generate", headers=headers, json={"image": "aW1hZ2U=", "views": [{"angle": "side", "image": "aW1hZ2U="}]})
        assert started.status_code == 200, started.text
        job_id = started.json()["id"]
        status = client.get(f"/3d/jobs/{job_id}", headers=headers)
        assert status.status_code == 200
        assert status.json()["status"] == "done"
        missing = client.get("/3d/jobs/missing", headers=headers)
        assert missing.status_code == 404
        model = client.get(f"/3d/jobs/{job_id}/model.glb", headers=headers)
        assert model.status_code == 200
        assert model.content.startswith(b"glTF")


def test_marching_cubes_shim_registers_without_cuda() -> None:
    import sys

    sys.modules.pop("torchmcubes", None)
    try:
        import torch
        import skimage  # noqa: F401
    except Exception:
        return
    install_marching_cubes_shim()
    import torchmcubes

    volume = torch.zeros((4, 4, 4))
    volume[1:3, 1:3, 1:3] = 1
    verts, faces = torchmcubes.marching_cubes(volume, 0.5)
    assert verts.shape[-1] == 3
    assert faces.ndim == 2
