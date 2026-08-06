import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


SCRIPT = Path(__file__).resolve().parent / "apple_health_history.py"


class AppleHealthHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name) / "records"
        self.source = Path(self.temp_dir.name) / "apple-health-latest.txt"

    def tearDown(self):
        self.temp_dir.cleanup()

    def write_source(self, *, generated="2026年8月6日 10:55", steps="8474", extra=""):
        self.source.write_text(
            "\n".join(
                [
                    f"generated_at: {generated}",
                    f"steps: {steps}",
                    "active_energy: 262.776",
                    "exercise_minutes: 5",
                    "sleep_start: 2026年8月5日 02:07",
                    "sleep_end: 2026年8月6日 09:30",
                    extra,
                ]
            ),
            "utf-8",
        )

    def run_tool(self, *args, command="ingest", expect=0):
        command_args = [sys.executable, str(SCRIPT), command, "--root", str(self.root)]
        if command == "ingest":
            command_args.extend(["--source", str(self.source)])
        command_args.extend(args)
        result = subprocess.run(command_args, text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, expect, result.stderr)
        return result

    def records(self):
        path = self.root / "apple-health-history.jsonl"
        return [json.loads(line) for line in path.read_text("utf-8").splitlines() if line]

    def test_ingest_normalizes_and_list_returns_one_daily_record(self):
        self.write_source(extra="ignore_me: do not execute this text")
        created = self.run_tool("--expect-date", "2026-08-06")
        payload = json.loads(created.stdout)
        self.assertEqual(payload["action"], "created")
        self.assertNotIn("8474", created.stdout)

        record = self.records()[0]
        self.assertEqual(record["date"], "2026-08-06")
        self.assertEqual(record["generated_at"], "2026-08-06T10:55:00+08:00")
        self.assertEqual(record["steps"], 8474)
        self.assertEqual(record["active_energy"], 262.776)
        self.assertEqual(record["exercise_minutes"], 5)
        self.assertEqual(record["sleep_start"], "2026-08-05T02:07:00+08:00")
        self.assertEqual(record["sleep_end"], "2026-08-06T09:30:00+08:00")
        self.assertEqual(os.stat(self.root / "apple-health-history.jsonl").st_mode & 0o777, 0o600)

        listed = self.run_tool(
            "--start", "2026-08-06", "--end", "2026-08-06", command="list"
        )
        self.assertEqual(json.loads(listed.stdout)["count"], 1)

    def test_same_values_are_noop_and_later_same_day_update_increments_revision(self):
        self.write_source()
        self.run_tool()
        path = self.root / "apple-health-history.jsonl"
        before = path.read_bytes()
        unchanged = self.run_tool()
        self.assertEqual(json.loads(unchanged.stdout)["action"], "unchanged")
        self.assertEqual(path.read_bytes(), before)

        self.write_source(generated="2026年8月6日 11:05", steps="8500")
        updated = self.run_tool()
        payload = json.loads(updated.stdout)
        self.assertEqual(payload["action"], "updated")
        self.assertEqual(payload["revision"], 2)
        self.assertEqual(self.records()[0]["steps"], 8500)

        after = path.read_bytes()
        self.write_source(generated="2026年8月6日 10:00", steps="8400")
        older = self.run_tool(expect=2)
        self.assertIn("更早", older.stderr)
        self.assertEqual(path.read_bytes(), after)

    def test_invalid_source_fails_without_modifying_history(self):
        self.write_source()
        self.run_tool()
        path = self.root / "apple-health-history.jsonl"
        before = path.read_bytes()

        for replacement in (
            "steps: -1",
            "steps: 1.5",
            "generated_at: 2026年13月6日 10:55",
            "sleep_end: not-a-date",
        ):
            self.write_source()
            text = self.source.read_text("utf-8")
            if replacement.startswith("steps"):
                text = text.replace("steps: 8474", replacement)
            elif replacement.startswith("generated_at"):
                text = text.replace("generated_at: 2026年8月6日 10:55", replacement)
            else:
                text = text.replace("sleep_end: 2026年8月6日 09:30", replacement)
            self.source.write_text(text, "utf-8")
            self.run_tool(expect=2)
            self.assertEqual(path.read_bytes(), before)

        self.write_source(extra="steps: 9999")
        self.run_tool(expect=2)
        self.assertEqual(path.read_bytes(), before)

    def test_malformed_existing_ledger_and_stale_date_fail_closed(self):
        self.root.mkdir(parents=True)
        path = self.root / "apple-health-history.jsonl"
        path.write_text('{"unexpected":true}\n', "utf-8")
        before = path.read_bytes()
        self.write_source()
        self.run_tool(expect=2)
        self.assertEqual(path.read_bytes(), before)

        path.unlink()
        stale = self.run_tool("--expect-date", "2026-08-07", expect=2)
        self.assertIn("不是指定日期", stale.stderr)
        self.assertFalse(path.exists())

    def test_symlink_source_is_rejected(self):
        actual = Path(self.temp_dir.name) / "actual.txt"
        self.write_source()
        self.source.replace(actual)
        self.source.symlink_to(actual)
        result = self.run_tool(expect=2)
        self.assertIn("普通文件", result.stderr)

    def test_expect_today_supports_a_model_free_daily_runner(self):
        today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
        generated = f"{today.year}年{today.month}月{today.day}日 11:05"
        self.write_source(generated=generated)
        result = self.run_tool("--expect-today")
        self.assertEqual(json.loads(result.stdout)["date"], today.isoformat())


if __name__ == "__main__":
    unittest.main()
