import hashlib
import json
import stat
import tempfile
import unittest
from pathlib import Path

from tools.google_sheets_state import (
    GoogleSheetsStateError,
    activate,
    inspect_state,
    mark_success,
    set_mode,
)


class GoogleSheetsStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "integrations").mkdir()
        (self.root / "journal").mkdir()
        (self.root / "records").mkdir()
        self.config = {
            "schema_version": 1,
            "display_backend": "google_sheets",
            "lifecycle_state": "pending_connection",
            "account_scope": "personal",
            "access": "private_owner_only",
            "direction": "icloud_to_google_only",
            "sync_cadence": "every_record",
            "title": "生活计划表",
            "folder_name": "生活助手",
            "spreadsheet_id": None,
            "spreadsheet_url": None,
            "view_schema_version": 1,
            "managed_sheets": ["总览", "阶段路线", "两周行动", "每日记录", "每周复盘", "使用说明", "扩展规划", "日记索引"],
            "external_scope": "full_existing_views_without_raw_sources",
        }
        self.config_path = self.root / "integrations/google-sheets.json"
        self.config_path.write_text(json.dumps(self.config, ensure_ascii=False), encoding="utf-8")
        for relative, content in [
            ("journal/index.jsonl", b"journal\n"),
            ("records/daily-checkins.jsonl", b"daily\n"),
        ]:
            (self.root / relative).write_bytes(content)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _sources(self):
        result = {}
        definitions = {
            "journal": ("journal/index.jsonl", "journal-index-jsonl"),
            "daily": ("records/daily-checkins.jsonl", "daily-checkins-jsonl"),
            "weekly": ("records/weekly-reviews.jsonl", "weekly-reviews-jsonl"),
        }
        for key, (relative, category) in definitions.items():
            path = self.root / relative
            result[key] = {
                "path_category": category,
                "present": path.exists(),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None,
            }
        return result

    def test_activate_mark_and_detect_drift(self) -> None:
        self.assertEqual(inspect_state(self.root)["state"], "pending_connection")
        activated = activate(self.root, {
            "spreadsheet_id": "sheet_id_1234567890",
            "spreadsheet_url": "https://docs.google.com/spreadsheets/d/sheet_id_1234567890/edit",
        })
        self.assertEqual(activated["action"], "activated")
        self.assertEqual(inspect_state(self.root)["state"], "pending_initial_sync")
        result = mark_success(self.root, {
            "spreadsheet_id": "sheet_id_1234567890",
            "payload_sha256": "a" * 64,
            "sources": self._sources(),
        })
        self.assertEqual(result["state"], "current")
        receipt = self.root / "integrations/google-sheets.sync-state.json"
        self.assertEqual(stat.S_IMODE(receipt.stat().st_mode), 0o600)
        self.assertTrue(inspect_state(self.root)["current"])
        (self.root / "records/daily-checkins.jsonl").write_bytes(b"changed\n")
        self.assertEqual(inspect_state(self.root)["state"], "stale")

    def test_rejects_other_spreadsheet(self) -> None:
        activate(self.root, {
            "spreadsheet_id": "sheet_id_1234567890",
            "spreadsheet_url": "https://docs.google.com/spreadsheets/d/sheet_id_1234567890/edit",
        })
        with self.assertRaises(GoogleSheetsStateError):
            mark_success(self.root, {
                "spreadsheet_id": "other_sheet_1234567890",
                "payload_sha256": "b" * 64,
                "sources": self._sources(),
            })

    def test_paused_on_demand_mode_preserves_binding_without_sync_due(self) -> None:
        activate(self.root, {
            "spreadsheet_id": "sheet_id_1234567890",
            "spreadsheet_url": "https://docs.google.com/spreadsheets/d/sheet_id_1234567890/edit",
        })
        result = set_mode(self.root, {
            "lifecycle_state": "paused",
            "sync_cadence": "on_demand",
            "expect_lifecycle_state": "active",
            "expect_sync_cadence": "every_record",
        })
        self.assertEqual(result["action"], "mode_updated")
        self.assertEqual(inspect_state(self.root)["state"], "paused")
        saved = json.loads(self.config_path.read_text(encoding="utf-8"))
        self.assertEqual(saved["spreadsheet_id"], "sheet_id_1234567890")
        self.assertEqual(saved["sync_cadence"], "on_demand")

        with self.assertRaises(GoogleSheetsStateError):
            set_mode(self.root, {
                "lifecycle_state": "active",
                "sync_cadence": "every_record",
                "expect_lifecycle_state": "active",
                "expect_sync_cadence": "every_record",
            })


if __name__ == "__main__":
    unittest.main()
