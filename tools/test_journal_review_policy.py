#!/usr/bin/env python3
"""Standard-library tests for journal_review_policy.py."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("journal_review_policy.py")


class JournalReviewPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "journal"
        self.root.mkdir()
        self.path = self.root / "review-policy.json"
        self.policy = {
            "schema_version": 1,
            "timezone": "Asia/Shanghai",
            "trial_weekly_start": "2026-08-02",
            "trial_weekly_end": "2026-08-14",
            "long_term_cadence": "pending_user_choice",
            "long_term_effective_from": None,
            "decided_on": None,
        }
        self._write(self.policy)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _write(self, payload: object) -> None:
        self.path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def _run(self, *args: str, expected: int = 0) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(self.root), *args],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def test_show_reads_pending_policy_without_writing(self) -> None:
        before = self.path.read_bytes()
        result = self._run("show")
        self.assertEqual(json.loads(result.stdout)["policy"], self.policy)
        self.assertEqual(self.path.read_bytes(), before)

    def test_explicit_selection_updates_atomically_and_is_idempotent(self) -> None:
        args = (
            "set",
            "--cadence",
            "weekly",
            "--effective-from",
            "2026-08-15",
            "--decided-on",
            "2026-08-14",
            "--expect-current",
            "pending_user_choice",
        )
        result = self._run(*args)
        self.assertEqual(json.loads(result.stdout)["action"], "updated")
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        saved = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(saved["long_term_cadence"], "weekly")

        retry = self._run(
            "set",
            "--cadence",
            "weekly",
            "--effective-from",
            "2026-08-15",
            "--decided-on",
            "2026-08-14",
            "--expect-current",
            "weekly",
        )
        self.assertEqual(json.loads(retry.stdout)["action"], "unchanged")

    def test_all_selected_cadences_are_supported(self) -> None:
        for cadence in ("weekly", "monthly", "on_demand", "paused"):
            with self.subTest(cadence=cadence):
                self._write(self.policy)
                result = self._run(
                    "set",
                    "--cadence",
                    cadence,
                    "--effective-from",
                    "2026-08-15",
                    "--decided-on",
                    "2026-08-14",
                    "--expect-current",
                    "pending_user_choice",
                )
                self.assertEqual(json.loads(result.stdout)["long_term_cadence"], cadence)

    def test_stale_expectation_and_invalid_dates_fail_without_change(self) -> None:
        before = self.path.read_bytes()
        stale = self._run(
            "set",
            "--cadence",
            "monthly",
            "--effective-from",
            "2026-08-15",
            "--decided-on",
            "2026-08-14",
            "--expect-current",
            "weekly",
            expected=2,
        )
        self.assertIn("发生变化", stale.stderr)
        self.assertEqual(self.path.read_bytes(), before)

        invalid = self._run(
            "set",
            "--cadence",
            "monthly",
            "--effective-from",
            "2026-08-14",
            "--decided-on",
            "2026-08-15",
            "--expect-current",
            "pending_user_choice",
            expected=2,
        )
        self.assertIn("日期无效", invalid.stderr)
        self.assertEqual(self.path.read_bytes(), before)

    def test_duplicate_keys_nan_extra_fields_and_symlink_fail_closed(self) -> None:
        invalid_texts = (
            '{"schema_version":1,"schema_version":1}',
            '{"schema_version":NaN}',
            json.dumps({**self.policy, "raw": "PRIVATE-POLICY-SENTINEL"}),
        )
        for text in invalid_texts:
            with self.subTest(text=text[:30]):
                self.path.write_text(text, encoding="utf-8")
                result = self._run("show", expected=2)
                self.assertNotIn("PRIVATE-POLICY-SENTINEL", result.stdout + result.stderr)

        self.path.unlink()
        outside = self.root.parent / "outside.json"
        outside.write_text(json.dumps(self.policy), encoding="utf-8")
        self.path.symlink_to(outside)
        result = self._run("show", expected=2)
        self.assertIn("不是普通项目文件", result.stderr)

    def test_unsafe_lock_path_fails_closed(self) -> None:
        outside = self.root.parent / "outside.lock"
        outside.write_text("", encoding="utf-8")
        (self.root / ".journal.lock").symlink_to(outside)
        result = self._run(
            "set",
            "--cadence",
            "on_demand",
            "--effective-from",
            "2026-08-15",
            "--decided-on",
            "2026-08-14",
            "--expect-current",
            "pending_user_choice",
            expected=2,
        )
        self.assertIn("写锁", result.stderr)


if __name__ == "__main__":
    unittest.main()
