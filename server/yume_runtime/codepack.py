"""Download a pinned server-code release, check its SHA-256, and swap it in.

Model files live under /models and /loras. This module never deletes them.
"""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import os
import shutil
import tarfile
from pathlib import Path
from typing import Any, Callable
from urllib.request import Request, urlopen

TAG_PREFIX = "server-v"
CODE_ASSET = "yume-server-code.tar.gz"
SUM_ASSET = "yume-server-code.sha256"
RELOAD_EXIT = 75
DEFAULT_REPO = "metagodzilla/Yume"
MODEL_ROOTS = ("/models", "/loras")

Opener = Callable[[str], bytes]


def same_secret(left: str, right: str) -> bool:
    if not left or not right or len(left) != len(right):
        return False
    return hmac.compare_digest(left, right)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_sha_file(text: str) -> str:
    token = text.strip().split()[0] if text.strip() else ""
    return token.lower()


def is_live_server_release(item: dict[str, Any]) -> bool:
    """latest is a full server-v release. Drafts and prereleases stay out unless named."""
    if item.get("draft") or item.get("prerelease"):
        return False
    return str(item.get("tag_name") or "").startswith(TAG_PREFIX)


def pick_release(releases: list[dict[str, Any]], ref: str) -> dict[str, Any] | None:
    wanted = (ref or "latest").strip()
    if wanted and wanted != "latest":
        return next((item for item in releases if item.get("tag_name") == wanted), None)
    live = [item for item in releases if is_live_server_release(item)]
    return live[0] if live else None


def _log(message: str) -> None:
    print(f"yume runtime {message}", flush=True)


def asset_url(release: dict[str, Any], name: str) -> str:
    for asset in release.get("assets") or []:
        if isinstance(asset, dict) and asset.get("name") == name:
            return str(asset.get("browser_download_url") or "")
    return ""


def _inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def assert_keeps_models(path: Path) -> None:
    resolved = path.resolve()
    for root in MODEL_ROOTS:
        model = Path(root)
        if resolved == model or _inside(resolved, model) or _inside(model, resolved):
            raise ValueError(f"Server code cannot be installed on model files ({root}).")


def safe_extract(archive: bytes, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as handle:
        members = handle.getmembers()
        for member in members:
            name = member.name
            if name.startswith("/") or ".." in Path(name).parts:
                raise ValueError("The server archive contains an unsafe path.")
            target = (dest / name).resolve()
            if not _inside(target, dest.resolve()):
                raise ValueError("The server archive contains an unsafe path.")
            if member.issym() or member.islnk():
                raise ValueError("The server archive contains a link.")
        for member in members:
            handle.extract(member, dest, set_attrs=False)


def swap_link(current: Path, dest: Path) -> None:
    current.parent.mkdir(parents=True, exist_ok=True)
    temporary = current.parent / f".{current.name}.next"
    if temporary.is_symlink() or temporary.exists():
        temporary.unlink()
    temporary.symlink_to(dest, target_is_directory=True)
    os.replace(temporary, current)


def install_tree(archive: bytes, expected_sha: str, releases_dir: Path, current_link: Path, ref: str) -> dict[str, str]:
    assert_keeps_models(releases_dir)
    assert_keeps_models(current_link)
    digest = sha256_bytes(archive)
    if not same_secret(digest, expected_sha.strip().lower()):
        raise ValueError("SHA-256 does not match the server release.")
    dest = releases_dir / digest
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    try:
        safe_extract(archive, dest)
    except Exception:
        shutil.rmtree(dest, ignore_errors=True)
        raise
    if not (dest / "yume_server" / "main.py").is_file():
        shutil.rmtree(dest, ignore_errors=True)
        raise ValueError("The server archive has no yume_server package.")
    stamp = {"ref": ref, "sha256": digest, "source": "release"}
    (dest / "STAMP.json").write_text(json.dumps(stamp), encoding="utf-8")
    swap_link(current_link, dest)
    return stamp


def http_opener(url: str, timeout: int = 60) -> bytes:
    request = Request(url, headers={"User-Agent": "yume-server-update", "Accept": "application/vnd.github+json"})
    with urlopen(request, timeout=timeout) as response:
        return response.read()


def apply_update(
    ref: str,
    sha256: str,
    *,
    releases_dir: Path,
    current_link: Path,
    opener: Opener | None = None,
    repo: str | None = None,
) -> dict[str, str]:
    fetch = opener or http_opener
    repository = (repo or os.environ.get("YUME_GITHUB_REPO") or DEFAULT_REPO).strip()
    list_url = f"https://api.github.com/repos/{repository}/releases?per_page=20"
    _log(f"fetch release list {list_url}")
    listing = json.loads(fetch(list_url).decode())
    if not isinstance(listing, list):
        raise ValueError("GitHub did not return a release list.")
    _log(f"fetched release list count={len(listing)}")
    release = pick_release(listing, ref)
    if not release:
        raise ValueError(f"No live server release matches {ref or 'latest'}. Name a server-v tag to use a prerelease.")
    _log(f"chosen release {release.get('tag_name')}")
    archive_url = asset_url(release, CODE_ASSET)
    sum_url = asset_url(release, SUM_ASSET)
    if not archive_url or not sum_url:
        raise ValueError("That server release has no code archive or checksum.")
    _log(f"fetch archive {archive_url}")
    archive = fetch(archive_url)
    _log(f"fetched archive bytes={len(archive)}")
    _log(f"fetch checksum {sum_url}")
    published = parse_sha_file(fetch(sum_url).decode())
    _log(f"fetched checksum {published}")
    if sha256 and not same_secret(sha256.strip().lower(), published):
        raise ValueError("The requested SHA-256 does not match the published checksum.")
    pin = os.environ.get("YUME_SERVER_SHA256", "").strip().lower()
    if pin and not same_secret(pin, published):
        raise ValueError("The release does not match YUME_SERVER_SHA256.")
    return install_tree(archive, published, releases_dir, current_link, str(release.get("tag_name") or ref))


def use_bundled(bundled: Path, releases_dir: Path, current_link: Path) -> dict[str, str] | None:
    if not (bundled / "yume_server" / "main.py").is_file():
        return None
    if current_link.is_symlink() and (current_link / "yume_server" / "main.py").is_file():
        return None
    dest = releases_dir / "bundled"
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(bundled, dest)
    stamp = {"ref": os.environ.get("YUME_SERVER_REF", "bundled"), "sha256": "", "source": "bundled"}
    (dest / "STAMP.json").write_text(json.dumps(stamp), encoding="utf-8")
    swap_link(current_link, dest)
    return stamp
