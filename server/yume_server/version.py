"""Server code version. This file ships in the hot-updated tarball."""

from __future__ import annotations

import json
import os
from typing import Any

SERVER_CODE_VERSION = "1.5.4"


def version_payload() -> dict[str, Any]:
    stamp: dict[str, Any] = {}
    path = os.environ.get("YUME_CODE_STAMP", "").strip()
    if path and os.path.isfile(path):
        try:
            loaded = json.loads(open(path, encoding="utf-8").read())
            if isinstance(loaded, dict):
                stamp = loaded
        except (OSError, json.JSONDecodeError):
            stamp = {}
    return {
        "version": SERVER_CODE_VERSION,
        "ref": str(stamp.get("ref") or os.environ.get("YUME_SERVER_REF") or "bundled"),
        "sha256": str(stamp.get("sha256") or ""),
        "source": str(stamp.get("source") or "bundled"),
    }
