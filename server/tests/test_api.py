import base64
import os
import struct
import time

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


def finish_generate(client: TestClient, response, headers: dict[str, str]):
    assert response.status_code == 200, response.text
    body = response.json()
    if "images" in body:
        return body
    job_id = body["id"]
    status = {}
    for _ in range(40):
        status = client.get(f"/jobs/{job_id}", headers=headers).json()
        if status["status"] in {"done", "failed"}:
            break
        time.sleep(0.02)
    assert status["status"] == "done", status
    return client.get(f"/jobs/{job_id}/result", headers=headers).json()


def test_use_switches_the_loaded_checkpoint_by_id(client: TestClient) -> None:
    headers = {"Authorization": "Bearer test-key"}
    installed = client.post("/models/install", headers=headers, json={"versionId": 77})
    assert installed.status_code == 200, installed.text
    job = installed.json()
    for _ in range(30):
        progress = client.get(f"/models/install/{job['id']}", headers=headers).json()
        if progress["state"] in {"done", "error"}:
            job = progress
            break
    assert job["state"] == "done"
    current = client.post(
        "/generate",
        headers=headers,
        json={"prompt": "a shrine", "model": "1337429", "width": 512, "height": 512, "steps": 1, "scheduler": "euler_a"},
    )
    current_body = finish_generate(client, current, headers)
    assert current_body["model"] == "Animagine XL 4.0"
    early = client.post(
        "/generate",
        headers=headers,
        json={"prompt": "a shrine", "model": "77", "width": 512, "height": 512, "steps": 1, "scheduler": "euler_a"},
    )
    early_body = finish_generate(client, early, headers)
    assert early_body["model"] == "Civitai 77" and early_body["switched"] is True
    use = client.post("/models/use", headers=headers, json={"versionId": 77})
    assert use.status_code == 200, use.text
    loaded = use.json()
    for _ in range(30):
        if loaded["state"] in {"done", "error"}:
            break
        loaded = client.get(f"/models/use/{loaded['id']}", headers=headers).json()
    assert loaded["state"] == "done"
    listed = client.get("/models", headers=headers).json()
    assert listed["activeVersionId"] == 77
    switched = client.post(
        "/generate",
        headers=headers,
        json={"prompt": "a shrine", "model": "77", "width": 512, "height": 512, "steps": 1, "scheduler": "euler_a"},
    )
    switched_body = finish_generate(client, switched, headers)
    assert switched_body["model"] == "Civitai 77"
    missing = client.post(
        "/generate",
        headers=headers,
        json={"prompt": "a shrine", "model": "999999", "width": 512, "height": 512, "steps": 1, "scheduler": "euler_a"},
    )
    assert missing.status_code == 200, missing.text
    missing_id = missing.json()["id"]
    missing_status = {}
    for _ in range(40):
        missing_status = client.get(f"/jobs/{missing_id}", headers=headers).json()
        if missing_status["status"] in {"done", "failed"}:
            break
        time.sleep(0.02)
    assert missing_status["status"] == "failed"
    assert "not installed" in missing_status["error"].lower()
    removed = client.delete("/models/77", headers=headers)
    assert removed.status_code == 200, removed.text
    fallback = removed.json().get("job")
    if fallback:
        for _ in range(30):
            if fallback["state"] in {"done", "error"}:
                break
            fallback = client.get(f"/models/use/{fallback['id']}", headers=headers).json()
        assert fallback["state"] == "done"
    restored = client.post(
        "/generate",
        headers=headers,
        json={"prompt": "a shrine", "model": "1337429", "width": 512, "height": 512, "steps": 1, "scheduler": "euler_a"},
    )
    assert restored.status_code == 200, restored.text


def test_download_resumes_with_range_and_checks_the_hash(tmp_path, monkeypatch) -> None:
    import hashlib

    from yume_server import downloads

    payload = b"abcdefghij"
    digest = hashlib.sha256(payload).hexdigest()
    calls = {"n": 0}

    class Fake:
        def __init__(self, status: int, headers: dict[str, str], chunks: list[bytes], fail: bool = False):
            self.status = status
            self.headers = headers
            self._chunks = chunks
            self._i = 0
            self.fail = fail

        def read(self, _size: int) -> bytes:
            if self.fail and self._i >= 1:
                raise ConnectionResetError("reset")
            if self._i >= len(self._chunks):
                return b""
            chunk = self._chunks[self._i]
            self._i += 1
            return chunk

        def __enter__(self) -> "Fake":
            return self

        def __exit__(self, *_args: object) -> bool:
            return False

    def fake_open(request, timeout=120):  # noqa: ANN001
        calls["n"] += 1
        header = {key.lower(): value for key, value in request.header_items()}
        if calls["n"] == 1:
            return Fake(200, {"Content-Length": "10"}, [b"abcde"], fail=True)
        assert header.get("Range") == "bytes=5-" or header.get("range") == "bytes=5-"
        return Fake(206, {"Content-Range": "bytes 5-9/10", "Content-Length": "5"}, [b"fghij"])

    monkeypatch.setattr(downloads, "_urlopen", fake_open)
    monkeypatch.setattr(downloads, "_sleep", lambda _seconds: None)
    monkeypatch.setenv("YUME_LORA_DIR", str(tmp_path / "loras"))
    monkeypatch.setenv("YUME_EMBEDDING_DIR", str(tmp_path / "embeddings"))
    dest = tmp_path / "weight.safetensors"
    downloads.download_resumable("http://example.test/weight", str(dest), {"User-Agent": "yume"}, expected_sha256=digest, total_hint=10)
    assert dest.read_bytes() == payload
    assert not dest.with_name("weight.safetensors.part").exists()
    assert downloads.resource_root({"type": "LORA"}) != downloads.resource_root({"type": "TextualInversion"})


