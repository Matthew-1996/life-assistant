#!/usr/bin/env python3
"""Supabase to iCloud one-way backup runner for Life Console."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import sys
from typing import Any
import uuid
from zipfile import ZIP_STORED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
LOCAL_AGENT = ROOT / "apps" / "life-console" / "local_agent"
if str(LOCAL_AGENT) not in sys.path:
    sys.path.insert(0, str(LOCAL_AGENT))

from backup_store import BackupStore, content_digest_for_resources  # noqa: E402
from life_console_cloud import CloudClient, CloudWriteError, _load_client, DEFAULT_CONFIG  # noqa: E402


RESOURCE_NAMES = (
    "goals",
    "journals",
    "journal_revisions",
    "daily_checkins",
    "weekly_reviews",
    "phase_reviews",
    "health_days",
    "health_segments",
)


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def build_archive(snapshot: dict[str, Any], export_id: str) -> tuple[bytes, dict[str, int], str]:
    if snapshot.get("schema_version") != 2 or not snapshot.get("exported_at"):
        raise CloudWriteError("unavailable")
    payloads: dict[str, bytes] = {}
    resources: dict[str, dict[str, object]] = {}
    counts: dict[str, int] = {}
    for name in RESOURCE_NAMES:
        rows = snapshot.get(name)
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise CloudWriteError("unavailable")
        payload = b"".join(_canonical(row) + b"\n" for row in rows)
        path = f"data/{name}.ndjson"
        payloads[path] = payload
        counts[name] = len(rows)
        resources[name] = {
            "count": len(rows),
            "path": path,
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
    digest = content_digest_for_resources(resources)
    manifest = {
        "format_version": "life-console-backup/2",
        "source_product_version": "2.3.0",
        "source_schema_version": "supabase/2",
        "export_id": export_id,
        "exported_at": snapshot["exported_at"],
        "resources": resources,
        "archive_content_sha256": digest,
    }
    stream = io.BytesIO()
    with ZipFile(stream, "w", compression=ZIP_STORED) as archive:
        for path, payload in payloads.items():
            archive.writestr(path, payload)
        archive.writestr("manifest.json", _canonical(manifest))
    return stream.getvalue(), counts, digest


class CloudBackupAgent:
    def __init__(
        self,
        client: CloudClient,
        *,
        latest_path: Path,
        receipt_path: Path,
    ) -> None:
        self.client = client
        self.store = BackupStore(
            target_path=latest_path,
            receipt_path=receipt_path,
        )

    def run_pending(self) -> dict[str, object]:
        pending = self.client.pending_backup()
        if pending is None:
            return {"status": "idle"}
        run_id = pending.get("id")
        if not isinstance(run_id, int):
            raise CloudWriteError("unavailable")
        export_id = f"backup-{uuid.uuid4()}"
        archive, counts, digest = build_archive(
            self.client.backup_snapshot(),
            export_id,
        )
        receipt = self.store.install(io.BytesIO(archive), run_id=export_id)
        self.client.complete_backup(
            run_id,
            counts=counts,
            content_digest=digest,
        )
        return {
            "status": "success",
            "counts": counts,
            "completed_at": receipt.completed_at,
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Life Console Supabase to iCloud backup")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--backup-root", type=Path, required=True)
    args = parser.parse_args()
    agent = CloudBackupAgent(
        _load_client(args.config),
        latest_path=args.backup_root / "life-console-latest.zip",
        receipt_path=args.backup_root / "backup-receipts.json",
    )
    try:
        result = agent.run_pending()
    except Exception:
        print(json.dumps({"status": "failed"}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
