import base64
import os
import struct

import pytest
from fastapi.testclient import TestClient

os.environ["YUME_MOCK"] = "1"
os.environ["YUME_API_KEY"] = "test-key"
os.environ["YUME_MODEL_DIR"] = "/tmp/yume-model-cache"

from yume_server.main import app  # noqa: E402


@pytest.fixture()
def client() -> TestClient:
    with TestClient(app) as test:
        yield test


def test_startup_answers_before_ready(client: TestClient) -> None:
    startup = client.get("/startup")
    assert startup.status_code == 200, startup.text
    body = startup.json()
    assert body["stage"] in {"idle", "ready", "downloading", "loading"}
    assert "bytesDone" in body and "bytesTotal" in body
    assert client.get("/health").json()["startup"]["stage"] == body["stage"]


def test_health_and_ready(client: TestClient) -> None:
    health = client.get("/health").json()
    assert health["status"] == "ok"
    assert health["model"] == "Animagine XL 4.0"
    assert "gpu" in health
    assert client.get("/ready").status_code == 200


def test_generate_requires_a_key(client: TestClient) -> None:
    response = client.post("/generate", json={"prompt": "a shrine in the rain"})
    assert response.status_code == 401


def test_generate_accepts_any_of_the_key_headers(client: TestClient) -> None:
    payload = {"prompt": "a shrine in the rain", "width": 512, "height": 512, "count": 1, "seed": 7}
    for headers in (
        {"Authorization": "Bearer test-key"},
        {"X-Api-Key": "test-key"},
        {"Salad-Api-Key": "test-key"},
    ):
        response = client.post("/generate", json=payload, headers=headers)
        assert response.status_code == 200, headers


