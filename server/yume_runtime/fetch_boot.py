"""Child process for the boot-time server-code download. The supervisor kills it after 90s."""

from __future__ import annotations

import sys
from pathlib import Path

from yume_runtime.codepack import apply_update


def main(argv: list[str]) -> int:
    ref, sha, releases, current = argv
    print(f"yume runtime fetch process start ref={ref}", flush=True)
    try:
        stamp = apply_update(ref, sha, releases_dir=Path(releases), current_link=Path(current))
    except Exception as exc:  # noqa: BLE001 - the parent prints this and boots the bundled copy
        print(f"yume runtime fetch process error: {exc}", flush=True)
        return 1
    print(f"yume runtime fetch process done ref={stamp.get('ref')} sha256={stamp.get('sha256')}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
