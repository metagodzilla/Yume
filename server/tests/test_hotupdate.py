import io
import json
import os
import subprocess
import sys
import tarfile
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("YUME_MOCK", "1")
os.environ.setdefault("YUME_API_KEY", "test-key")
os.environ.setdefault("YUME_MODEL_DIR", "/tmp/yume-model-cache")

from yume_runtime.codepack import apply_update, install_tree, pick_release, safe_extract, sha256_bytes  # noqa: E402
from yume_runtime.supervisor import wait_bounded  # noqa: E402
from yume_server.main import app  # noqa: E402
from yume_server.version import SERVER_CODE_VERSION  # noqa: E402


def archive_bytes() -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as handle:
        payload = b"# hot\n"
        info = tarfile.TarInfo("yume_server/main.py")
        info.size = len(payload)
        handle.addfile(info, io.BytesIO(payload))
    return buffer.getvalue()


def test_pick_release_ignores_app_tags() -> None:
    releases = [{"tag_name": "v1.5.3"}, {"tag_name": "server-v1.5.4"}, {"tag_name": "server-v1.5.2"}]
    assert pick_release(releases, "latest")["tag_name"] == "server-v1.5.4"
    assert pick_release(releases, "server-v1.5.2")["tag_name"] == "server-v1.5.2"
    assert pick_release(releases, "server-v9") is None


def test_latest_skips_prerelease_server_code() -> None:
    releases = [
        {"tag_name": "server-v1.5.5", "prerelease": True},
        {"tag_name": "server-v1.5.4", "prerelease": False},
    ]
    assert pick_release(releases, "latest")["tag_name"] == "server-v1.5.4"
    assert pick_release(releases, "server-v1.5.5")["tag_name"] == "server-v1.5.5"
    assert pick_release([{"tag_name": "server-v1.5.5", "prerelease": True}], "latest") is None


def test_fetch_deadline_kills_a_hung_process() -> None:
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True)
    started = time.monotonic()
    with pytest.raises(TimeoutError):
        wait_bounded(proc, 0.4)
    assert time.monotonic() - started < 3
    assert proc.poll() is not None


def test_install_checks_sha_and_leaves_models(tmp_path: Path) -> None:
    archive = archive_bytes()
    digest = sha256_bytes(archive)
    current = tmp_path / "app"
    stamp = install_tree(archive, digest, tmp_path / "releases", current, "server-v1.5.4")
    assert stamp["sha256"] == digest
    assert (current / "yume_server" / "main.py").is_file()
    assert json.loads((current / "STAMP.json").read_text())["source"] == "release"
    with pytest.raises(ValueError, match="SHA-256"):
        install_tree(archive, "0" * 64, tmp_path / "other", tmp_path / "nope", "server-v1.5.4")
    with pytest.raises(ValueError, match="model files"):
        install_tree(archive, digest, Path("/models/code"), Path("/models/app"), "server-v1.5.4")


def test_archive_rejects_parent_paths(tmp_path: Path) -> None:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as handle:
        info = tarfile.TarInfo("../evil.py")
        payload = b"x"
        info.size = len(payload)
        handle.addfile(info, io.BytesIO(payload))
    with pytest.raises(ValueError, match="unsafe"):
        safe_extract(buffer.getvalue(), tmp_path / "dest")


def test_admin_update_swaps_code_without_a_token_leak(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    archive = archive_bytes()
    digest = sha256_bytes(archive)
    release = {
        "tag_name": "server-v1.5.4",
        "assets": [
            {"name": "yume-server-code.tar.gz", "browser_download_url": "https://example.test/code"},
            {"name": "yume-server-code.sha256", "browser_download_url": "https://example.test/sha"},
        ],
    }

    def opener(url: str) -> bytes:
        if "api.github.com" in url:
            return json.dumps([{"tag_name": "v1.5.3"}, release]).encode()
        if url.endswith("/code"):
            return archive
        if url.endswith("/sha"):
            return f"{digest}  yume-server-code.tar.gz\n".encode()
        raise AssertionError(url)

    monkeypatch.setenv("YUME_RUNTIME_ROOT", str(tmp_path))
    monkeypatch.setenv("YUME_ADMIN_TOKEN", "admin-test-token")
    monkeypatch.setattr("yume_runtime.codepack.http_opener", opener)
    with TestClient(app) as client:
        hidden = client.get("/version")
        assert hidden.status_code == 401
        listed = client.get("/version", headers={"Authorization": "Bearer test-key"})
        assert listed.status_code == 200
        assert listed.json()["version"] == SERVER_CODE_VERSION
        rejected = client.post("/admin/update", headers={"X-Admin-Token": "nope"}, json={"ref": "server-v1.5.4", "sha256": digest})
        assert rejected.status_code == 401
        updated = client.post(
            "/admin/update",
            headers={"X-Admin-Token": "admin-test-token"},
            json={"ref": "latest", "sha256": digest},
        )
        assert updated.status_code == 200, updated.text
        body = updated.json()
        assert body["ok"] is True and body["models"] == "kept on disk" and body["sha256"] == digest
        assert (tmp_path / "app" / "yume_server" / "main.py").is_file()
        assert not (tmp_path / "models").exists()
