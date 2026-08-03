import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parent / "apple_health_sleep.py"


def summary(start="2026年8月2日 03:48", end="2026年8月3日 09:30"):
    return "\n".join([
        "generated_at: 2026年8月3日 10:55",
        "steps: 4924",
        "active_energy: 154.912",
        "exercise_minutes:",
        f"sleep_start: {start}",
        f"sleep_end: {end}",
    ])


DETAILS = "\n".join([
    "核心睡眠2026年8月2日 03:482026年8月2日 04:09",
    "核心睡眠2026年8月2日 07:512026年8月2日 08:54",
    "核心睡眠2026年8月3日 00:292026年8月3日 01:31",
    "清醒时间2026年8月3日 01:312026年8月3日 01:33",
    "核心睡眠2026年8月3日 01:332026年8月3日 09:07",
    "快速动眼睡眠2026年8月3日 09:072026年8月3日 09:30",
    "快速动眼睡眠2026年8月3日 09:072026年8月3日 09:30",
])


class AppleHealthSleepTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.summary = self.root / "summary.txt"
        self.details = self.root / "details.txt"

    def tearDown(self):
        self.temp_dir.cleanup()

    def run_tool(self, *args, expect=0):
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "resolve",
                "--date",
                "2026-08-03",
                "--summary",
                str(self.summary),
                "--details",
                str(self.details),
                *args,
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, expect, result.stderr)
        return json.loads(result.stdout) if result.stdout else result

    def test_invalid_cross_day_summary_falls_back_to_deduplicated_details(self):
        self.summary.write_text(summary(), "utf-8")
        self.details.write_text(DETAILS, "utf-8")
        result = self.run_tool(
            "--sleep-time", "01:00", "--sleep-precision", "approximate",
            "--wake-time", "09:30", "--wake-precision", "approximate",
            "--out-of-bed-time", "10:00",
        )
        self.assertEqual(result["device_selection"], "details")
        self.assertEqual(result["sleep_time"]["resolved_time"], "00:29")
        self.assertEqual(result["sleep_time"]["delta_minutes"], 31)
        self.assertEqual(result["wake_time"]["resolved_time"], "09:30")
        self.assertEqual(result["out_of_bed_time"]["resolved_time"], "10:00")
        self.assertEqual(result["confirmation_required"], [])

    def test_valid_summary_is_preferred(self):
        self.summary.write_text(
            summary("2026年8月3日 00:35", "2026年8月3日 09:25"), "utf-8"
        )
        self.details.write_text(DETAILS, "utf-8")
        result = self.run_tool()
        self.assertEqual(result["device_selection"], "summary")
        self.assertEqual(result["sleep_time"]["resolved_time"], "00:35")
        self.assertEqual(result["wake_time"]["resolved_time"], "09:25")

    def test_thresholds_and_exact_user_priority(self):
        self.summary.write_text(
            summary("2026年8月3日 01:00", "2026年8月3日 09:00"), "utf-8"
        )
        self.details.write_text("", "utf-8")

        within = self.run_tool(
            "--sleep-time", "02:00", "--sleep-precision", "approximate"
        )
        self.assertEqual(within["sleep_time"]["decision"], "device_within_60_minutes")
        self.assertEqual(within["sleep_time"]["resolved_time"], "01:00")

        middle = self.run_tool(
            "--sleep-time", "02:01", "--sleep-precision", "approximate"
        )
        self.assertEqual(middle["sleep_time"]["decision"], "user_61_to_119_minutes")
        self.assertEqual(middle["sleep_time"]["resolved_time"], "02:01")

        conflict = self.run_tool(
            "--sleep-time", "03:00", "--sleep-precision", "approximate"
        )
        self.assertEqual(conflict["sleep_time"]["decision"], "confirmation_required")
        self.assertIsNone(conflict["sleep_time"]["resolved_time"])
        self.assertEqual(conflict["confirmation_required"], ["sleep_time"])

        exact = self.run_tool(
            "--sleep-time", "03:00", "--sleep-precision", "exact"
        )
        self.assertEqual(exact["sleep_time"]["decision"], "user_exact")
        self.assertEqual(exact["sleep_time"]["resolved_time"], "03:00")

        preferred = self.run_tool(
            "--sleep-time", "03:00", "--sleep-precision", "approximate",
            "--sleep-user-priority",
        )
        self.assertEqual(preferred["sleep_time"]["decision"], "user_priority")
        self.assertEqual(preferred["sleep_time"]["resolved_time"], "03:00")

    def test_missing_details_safely_keeps_user_and_never_derives_out_of_bed(self):
        self.summary.write_text("invalid", "utf-8")
        result = self.run_tool(
            "--sleep-time", "01:00", "--sleep-precision", "approximate",
            "--wake-time", "09:30", "--wake-precision", "approximate",
        )
        self.assertEqual(result["device_selection"], "none")
        self.assertEqual(result["sleep_time"]["resolved_time"], "01:00")
        self.assertEqual(result["wake_time"]["resolved_time"], "09:30")
        self.assertIsNone(result["out_of_bed_time"]["resolved_time"])

    def test_one_invalid_summary_endpoint_does_not_discard_the_other(self):
        self.summary.write_text(
            summary("not-a-date", "2026年8月3日 09:30"), "utf-8"
        )
        self.details.write_text("", "utf-8")
        result = self.run_tool(
            "--sleep-time", "01:00", "--sleep-precision", "approximate",
            "--wake-time", "09:00", "--wake-precision", "approximate",
        )
        self.assertEqual(result["device_selection"], "summary_partial")
        self.assertEqual(result["sleep_time"]["decision"], "user_only")
        self.assertEqual(result["sleep_time"]["resolved_time"], "01:00")
        self.assertEqual(result["wake_time"]["resolved_time"], "09:30")
        self.assertEqual(result["wake_time"]["source"], "apple_health_summary")


if __name__ == "__main__":
    unittest.main()