def test_install_jobs_persist_across_restarts(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("YUME_MODEL_DIR", str(tmp_path))
    monkeypatch.setenv("YUME_LORA_DIR", str(tmp_path / "loras"))
    monkeypatch.setenv("YUME_MOCK", "1")
    from yume_server import catalog

    catalog._LOADED_DIR = None
    catalog._INSTALLS.clear()
    started = catalog.start_install(91, None, {"type": "LORA", "name": "Ribbon", "filename": "ribbon.safetensors"})
    view = started
    for _ in range(40):
        view = catalog.install_progress(started["id"])
        if view["state"] in {"done", "error"}:
            break
        time.sleep(0.02)
    assert view["state"] == "done"
    assert view["type"] == "LORA"
    assert (tmp_path / "loras" / "ribbon.safetensors").exists()
    catalog._LOADED_DIR = None
    catalog._INSTALLS.clear()
    catalog.ensure_jobs_loaded()
    again = catalog.install_progress(started["id"])
    assert again["state"] == "done" and again["name"] == "Ribbon"
    with pytest.raises(ValueError):
        catalog.pause_install(started["id"])
    partial = tmp_path / "half.safetensors.part"
    partial.write_bytes(b"12345")
    catalog._INSTALLS["half"] = {
        "id": "half",
        "versionId": 92,
        "state": "downloading",
        "bytesDone": 1,
        "bytesTotal": 10,
        "bytesPerSecond": 0,
        "etaSeconds": None,
        "error": "",
        "record": {"path": str(tmp_path / "half.safetensors"), "type": "TextualInversion", "name": "Easy"},
        "type": "TextualInversion",
        "name": "Easy",
        "updatedAt": 1,
    }
    catalog._attach_control(catalog._INSTALLS["half"])
    catalog._save_jobs(force=True)
    catalog._LOADED_DIR = None
    catalog._INSTALLS.clear()
    catalog.ensure_jobs_loaded()
    restored = catalog.install_progress("half")
    assert restored["state"] == "paused" and restored["bytesDone"] == 5 and restored["type"] == "TextualInversion"


def test_generate_installs_a_missing_lora_by_version(client: TestClient, tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("YUME_LORA_DIR", str(tmp_path / "loras"))
    headers = {"Authorization": "Bearer test-key", "X-Civitai-Token": "civitai-token"}
    payload = {
        "prompt": "girl",
        "width": 512,
        "height": 512,
        "steps": 1,
        "loras": [{"name": "MOMO.SAFETENSORS", "weight": 0.7, "versionId": 7701, "baseModel": "Illustrious", "triggers": ["momo"]}],
    }
    first = client.post("/generate", headers=headers, json=payload)
    if first.status_code == 409:
        assert "installing" in first.json()["detail"].lower()
        job = client.get("/models/installs", headers=headers).json()["jobs"][0]
        for _ in range(40):
            job = client.get(f"/models/install/{job['id']}", headers=headers).json()
            if job["state"] in {"done", "error"}:
                break
        assert job["state"] == "done", job
        second = client.post("/generate", headers=headers, json={"prompt": "girl", "width": 512, "height": 512, "steps": 1, "loras": [{"name": "momo", "weight": 0.7, "versionId": 7701}]})
        assert second.status_code == 200, second.text
    else:
        assert first.status_code == 200, first.text
    listed = client.get("/models", headers=headers).json()["models"]
    lora = next(item for item in listed if item["versionId"] == 7701)
    assert lora["type"] == "LORA"
    assert lora["baseModel"] == "Illustrious"
    assert "momo" in lora["triggers"]
    assert lora.get("path") and os.path.exists(lora["path"])
    from yume_server.downloads import lora_root

    monkeypatch.setenv("YUME_LORA_DIR", "/loras")
    assert lora_root() == "/models/loras"


def test_restore_redownloads_a_missing_checkpoint(client: TestClient) -> None:
    headers = {"Authorization": "Bearer test-key", "X-Civitai-Token": "civitai-token"}
    version_id = 5015
    client.delete(f"/models/{version_id}", headers=headers)
    try:
        response = client.post(
            "/models/restore",
            headers=headers,
            json={
                "versionIds": [1337429, version_id],
                "lastUsedVersionId": version_id,
                "models": [{"versionId": version_id, "type": "Checkpoint", "name": "Prefect XL"}],
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["pendingLoad"] == version_id
        assert any(job["versionId"] == version_id for job in body["jobs"])
        job = next(item for item in body["jobs"] if item["versionId"] == version_id)
        for _ in range(40):
            job = client.get(f"/models/install/{job['id']}", headers=headers).json()
            if job["state"] in {"done", "error"}:
                break
        assert job["state"] == "done", job
        listed = client.get("/models", headers=headers).json()
        for _ in range(40):
            if listed.get("activeVersionId") == version_id:
                break
            time.sleep(0.02)
            listed = client.get("/models", headers=headers).json()
        assert any(item["versionId"] == version_id for item in listed["models"])
        assert listed["activeVersionId"] == version_id
    finally:
        client.post("/models/use", headers=headers, json={"versionId": 1337429})
        client.post("/models/default", headers=headers, json={"versionId": 1337429})


def test_hires_vae_and_loaded_name() -> None:
    from yume_server.generate import clip_skip_index, hires_plan, lora_directories, needs_fixed_vae

    assert clip_skip_index(1) == -1 and clip_skip_index(2) == -2
    assert needs_fixed_vae("Illustrious") and needs_fixed_vae("Pony") and not needs_fixed_vae("SD 1.5")
    assert needs_fixed_vae("SDXL 1.0", "animagine-xl-4.0-opt.safetensors") is False

    class Body:
        hires_scale = 1.5
        hires_denoise = 0.4
        hires_steps = 18
        hires_upscaler = "4x-AnimeSharp"

    plan = hires_plan(Body())
    assert plan is not None and plan["denoise"] == 0.4 and plan["steps"] == 18 and plan["scale"] == 1.5
    assert "/models/loras" in lora_directories()


def test_v_prediction_is_detected_and_clip_skip_is_indexed() -> None:
    from yume_server.generate import clip_skip_index, looks_v_prediction, scheduler_updates

    assert looks_v_prediction({"filename": "noobai-xl-vpred.safetensors", "baseModel": "NoobAI"})
    assert not looks_v_prediction({"filename": "prefectious_nsfw.fp16.safetensors", "name": "Prefectious XL NSFW", "baseModel": "Illustrious"})
    assert scheduler_updates(True)["rescale_betas_zero_snr"] is True
    assert scheduler_updates(False) == {}
    assert clip_skip_index(2) == -2 and clip_skip_index(1) == -1


def test_negative_seed_is_random_and_distinct(client: TestClient) -> None:
    headers = {"Authorization": "Bearer test-key"}
    payload = {"prompt": "a shrine", "width": 512, "height": 512, "count": 2, "steps": 1, "seed": -1, "scheduler": "euler_a"}
    first = finish_generate(client, client.post("/generate", headers=headers, json=payload), headers)["seeds"]
    second = finish_generate(client, client.post("/generate", headers=headers, json=payload), headers)["seeds"]
    assert len(first) == 2 and first[0] != first[1] and min(first) >= 0
    assert first != second


def test_startup_answers_before_ready(client: TestClient) -> None:
    startup = client.get("/startup")
    assert startup.status_code == 200, startup.text
    body = startup.json()
    assert body["stage"] in {"idle", "ready", "downloading", "loading"}
    assert "bytesDone" in body and "bytesTotal" in body and "bytesPerSecond" in body and "etaSeconds" in body
    from yume_server.startup import eta_seconds, note_file

    assert eta_seconds(100, 250, 50) == 3
    note_file("tile", name="Tile ControlNet", kind="ControlNet", done=20, total=40, state="downloading")
    progress = client.get("/progress")
    assert progress.status_code == 200
    names = [item["name"] for item in progress.json()["files"]]
    assert "Tile ControlNet" in names
    tile = next(item for item in progress.json()["files"] if item["name"] == "Tile ControlNet")
    assert tile["type"] == "ControlNet" and tile["bytes_done"] == 20 and tile["bytes_total"] == 40 and tile["state"] == "downloading"
    assert client.get("/health").json()["startup"]["stage"] == body["stage"]


def test_wai_boot_download_is_on_progress(tmp_path, monkeypatch, caplog) -> None:
    monkeypatch.setenv("YUME_MODEL_DIR", str(tmp_path))
    monkeypatch.setenv("YUME_MOCK", "1")
    from yume_server.catalog import materialize_checkpoint, wai_record
    from yume_server.startup import note_download, snapshot

    with caplog.at_level("INFO", logger="yume.startup"):
        materialize_checkpoint(wai_record())
        note_download(2_000_000, 6_946_000_000, name="WAI-illustrious-SDXL")
    body = snapshot()
    row = next(item for item in body["files"] if item["name"] == "WAI-illustrious-SDXL")
    assert row["type"] == "Checkpoint" and row["bytes_done"] == 2_000_000 and row["bytes_total"] == 6_946_000_000
    assert body["bytesDone"] == 2_000_000 and body["bytesTotal"] == 6_946_000_000 and "bytesPerSecond" in body
    assert "checkpoint download WAI-illustrious-SDXL 2000000/6946000000 bytes" in caplog.text
    assert "secret" not in caplog.text


def test_health_and_ready(client: TestClient) -> None:
    health = client.get("/health").json()
    assert health["status"] == "ok"
    assert "WAI" in health["model"]
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
    body = finish_generate(client, response, {"Authorization": "Bearer test-key"})
    assert body["seeds"] == [42, 43]
    assert body["scheduler"] == "dpm_2m_karras"
    assert body["model"] == "Animagine XL 4.0"
    assert len(body["images"]) == 2
    raw = base64.b64decode(body["images"][0])
    assert raw.startswith(b"\x89PNG")
    width, height = struct.unpack(">II", raw[16:24])
    assert (width, height) == (832, 1216)


def test_generate_accepts_character_regions_and_still_draws(client: TestClient) -> None:
    headers = {"Authorization": "Bearer test-key"}
    response = client.post(
        "/generate",
        headers=headers,
        json={
            "prompt": "two people, shrine",
            "loras": [
                {"name": "momo", "weight": 0.8, "kind": "character", "prompt": "pink hair"},
                {"name": "ink", "weight": 0.5, "kind": "style", "prompt": "lineart"},
                {"name": "ken", "weight": 0.7, "kind": "character", "prompt": "blue eyes"},
            ],
            "regions": [
                {"prompt": "pink hair", "x": 0, "y": 0, "w": 0.5, "h": 1, "lora_name": "momo", "lora_weight": 0.8},
                {"prompt": "blue eyes", "x": 0.5, "y": 0, "w": 0.5, "h": 1, "lora_name": "ken", "lora_weight": 0.7},
            ],
            "region_layout": "side",
        },
    )
    body = finish_generate(client, response, headers)
    assert body["images"] and body["images"][0]


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
    body = finish_generate(client, response, {"Authorization": "Bearer test-key"})
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
    wai = next(item for item in models if item["versionId"] == 2883731)
    assert wai["name"] == "WAI-illustrious-SDXL" and wai["isDefault"] is True
    assert wai["modelId"] == 827184
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
    installs = client.get("/models/installs", headers=headers)
    assert installs.status_code == 200
    assert any(item["versionId"] == 42 for item in installs.json()["jobs"])
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
    body = finish_generate(client, generated, headers)
    raw = base64.b64decode(body["images"][0])
    assert b"parameters" in raw
    assert b"Euler a" in raw
    assert b"1d5b43ff75" in raw


def test_stats_diagnostics_and_jobs(client: TestClient) -> None:
    headers = {"Authorization": "Bearer test-key"}
    assert client.get("/stats").status_code == 401
    stats = client.get("/stats", headers=headers)
    assert stats.status_code == 200, stats.text
    body = stats.json()
    assert "WAI" in body["model"]
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


def test_wai_is_the_boot_default_and_animagine_can_be_deleted(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("YUME_MODEL_DIR", str(tmp_path))
    monkeypatch.delenv("YUME_DEFAULT_VERSION_ID", raising=False)
    monkeypatch.setenv("YUME_MOCK", "1")
    monkeypatch.setenv("YUME_CIVITAI_TOKEN", "secret-civitai-token")
    from yume_server.catalog import civitai_token, delete_version, ensure_boot_default, ensure_default, ensure_opt_default, list_models
    from yume_server.generate import loaded_model_name, needs_fixed_vae, start_model

    assert civitai_token(None) == "secret-civitai-token"
    assert civitai_token("from-app") == "from-app"
    record = ensure_boot_default()
    assert record["versionId"] == 2883731 and record["isDefault"] is True
    start_model()
    assert loaded_model_name() == "WAI-illustrious-SDXL"
    ensure_default()
    ensure_opt_default()
    delete_version(1408658)
    delete_version(1337429)
    ids = {int(item["versionId"]) for item in list_models()}
    assert 1337429 not in ids and 1408658 not in ids and 2883731 in ids
    assert needs_fixed_vae("SDXL 1.0", "animagine-xl-4.0-opt.safetensors") is False


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
