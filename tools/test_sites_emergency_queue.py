from __future__ import annotations

import json
import stat
import tempfile
import unittest
from pathlib import Path

from sites_emergency_queue import append_event, validate_queue


class SitesEmergencyQueueTest(unittest.TestCase):
    def test_appends_mode_0600_create_only_event(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue_dir = Path(directory) / "queue"
            target = append_event(
                queue_dir,
                "journal",
                "synthetic-idempotency-0001",
                {"date": "2026-01-12", "content": "synthetic"},
                None,
            )

            event = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(event["operation"], "CREATE_ONLY")
            self.assertEqual(event["resource_type"], "journal")
            self.assertEqual(validate_queue(queue_dir), [target])
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(queue_dir.stat().st_mode), 0o700)

    def test_rejects_updates_and_invalid_base_revision(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue_dir = Path(directory)
            target = append_event(
                queue_dir,
                "goal",
                "synthetic-idempotency-0002",
                {"title": "synthetic"},
                1,
            )
            event = json.loads(target.read_text(encoding="utf-8"))
            event["operation"] = "UPDATE"
            target.write_text(json.dumps(event), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "CREATE_ONLY"):
                validate_queue(queue_dir)

    def test_rejects_duplicate_idempotency_keys(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue_dir = Path(directory)
            key = "synthetic-idempotency-0003"
            append_event(queue_dir, "journal", key, {"value": 1}, None)
            append_event(queue_dir, "journal", key, {"value": 2}, None)

            with self.assertRaisesRegex(ValueError, "duplicate"):
                validate_queue(queue_dir)


if __name__ == "__main__":
    unittest.main()
