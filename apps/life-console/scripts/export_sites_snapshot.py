#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from hub.read_model.dashboard import build_dashboard
from hub.sites_snapshot import redact_dashboard_for_sites


def main() -> int:
    parser = argparse.ArgumentParser(description="Export the private Sites read-only projection.")
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/life-console-snapshot.json"),
    )
    args = parser.parse_args()

    snapshot = redact_dashboard_for_sites(build_dashboard(args.root.resolve()))
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")

    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{output.name}.", dir=output.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_name, 0o600)
        os.replace(temporary_name, output)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
