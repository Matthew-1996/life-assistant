#!/usr/bin/env python3
"""Verify and restore-test a Life Console cloud backup in isolation."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import tempfile
from typing import Any
from zipfile import ZipFile

from life_console_backup_agent import LEGACY_RESOURCE_NAMES, RESOURCE_NAMES


def verify_isolated_restore(archive_path: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="life-console-restore-") as directory:
        target = Path(directory)
        with ZipFile(archive_path) as archive:
            names = set(archive.namelist())
            manifest = json.loads(archive.read("manifest.json"))
            format_version = manifest.get("format_version")
            if format_version not in (
                "life-console-backup/2",
                "life-console-backup/3",
            ):
                raise ValueError("backup_format_invalid")
            resource_names = (
                LEGACY_RESOURCE_NAMES
                if format_version == "life-console-backup/2"
                else RESOURCE_NAMES
            )
            expected = {"manifest.json"} | {
                f"data/{name}.ndjson" for name in resource_names
            }
            if names != expected:
                raise ValueError("backup_paths_invalid")
            archive.extractall(target)

        counts: dict[str, int] = {}
        for name in resource_names:
            metadata = manifest.get("resources", {}).get(name)
            if not isinstance(metadata, dict):
                raise ValueError("backup_manifest_invalid")
            payload = (target / f"data/{name}.ndjson").read_bytes()
            if hashlib.sha256(payload).hexdigest() != metadata.get("sha256"):
                raise ValueError("backup_digest_invalid")
            rows = []
            for line in payload.splitlines():
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError("backup_row_invalid")
                rows.append(value)
            if len(rows) != metadata.get("count"):
                raise ValueError("backup_count_invalid")
            counts[name] = len(rows)
        return {"status": "verified", "counts": counts}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    try:
        result = verify_isolated_restore(args.archive)
    except Exception:
        print(json.dumps({"status": "failed"}))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