def test_generate_returns_pngs_seed_scheduler_and_loras(client: TestClient) -> None:
    response = client.post(
        "/generate",
        headers={"Authorization": "Bearer test-key"},
        json={
            "prompt": "pink hair, twin tails, shrine",
            "negative_prompt": "blurry",
            "width": 832,
            "height": 1216,
            "count": 2,
            "seed": 42,
            "steps": 20,
            "cfg": 5.5,
            "scheduler": "dpm_2m_karras",
            "model": "cagliostrolab/animagine-xl-4.0",
            "loras": [{"name": "ribbon.safetensors", "weight": 0.6}],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["seeds"] == [42, 43]
    assert body["scheduler"] == "dpm_2m_karras"
    assert body["model"] == "cagliostrolab/animagine-xl-4.0"
    assert len(body["images"]) == 2
    raw = base64.b64decode(body["images"][0])
    assert raw.startswith(b"\x89PNG")
    width, height = struct.unpack(">II", raw[16:24])
    assert (width, height) == (832, 1216)


def test_generate_rejects_a_bad_size_and_unknown_scheduler(client: TestClient) -> None:
    headers = {"Authorization": "Bearer test-key"}
    size = client.post("/generate", headers=headers, json={"prompt": "x", "width": 100, "height": 100})
    assert size.status_code == 400
    scheduler = client.post("/generate", headers=headers, json={"prompt": "x", "scheduler": "nope"})
    assert scheduler.status_code == 400


def test_reference_image_is_img2img_in_mock_mode(client: TestClient) -> None:
    response = client.post(
        "/generate",
        headers={"Authorization": "Bearer test-key"},
        json={
            "prompt": "same character, side view",
            "width": 512,
            "height": 512,
            "count": 1,
            "seed": 3,
            "reference_image": "aW1hZ2U=",
            "strength": 0.45,
            "mode": "img2img",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["consistency"] == "img2img"
    assert body["seeds"] == [3]


def test_mesh_mock_returns_a_textured_glb(client: TestClient) -> None:
    denied = client.post("/mesh", json={"image": "aW1hZ2U="})
    assert denied.status_code == 401
    response = client.post(
        "/mesh",
        headers={"Authorization": "Bearer test-key"},
        json={"image": "aW1hZ2U=", "views": [{"angle": "side", "image": "aW1hZ2U="}]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "mock"
    assert body["multi_view"] is False
    assert body["ignored_views"] == 1
    raw = base64.b64decode(body["glb"])
    assert raw.startswith(b"glTF")
    assert b"image/png" in raw
    assert b"baseColorTexture" in raw
    from yume_mesh.main import app as mesh_app

    with TestClient(mesh_app) as mesh_client:
        standalone = mesh_client.post(
            "/mesh",
            headers={"Salad-Api-Key": "test-key"},
            json={"image": "aW1hZ2U="},
        )
        assert standalone.status_code == 200
        assert base64.b64decode(standalone.json()["glb"]).startswith(b"glTF")


def test_default_checkpoint_is_installed_and_metadata_is_written(client: TestClient) -> None:
    headers = {"Authorization": "Bearer test-key"}
    listed = client.get("/models", headers=headers)
    assert listed.status_code == 200, listed.text
    models = listed.json()["models"]
    default = next(item for item in models if item["versionId"] == 1337429)
    assert default["name"] == "Animagine XL 4.0"
    assert default["isDefault"] is True
    assert default["hash"] == "1d5b43ff75"
    installed = client.post("/models/install", headers=headers, json={"versionId": 42})
    assert installed.status_code == 200, installed.text
    job = installed.json()
    assert job["id"]
    for _ in range(30):
        progress = client.get(f"/models/install/{job['id']}", headers=headers)
        assert progress.status_code == 200, progress.text
        if progress.json()["state"] in {"done", "error"}:
            job = progress.json()
            break
    assert job["state"] == "done"
    chosen = client.post("/models/default", headers=headers, json={"versionId": 42})
    assert chosen.status_code == 200
    removed = client.delete("/models/42", headers=headers)
    assert removed.status_code == 200
    generated = client.post(
        "/generate",
        headers=headers,
        json={
            "prompt": "a shrine <lora:ribbon:0.8>",
            "negative_prompt": "lowres",
            "scheduler": "Euler a",
            "steps": 25,
            "cfg": 6,
            "seed": 7,
            "clip_skip": 2,
            "model": "Animagine XL 4.0",
            "model_hash": "1d5b43ff75",
            "loras": [{"name": "ribbon", "weight": 0.8}],
        },
    )
    assert generated.status_code == 200, generated.text
    raw = base64.b64decode(generated.json()["images"][0])
    assert b"parameters" in raw
    assert b"Euler a" in raw
    assert b"1d5b43ff75" in raw


def test_stats_diagnostics_and_jobs(client: TestClient) -> None:
    headers = {"Authorization": "Bearer test-key"}
    assert client.get("/stats").status_code == 401
    stats = client.get("/stats", headers=headers)
    assert stats.status_code == 200, stats.text
    body = stats.json()
    assert body["model"] == "Animagine XL 4.0"
    assert "gpu" in body and "diskFreeMb" in body
    assert body["powerWatts"] is None
    diag = client.get("/diagnostics", headers=headers)
    assert diag.status_code == 200
    names = [item["name"] for item in diag.json()["checks"]]
    assert "Default model" in names and "Disk" in names
    created = client.post(
        "/jobs",
        headers=headers,
        json={"prompt": "a quiet street", "width": 512, "height": 512, "steps": 1, "scheduler": "Euler a"},
    )
    assert created.status_code == 200, created.text
    job_id = created.json()["id"]
    status = client.get(f"/jobs/{job_id}", headers=headers)
    assert status.status_code == 200
    for _ in range(20):
        status = client.get(f"/jobs/{job_id}", headers=headers)
        if status.json()["status"] in {"done", "failed"}:
            break
    assert status.json()["status"] == "done"
    result = client.get(f"/jobs/{job_id}/result", headers=headers)
    assert result.status_code == 200
    assert result.json()["images"]
    held = client.post(
        "/jobs",
        headers=headers,
        json={"prompt": "pause me", "width": 512, "height": 512, "steps": 1},
    )
    paused = client.post(f"/jobs/{held.json()['id']}/pause", headers=headers)
    assert paused.json()["status"] in {"paused", "cancelled", "done"}


def test_default_checkpoint_comes_from_huggingface_and_civitai_needs_a_token(tmp_path, monkeypatch) -> None:
    from yume_server.catalog import CivitaiAuthError, DEFAULT_RECORD, HF_ANIMAGINE_URL, download_plan, ensure_default
    from yume_server.generate import diffusers_ignore_patterns

    url, headers = download_plan(DEFAULT_RECORD, None)
    assert url == HF_ANIMAGINE_URL
    assert "Authorization" not in headers
    ignored = diffusers_ignore_patterns()
    assert "animagine-xl-4.0.safetensors" in ignored
    assert "animagine-xl-4.0-opt.safetensors" in ignored
    monkeypatch.setenv("YUME_MODEL_DIR", str(tmp_path))
    monkeypatch.setenv("YUME_MOCK", "1")
    record = ensure_default()
    assert record["source"] == "diffusers"
    assert not (tmp_path / "animagine-xl-4.0.safetensors").exists()
    with pytest.raises(CivitaiAuthError, match="CIVITAI_TOKEN"):
        download_plan({"versionId": 42, "filename": "other.safetensors"}, None)
    _, authed = download_plan({"versionId": 42, "filename": "other.safetensors"}, "test-token")
    assert authed["Authorization"] == "Bearer test-token"


def test_app_generate_payload_is_not_a_server_error(client: TestClient) -> None:
    headers = {"Authorization": "Bearer test-key", "Salad-Api-Key": "test-key"}
    payload = {
        "prompt": "masterpiece, high score, great score, absurdres, 1girl",
        "negative_prompt": "lowres",
        "width": 832,
        "height": 1216,
        "count": 1,
        "seed": 1,
        "steps": 25,
        "cfg": 6,
        "scheduler": "Euler a",
        "model": "Animagine XL 4.0",
        "model_name": "Animagine XL 4.0",
        "model_hash": "1d5b43ff75",
        "clip_skip": 2,
        "loras": [],
        "embeddings": [],
        "vae": None,
        "hires_scale": None,
        "hires_denoise": 0.45,
        "hires_upscaler": "Latent",
        "hires_steps": 15,
        "mode": "txt2img",
        "strength": 0.55,
        "reference_image": None,
        "mask": None,
    }
    response = client.post("/generate", headers=headers, json=payload)
    assert response.status_code == 200, response.text
    missing = client.post("/generate", headers=headers, json={**payload, "loras": [{"name": "", "weight": 0.8}]})
    assert missing.status_code == 400
    assert "name" in missing.json()["detail"].lower()


def test_errors_hide_secrets_and_keep_a_client_report(client: TestClient, tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("YUME_MODEL_DIR", str(tmp_path))
    from yume_server.errors import list_errors, sanitize

    hidden = sanitize({"authorization": "salad_cloud_user_secret", "prompt": "token=abc salad_cloud_user_secret"})
    assert hidden["authorization"] == "[redacted]"
    assert "secret" not in hidden["prompt"]
    headers = {"Authorization": "Bearer test-key"}
    stored = client.post(
        "/client-report",
        headers=headers,
        json={"appVersion": "1.4.4", "versionCode": 9, "device": "android", "errors": [{"message": "HTTP 500"}], "request": {"endpoint": "/generate", "status": 500, "apiKey": "salad_cloud_user_secret"}},
    )
    assert stored.status_code == 200, stored.text
    listed = client.get("/errors", headers=headers)
    assert listed.status_code == 200
    blob = listed.text
    assert "salad_cloud_user_secret" not in blob
    assert any(item.get("source") == "client" for item in listed.json()["errors"])
    assert client.get("/errors").status_code == 401


def test_default_name_uses_the_loaded_pipeline(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("YUME_MODEL_DIR", str(tmp_path))
    monkeypatch.setenv("YUME_MOCK", "1")
    from yume_server.catalog import ensure_default, list_models
    from yume_server.generate import uses_loaded_pipeline

    ensure_default()
    models = list_models()
    assert uses_loaded_pipeline("Animagine XL 4.0", models)
    assert uses_loaded_pipeline("cagliostrolab/animagine-xl-4.0", models)
    assert not uses_loaded_pipeline("anime-2d-ill_v3.fp16.safetensors", models)


def test_unknown_checkpoint_is_rejected_outside_mock() -> None:
    from yume_server.generate import _allow_model

    with pytest.raises(ValueError, match="ALLOWLIST"):
        _allow_model("some/other-model")
