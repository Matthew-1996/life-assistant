from __future__ import annotations

import json
import stat
import tempfile
import unittest
from pathlib import Path

from sites_backup_sync_agent import (
    RETRY_DELAYS_SECONDS,
    VersionedColdBackupWriter,
    sync_pending,
)


class FakeSitesTransport:
    def __init__(self, *, fail_payload: bool = False) -> None:
        self.fail_payload = fail_payload
        self.reports: list[tuple[str, dict[str, object]]] = []

    def list_pending(self, limit: int) -> list[dict[str, object]]:
        self.limit = limit
        return [
            {
                "id": "backup_synthetic_1",
                "resource_type": "journal",
                "resource_id": "journal_synthetic_1",
                "revision": 2,
                "attempts": 0,
            }
        ]

    def get_payload(self, queue_id: str) -> dict[str, object]:
        if self.fail_payload:
            raise RuntimeError("synthetic fetch failure")
        return {
            "queue_id": queue_id,
            "resource_type": "journal",
            "resource_id": "journal_synthetic_1",
            "revision": 2,
            "deleted": False,
            "data": {
                "id": "journal_synthetic_1",
                "revision": 2,
                "date": "2026-01-12",
                "content": "synthetic only",
            },
        }

    def report(self, queue_id: str, payload: dict[str, object]) -> None:
        self.reports.append((queue_id, payload))


class SitesBackupSyncAgentTest(unittest.TestCase):
    def test_writes_versioned_mode_0600_backup_and_reports_success(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "cold-backup"
            transport = FakeSitesTransport()

            result = sync_pending(
                transport,
                VersionedColdBackupWriter(root),
                agent_id="synthetic-agent",
                limit=10,
            )

            self.assertEqual(result, {"processed": 1, "succeeded": 1, "failed": 0})
            target = (
                root
                / "journal"
                / "journal_synthetic_1"
                / "revision-00000002.json"
            )
            payload = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(payload["data"]["content"], "synthetic only")
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            self.assertEqual(
                transport.reports,
                [
                    (
                        "backup_synthetic_1",
                        {"status": "SUCCESS", "sync_agent": "synthetic-agent"},
                    )
                ],
            )

    def test_reports_retry_without_writing_partial_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "cold-backup"
            transport = FakeSitesTransport(fail_payload=True)

            result = sync_pending(
                transport,
                VersionedColdBackupWriter(root),
                agent_id="synthetic-agent",
                limit=10,
            )

            self.assertEqual(result, {"processed": 1, "succeeded": 0, "failed": 1})
            self.assertEqual(list(root.rglob("*.json")) if root.exists() else [], [])
            report = transport.reports[0][1]
            self.assertEqual(report["status"], "RETRYING")
            self.assertEqual(report["sync_agent"], "synthetic-agent")
            self.assertNotIn("synthetic fetch failure", json.dumps(report))
            self.assertEqual(report["retry_after_seconds"], RETRY_DELAYS_SECONDS[0])


if __name__ == "__main__":
    unittest.main()
