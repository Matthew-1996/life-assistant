import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parent / "daily_checkin.py"


class DailyCheckinTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name) / "records"

    def tearDown(self):
        self.temp_dir.cleanup()

    def run_tool(self, *args, expect=0, command="upsert"):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), command, "--root", str(self.root), *args],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, expect, result.stderr)
        return result

    def records(self):
        data_path = self.root / "daily-checkins.jsonl"
        return [json.loads(line) for line in data_path.read_text("utf-8").splitlines() if line]

    def test_online_primary_marker_blocks_local_active_write(self):
        (self.root.parent / ".life-console-online-primary").write_text(
            "{}\n", encoding="utf-8"
        )

        blocked = self.run_tool("--date", "2030-01-01", "--mood", "3", expect=2)

        self.assertIn("本地活跃写入已停用", blocked.stderr)
        self.assertFalse((self.root / "daily-checkins.jsonl").exists())

    def test_same_values_are_true_noop_and_later_fields_update_same_row(self):
        first = self.run_tool(
            "--date", "2026-08-02", "--sleep-quality", "3", "--note-summary", "散步后稍舒服"
        )
        self.assertEqual(json.loads(first.stdout)["action"], "created")
        original_bytes = (self.root / "daily-checkins.jsonl").read_bytes()
        original = self.records()[0]

        unchanged = self.run_tool(
            "--date", "2026-08-02", "--sleep-quality", "3", "--note-summary", "散步后稍舒服"
        )
        unchanged_result = json.loads(unchanged.stdout)
        self.assertEqual(unchanged_result["action"], "unchanged")
        self.assertEqual(unchanged_result["revision"], 1)
        self.assertEqual(unchanged_result["fields_updated"], [])
        self.assertEqual((self.root / "daily-checkins.jsonl").read_bytes(), original_bytes)

        empty_note = self.run_tool(
            "--date", "2026-08-02", "--note-summary", "   ", expect=2
        )
        self.assertIn("至少提供一个", empty_note.stderr)
        self.assertEqual((self.root / "daily-checkins.jsonl").read_bytes(), original_bytes)

        updated = self.run_tool("--date", "2026-08-02", "--energy", "2")
        self.assertEqual(json.loads(updated.stdout)["action"], "updated")
        records = self.records()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["revision"], 2)
        self.assertEqual(records[0]["ratings"]["sleep_quality"], 3)
        self.assertEqual(records[0]["ratings"]["energy"], 2)
        self.assertEqual(records[0]["created_at"], original["created_at"])

    def test_wake_time_can_be_updated_and_cleared_with_revision_protection(self):
        created = self.run_tool(
            "--date", "2026-08-03", "--sleep-time", "00:29",
            "--wake-time", "09:30", "--out-of-bed-time", "10:00",
        )
        self.assertEqual(json.loads(created.stdout)["revision"], 1)
        record = self.records()[0]
        self.assertEqual(record["schema_version"], 2)
        self.assertEqual(record["wake_time"], "09:30")

        cleared = self.run_tool(
            "--date", "2026-08-03", "--clear-field", "wake_time",
            "--expect-revision", "1",
        )
        self.assertEqual(json.loads(cleared.stdout)["revision"], 2)
        self.assertIsNone(self.records()[0]["wake_time"])

        failed = self.run_tool(
            "--date", "2026-08-03", "--wake-time", "09:40",
            "--expect-revision", "1", expect=2,
        )
        self.assertIn("修订冲突", failed.stderr)

    def test_v1_to_v2_migration_is_atomic_and_idempotent(self):
        self.root.mkdir(parents=True)
        data_path = self.root / "daily-checkins.jsonl"
        v1 = {
            "schema_version": 1,
            "key": "daily-checkin:2026-08-02",
            "date": "2026-08-02",
            "sleep_time": "03:48",
            "out_of_bed_time": "08:54",
            "ratings": {"sleep_quality": 2, "energy": 2, "mood": 2, "life_feeling": 2},
            "awake_in_bed": None,
            "anchors": {"wake": None, "body_light": "minimum", "life_action": "complete", "wind_down": "minimum"},
            "note_summary": None,
            "revision": 5,
            "created_at": "2026-08-02T03:20:00Z",
            "updated_at": "2026-08-02T04:20:00Z",
        }
        data_path.write_text(json.dumps(v1, ensure_ascii=False) + "\n", "utf-8")

        blocked = self.run_tool("--date", "2026-08-02", "--mood", "3", expect=2)
        self.assertIn("migrate-v2", blocked.stderr)

        migrated = self.run_tool(command="migrate-v2")
        payload = json.loads(migrated.stdout)
        self.assertEqual(payload["action"], "migrated")
        record = self.records()[0]
        self.assertEqual(record["schema_version"], 2)
        self.assertIsNone(record["wake_time"])
        self.assertEqual(record["revision"], 6)
        self.assertEqual(record["sleep_time"], "03:48")
        self.assertEqual(record["out_of_bed_time"], "08:54")

        before = data_path.read_bytes()
        second = self.run_tool(command="migrate-v2")
        self.assertEqual(json.loads(second.stdout)["action"], "unchanged")
        self.assertEqual(data_path.read_bytes(), before)

    def test_expected_revision_prevents_lost_update(self):
        self.run_tool("--date", "2026-08-03", "--mood", "3")
        before = (self.root / "daily-checkins.jsonl").read_bytes()
        failed = self.run_tool(
            "--date", "2026-08-03", "--energy", "4", "--expect-revision", "0", expect=2
        )
        self.assertIn("修订冲突", failed.stderr)
        self.assertEqual((self.root / "daily-checkins.jsonl").read_bytes(), before)

    def test_clear_fields_corrects_one_date_without_removing_other_values(self):
        self.run_tool(
            "--date", "2026-08-02",
            "--sleep-quality", "2",
            "--energy", "2",
            "--mood", "2",
            "--life-feeling", "2",
            "--life-action", "complete",
        )
        corrected = self.run_tool(
            "--date", "2026-08-02",
            "--clear-field", "energy",
            "--clear-field", "mood",
            "--clear-field", "life_feeling",
            "--expect-revision", "1",
        )
        payload = json.loads(corrected.stdout)
        self.assertEqual(payload["action"], "updated")
        self.assertEqual(payload["revision"], 2)
        self.assertEqual(
            payload["fields_updated"],
            ["ratings.energy", "ratings.life_feeling", "ratings.mood"],
        )
        record = self.records()[0]
        self.assertEqual(record["ratings"]["sleep_quality"], 2)
        self.assertIsNone(record["ratings"]["energy"])
        self.assertIsNone(record["ratings"]["mood"])
        self.assertIsNone(record["ratings"]["life_feeling"])
        self.assertEqual(record["anchors"]["life_action"], "complete")

        before = (self.root / "daily-checkins.jsonl").read_bytes()
        conflict = self.run_tool(
            "--date", "2026-08-02",
            "--energy", "3",
            "--clear-field", "energy",
            expect=2,
        )
        self.assertIn("同时更新和清空", conflict.stderr)
        self.assertEqual((self.root / "daily-checkins.jsonl").read_bytes(), before)

        missing = self.run_tool(
            "--date", "2026-08-03",
            "--clear-field", "energy",
            expect=2,
        )
        self.assertIn("尚不存在", missing.stderr)

    def test_existing_unknown_fields_and_invalid_timestamps_are_rejected(self):
        self.run_tool("--date", "2026-08-04", "--mood", "2")
        data_path = self.root / "daily-checkins.jsonl"
        record = self.records()[0]
        record["raw_transcript"] = "不应保留的原文"
        data_path.write_text(json.dumps(record, ensure_ascii=False) + "\n", "utf-8")
        failed = self.run_tool("--date", "2026-08-04", "--mood", "3", expect=2)
        self.assertIn("字段集无效", failed.stderr)

        record.pop("raw_transcript")
        record["updated_at"] = "2026-99-99T25:61:61Z"
        data_path.write_text(json.dumps(record, ensure_ascii=False) + "\n", "utf-8")
        failed = self.run_tool("--date", "2026-08-04", "--mood", "3", expect=2)
        self.assertIn("updated_at 无效", failed.stderr)

        record["updated_at"] = "2026-02-31T00:00:00Z"
        data_path.write_text(json.dumps(record, ensure_ascii=False) + "\n", "utf-8")
        failed = self.run_tool("--date", "2026-08-04", "--mood", "3", expect=2)
        self.assertIn("updated_at 无效", failed.stderr)

    def test_high_confidence_secrets_are_redacted_without_echo(self):
        secrets = [
            "A" + "KIAABCDEFGHIJKLMNOP",
            "ey" + "Jabcdefgh.abcdefgh.abcdefgh-",
            "s" + "k-abcdefghijklmnopqrstuvwx",
            "g" + "hp_abcdefghijklmnopqrstuvwxyz",
            "x" + "oxb-1234567890-abcdefghijkl",
            "恢复码：ABCD-EFGH-IJKL",
            "recovery" + " code: 1234 5678",
            "pass" + "word：\"quoted credential value\"",
            "-----BEGIN " + "PRIVATE KEY----- abcdef123456 -----END PRIVATE KEY-----",
            "-----BEGIN ENCRYPTED " + "PRIVATE KEY----- encrypted-body -----END ENCRYPTED PRIVATE KEY-----",
            "-----BEGIN DSA " + "PRIVATE KEY----- dsa-body -----END DSA PRIVATE KEY-----",
            "-----BEGIN PGP " + "PRIVATE KEY BLOCK----- pgp-body -----END PGP PRIVATE KEY BLOCK-----",
            "person@example.com",
            "13812345678",
        ]
        summary = " ".join(secrets)
        result = self.run_tool(
            "--date", "2026-08-05", "--life-feeling", "2", "--note-summary", summary
        )
        persisted = (self.root / "daily-checkins.jsonl").read_text("utf-8")
        for secret in secrets:
            self.assertNotIn(secret, persisted)
            self.assertNotIn(secret, result.stdout)
            self.assertNotIn(secret, result.stderr)
        self.assertIn("敏感信息已省略", persisted)

    def test_concurrent_partial_updates_merge_into_one_daily_record(self):
        commands = [
            ("--sleep-quality", "3"),
            ("--energy", "2"),
            ("--mood", "4"),
            ("--life-feeling", "3"),
        ]
        processes = [
            subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "upsert",
                    "--root",
                    str(self.root),
                    "--date",
                    "2026-08-06",
                    *option,
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            for option in commands
        ]
        for process in processes:
            stdout, stderr = process.communicate(timeout=20)
            self.assertEqual(process.returncode, 0, f"{stdout}\n{stderr}")
        records = self.records()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["revision"], 4)
        self.assertEqual(
            records[0]["ratings"],
            {"sleep_quality": 3, "energy": 2, "mood": 4, "life_feeling": 3},
        )

    def test_purge_requires_exact_confirmation_revision_and_history_ack(self):
        private_summary = "不应出现在删除预览或回执中的私人摘要"
        self.run_tool(
            "--date", "2026-08-07", "--mood", "2", "--note-summary", private_summary
        )
        before = (self.root / "daily-checkins.jsonl").read_bytes()

        plan = self.run_tool(
            "--date", "2026-08-07", command="purge-plan"
        )
        plan_payload = json.loads(plan.stdout)
        self.assertTrue(plan_payload["exists"])
        self.assertEqual(plan_payload["revision"], 1)
        self.assertEqual(
            plan_payload["required_confirmation"], "daily-checkin:2026-08-07"
        )
        record_etag = plan_payload["record_etag"]
        self.assertRegex(record_etag, r"^[0-9a-f]{64}$")
        self.assertEqual((self.root / "daily-checkins.jsonl").read_bytes(), before)
        self.assertNotIn(private_summary, plan.stdout + plan.stderr)

        missing_ack = self.run_tool(
            "--date",
            "2026-08-07",
            "--confirm",
            "daily-checkin:2026-08-07",
            "--expect-revision",
            "1",
            "--expect-record-etag",
            record_etag,
            command="purge",
            expect=2,
        )
        self.assertIn("历史", missing_ack.stderr)
        self.assertEqual((self.root / "daily-checkins.jsonl").read_bytes(), before)

        wrong_confirm = self.run_tool(
            "--date",
            "2026-08-07",
            "--confirm",
            "daily-checkin:2026-08-08",
            "--acknowledge-historical-copies",
            "--expect-revision",
            "1",
            "--expect-record-etag",
            record_etag,
            command="purge",
            expect=2,
        )
        self.assertIn("完全一致", wrong_confirm.stderr)
        self.assertEqual((self.root / "daily-checkins.jsonl").read_bytes(), before)

        stale_revision = self.run_tool(
            "--date",
            "2026-08-07",
            "--confirm",
            "daily-checkin:2026-08-07",
            "--acknowledge-historical-copies",
            "--expect-revision",
            "2",
            "--expect-record-etag",
            record_etag,
            command="purge",
            expect=2,
        )
        self.assertIn("修订冲突", stale_revision.stderr)
        self.assertEqual((self.root / "daily-checkins.jsonl").read_bytes(), before)

        stale_content = self.run_tool(
            "--date",
            "2026-08-07",
            "--confirm",
            "daily-checkin:2026-08-07",
            "--acknowledge-historical-copies",
            "--expect-revision",
            "1",
            "--expect-record-etag",
            "0" * 64,
            command="purge",
            expect=2,
        )
        self.assertIn("删除预览后发生变化", stale_content.stderr)
        self.assertEqual((self.root / "daily-checkins.jsonl").read_bytes(), before)

        purged = self.run_tool(
            "--date",
            "2026-08-07",
            "--confirm",
            "daily-checkin:2026-08-07",
            "--acknowledge-historical-copies",
            "--expect-revision",
            "1",
            "--expect-record-etag",
            record_etag,
            command="purge",
        )
        payload = json.loads(purged.stdout)
        self.assertEqual(payload["action"], "purged")
        self.assertTrue(payload["workbook_sync_required"])
        self.assertTrue(payload["historical_copies_not_deleted"])
        self.assertEqual(self.records(), [])
        self.assertNotIn(private_summary, purged.stdout + purged.stderr)

    def test_purge_retry_is_safe_and_still_requires_workbook_sync(self):
        self.run_tool("--date", "2026-08-08", "--energy", "3")
        plan = json.loads(
            self.run_tool("--date", "2026-08-08", command="purge-plan").stdout
        )
        args = (
            "--date",
            "2026-08-08",
            "--confirm",
            "daily-checkin:2026-08-08",
            "--acknowledge-historical-copies",
            "--expect-revision",
            str(plan["revision"]),
            "--expect-record-etag",
            plan["record_etag"],
        )
        first = self.run_tool(*args, command="purge")
        second = self.run_tool(*args, command="purge")
        self.assertEqual(json.loads(first.stdout)["action"], "purged")
        self.assertEqual(json.loads(second.stdout)["action"], "already_absent")
        for result in (first, second):
            self.assertTrue(json.loads(result.stdout)["workbook_sync_required"])
        self.assertEqual((self.root / "daily-checkins.jsonl").read_bytes(), b"")

    def test_week_summary_uses_monday_sunday_and_never_outputs_notes(self):
        secret_note = "周汇总不得输出的私人 sentinel"
        self.run_tool(
            "--date", "2026-08-02", "--mood", "1", "--note-summary", "范围外记录"
        )
        self.run_tool(
            "--date", "2026-08-03", "--sleep-quality", "3", "--mood", "2",
            "--wake", "complete", "--note-summary", secret_note,
        )
        self.run_tool(
            "--date", "2026-08-09", "--sleep-quality", "5", "--awake-in-bed", "yes",
            "--wake", "minimum", "--note-summary", "周日私人备注",
        )
        self.run_tool(
            "--date", "2026-08-10", "--sleep-quality", "1", "--note-summary", "范围外记录"
        )

        result = self.run_tool(
            "--week-start", "2026-08-03", command="week-summary"
        )
        payload = json.loads(result.stdout)
        self.assertEqual(payload["week_start"], "2026-08-03")
        self.assertEqual(payload["week_end"], "2026-08-09")
        self.assertEqual(payload["checkin_days"], 2)
        self.assertEqual(payload["rating_counts"]["sleep_quality"], 2)
        self.assertEqual(payload["rating_averages"]["sleep_quality"], 4.0)
        self.assertEqual(payload["rating_counts"]["mood"], 1)
        self.assertEqual(payload["anchor_counts"]["wake"], {
            "complete": 1,
            "minimum": 1,
            "skipped": 0,
        })
        self.assertEqual(payload["awake_in_bed_counts"], {"no": 0, "yes": 1})
        self.assertNotIn("note_summary", result.stdout + result.stderr)
        self.assertNotIn(secret_note, result.stdout + result.stderr)
        self.assertNotIn("周日私人备注", result.stdout + result.stderr)

        invalid = self.run_tool(
            "--week-start", "2026-08-04", command="week-summary", expect=2
        )
        self.assertIn("周一", invalid.stderr)


if __name__ == "__main__":
    unittest.main()
