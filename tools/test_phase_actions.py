import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


TOOLS = Path(__file__).resolve().parent
PHASE_SCRIPT = TOOLS / "phase_review.py"
ACTIONS_SCRIPT = TOOLS / "phase_actions.py"
MISSING = object()

SPEC = importlib.util.spec_from_file_location("phase_actions_under_test", ACTIONS_SCRIPT)
assert SPEC and SPEC.loader
PHASE_ACTIONS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PHASE_ACTIONS)


class PhaseActionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base = Path(self.temp_dir.name)
        self.root = self.base / "records"

    def tearDown(self):
        self.temp_dir.cleanup()

    @property
    def phase_path(self):
        return self.root / "phase-reviews.jsonl"

    @property
    def action_path(self):
        return self.root / "phase-actions.jsonl"

    @property
    def action_lock_path(self):
        return self.root / ".phase-actions.lock"

    def run_process(self, script, command, *args, payload=MISSING, raw_input=None, expect=0):
        if payload is not MISSING and raw_input is not None:
            raise AssertionError("payload 和 raw_input 不能同时使用")
        if payload is not MISSING:
            raw_input = json.dumps(payload, ensure_ascii=False)
        result = subprocess.run(
            [sys.executable, "-B", str(script), command, "--root", str(self.root), *args],
            input=raw_input,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, expect, result.stderr)
        return result

    def phase_upsert(self, payload, review_date="2026-08-14"):
        return self.run_process(
            PHASE_SCRIPT,
            "upsert",
            "--review-date",
            review_date,
            "--input",
            "-",
            payload=payload,
        )

    def action_tool(self, command, *args, payload=MISSING, raw_input=None, expect=0):
        return self.run_process(
            ACTIONS_SCRIPT,
            command,
            *args,
            payload=payload,
            raw_input=raw_input,
            expect=expect,
        )

    def plan(self, review_date="2026-08-14", expect=0):
        return self.action_tool(
            "plan", "--review-date", review_date, expect=expect
        )

    def apply_plan(self, review_date="2026-08-14", expect=0):
        return self.action_tool(
            "apply-plan", "--review-date", review_date, expect=expect
        )

    def records(self):
        return [
            json.loads(line)
            for line in self.action_path.read_text("utf-8").splitlines()
            if line.strip()
        ]

    def mark_payload(self, action, state, failure_code=MISSING):
        payload = {
            "action_id": action["action_id"],
            "expect_revision": action["revision"],
            "expect_action_etag": action["action_etag"],
            "state": state,
        }
        if failure_code is not MISSING:
            payload["failure_code"] = failure_code
        return payload

    def test_no_source_plan_apply_plan_and_inspect_are_zero_write(self):
        plan = json.loads(self.plan().stdout)
        self.assertFalse(plan["source_exists"])
        self.assertEqual(plan["actions"], [])
        self.assertFalse(self.root.exists())

        before = self.base.stat().st_mtime_ns
        apply_payload = json.loads(self.apply_plan().stdout)
        self.assertTrue(apply_payload["read_only"])
        self.assertEqual(apply_payload["actions"], [])
        self.assertFalse(self.root.exists())
        self.assertEqual(self.base.stat().st_mtime_ns, before)

        expected = {
            "valid": True,
            "ledger_present": False,
            "permissions_ok": True,
            "record_count": 0,
            "state_counts": {state: 0 for state in PHASE_ACTIONS.ACTION_STATES},
            "category_counts": {
                category: 0 for category in PHASE_ACTIONS.ACTION_CATEGORIES
            },
            "category_state_counts": {
                category: {state: 0 for state in PHASE_ACTIONS.ACTION_STATES}
                for category in PHASE_ACTIONS.ACTION_CATEGORIES
            },
        }
        self.assertEqual(PHASE_ACTIONS.inspect_phase_actions(self.root), expected)

    def test_only_explicit_actionable_values_create_actions_with_exact_mapping(self):
        self.phase_upsert(
            {
                "goal_intent": "adjust",
                "journal_cadence": "monthly",
                "checkin_cadence": "weekly",
                "next_track": "career",
                "career_timing": "2026-08-31",
                "fitness_conversation": True,
                "life_experience_signal": "生活体验字段不应进入动作台账",
            }
        )
        private_summary = "生活体验字段不应进入动作台账"
        result = self.plan()
        payload = json.loads(result.stdout)
        self.assertEqual(payload["created_count"], 5)
        self.assertEqual(payload["pending_count"], 5)
        expected = {
            "goal_intent": ("adjust", "exact_change"),
            "journal_cadence": ("monthly", "exact_change"),
            "checkin_cadence": ("weekly", "schedule_details"),
            "next_track": ("career", "exact_change"),
            "career_timing": ("2026-08-31", "schedule_details"),
        }
        self.assertEqual(
            {
                item["category"]: (
                    item["desired_value"],
                    item["approval_requirement"],
                )
                for item in payload["actions"]
            },
            expected,
        )
        self.assertNotIn(private_summary, self.action_path.read_text("utf-8"))
        self.assertEqual(stat.S_IMODE(self.action_path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.action_lock_path.stat().st_mode), 0o600)
        self.assertTrue(payload["external_changes_applied"] is False)

    def test_unsure_undecided_neither_and_false_do_not_create_ledger(self):
        self.phase_upsert(
            {
                "goal_intent": "unsure",
                "journal_cadence": "undecided",
                "checkin_cadence": "undecided",
                "next_track": "neither",
                "career_timing": "undecided",
                "fitness_conversation": False,
            }
        )
        before_entries = tuple(sorted(path.name for path in self.root.iterdir()))
        payload = json.loads(self.plan().stdout)
        self.assertEqual(payload["pending_count"], 0)
        self.assertFalse(self.action_path.exists())
        self.assertFalse(self.action_lock_path.exists())
        self.assertEqual(
            tuple(sorted(path.name for path in self.root.iterdir())), before_entries
        )

    def test_next_track_is_an_exclusive_gate_for_dependent_branch_actions(self):
        self.phase_upsert(
            {
                "next_track": "fitness",
                "career_timing": "2026-08-31",
                "fitness_conversation": True,
            }
        )
        fitness_plan = json.loads(self.plan().stdout)
        self.assertEqual(
            {item["category"] for item in fitness_plan["actions"]},
            {"next_track", "fitness_conversation"},
        )

        self.phase_upsert({"next_track": "career"})
        career_plan = json.loads(self.plan().stdout)
        self.assertEqual(
            {item["category"] for item in career_plan["actions"]},
            {"next_track", "career_timing"},
        )
        self.assertNotIn(
            "fitness_conversation",
            {item["category"] for item in career_plan["actions"]},
        )

    def test_same_source_bytes_is_exactly_idempotent(self):
        self.phase_upsert({"goal_intent": "continue", "next_track": "fitness"})
        first = json.loads(self.plan().stdout)
        original_bytes = self.action_path.read_bytes()
        original_mtime = self.action_path.stat().st_mtime_ns
        original_records = self.records()
        second = json.loads(self.plan().stdout)
        self.assertEqual(second["ledger_action"], "unchanged")
        self.assertEqual(second["created_count"], 0)
        self.assertEqual(
            [item["action_id"] for item in first["actions"]],
            [item["action_id"] for item in second["actions"]],
        )
        self.assertEqual(self.action_path.read_bytes(), original_bytes)
        self.assertEqual(self.action_path.stat().st_mtime_ns, original_mtime)
        self.assertEqual(self.records(), original_records)

    def test_source_drift_supersedes_old_actions_and_creates_new_stable_ids(self):
        self.phase_upsert({"goal_intent": "adjust", "next_track": "fitness"})
        first = json.loads(self.plan().stdout)
        old_ids = {item["action_id"] for item in first["actions"]}
        self.phase_upsert({"next_track": "career"})
        second = json.loads(self.plan().stdout)
        self.assertEqual(second["superseded_count"], 2)
        self.assertEqual(second["created_count"], 2)
        new_ids = {item["action_id"] for item in second["actions"]}
        self.assertTrue(old_ids.isdisjoint(new_ids))
        old = [row for row in self.records() if row["action_id"] in old_ids]
        self.assertEqual({row["state"] for row in old}, {"superseded"})
        self.assertEqual({row["revision"] for row in old}, {2})

    def test_source_removal_supersedes_existing_actions_without_new_actions(self):
        self.phase_upsert({"goal_intent": "adjust"})
        self.plan()
        self.phase_path.write_bytes(b"")
        payload = json.loads(self.plan().stdout)
        self.assertFalse(payload["source_exists"])
        self.assertEqual(payload["created_count"], 0)
        self.assertEqual(payload["superseded_count"], 1)
        self.assertEqual(payload["actions"], [])
        self.assertEqual(self.records()[0]["state"], "superseded")

    def test_apply_plan_is_read_only_and_returns_pending_and_failed_for_resume(self):
        self.phase_upsert({"goal_intent": "adjust", "next_track": "career"})
        planned = json.loads(self.plan().stdout)
        before = self.action_path.read_bytes()
        before_mtime = self.action_path.stat().st_mtime_ns
        first_apply = json.loads(self.apply_plan().stdout)
        self.assertEqual(first_apply["retryable_count"], 2)
        self.assertEqual(self.action_path.read_bytes(), before)
        self.assertEqual(self.action_path.stat().st_mtime_ns, before_mtime)

        action = planned["actions"][0]
        self.action_tool(
            "mark",
            "--input",
            "-",
            payload=self.mark_payload(action, "failed", "temporary_error"),
        )
        resumed = json.loads(self.apply_plan().stdout)
        states = {item["category"]: item["state"] for item in resumed["actions"]}
        self.assertIn("failed", states.values())
        self.assertIn("pending", states.values())

    def test_mark_applied_is_precise_and_stale_retry_is_byte_idempotent(self):
        self.phase_upsert({"goal_intent": "adjust"})
        action = json.loads(self.plan().stdout)["actions"][0]
        mark_input = self.mark_payload(action, "applied")
        first = json.loads(
            self.action_tool("mark", "--input", "-", payload=mark_input).stdout
        )
        self.assertEqual(first["action"], "marked")
        self.assertEqual(first["state"], "applied")
        self.assertFalse(first["external_changes_applied_by_tool"])
        before = self.action_path.read_bytes()
        before_mtime = self.action_path.stat().st_mtime_ns
        retry = json.loads(
            self.action_tool("mark", "--input", "-", payload=mark_input).stdout
        )
        self.assertEqual(retry["action"], "unchanged")
        self.assertEqual(self.action_path.read_bytes(), before)
        self.assertEqual(self.action_path.stat().st_mtime_ns, before_mtime)

    def test_failed_can_be_retried_then_applied_with_current_cas(self):
        self.phase_upsert({"journal_cadence": "monthly"})
        action = json.loads(self.plan().stdout)["actions"][0]
        failed = json.loads(
            self.action_tool(
                "mark",
                "--input",
                "-",
                payload=self.mark_payload(action, "failed", "write_conflict"),
            ).stdout
        )
        self.assertEqual(failed["failure_code"], "write_conflict")
        applied_payload = {
            "action_id": failed["action_id"],
            "expect_revision": failed["revision"],
            "expect_action_etag": failed["action_etag"],
            "state": "applied",
        }
        applied = json.loads(
            self.action_tool("mark", "--input", "-", payload=applied_payload).stdout
        )
        self.assertEqual(applied["state"], "applied")
        self.assertIsNone(applied["failure_code"])

    def test_mark_rejects_stale_source_before_changing_action(self):
        self.phase_upsert({"goal_intent": "adjust"})
        action = json.loads(self.plan().stdout)["actions"][0]
        self.phase_upsert({"life_experience_signal": "来源变化"})
        before = self.action_path.read_bytes()
        result = self.action_tool(
            "mark",
            "--input",
            "-",
            payload=self.mark_payload(action, "applied"),
            expect=2,
        )
        self.assertIn("来源已变化", result.stderr)
        self.assertEqual(self.action_path.read_bytes(), before)

    def test_mark_input_is_strict_and_failure_code_is_generic(self):
        self.phase_upsert({"goal_intent": "adjust"})
        action = json.loads(self.plan().stdout)["actions"][0]
        cases = (
            ("", "需要从 stdin"),
            ("[]", "JSON 对象"),
            ("{}", "字段集无效"),
            ('{"action_id":"x","action_id":"y"}', "重复字段"),
            ('{"state":NaN}', "NaN"),
            (
                json.dumps(
                    {
                        **self.mark_payload(action, "failed", "bad code with detail"),
                    }
                ),
                "failure_code",
            ),
            (
                json.dumps(
                    {**self.mark_payload(action, "applied"), "failure_code": "x"}
                ),
                "只有 failed",
            ),
            (
                json.dumps({**self.mark_payload(action, "applied"), "raw": "secret"}),
                "字段集无效",
            ),
        )
        before = self.action_path.read_bytes()
        for raw, message in cases:
            with self.subTest(message=message):
                result = self.action_tool(
                    "mark", "--input", "-", raw_input=raw, expect=2
                )
                self.assertIn(message, result.stderr)
                self.assertEqual(self.action_path.read_bytes(), before)

    def test_public_list_status_and_inspect_return_only_safe_counts(self):
        private_value = "monthly"
        self.phase_upsert({"journal_cadence": private_value, "next_track": "career"})
        planned = json.loads(self.plan().stdout)
        self.action_tool(
            "mark",
            "--input",
            "-",
            payload=self.mark_payload(planned["actions"][0], "dismissed"),
        )
        for command in ("list", "status"):
            result = self.action_tool(command)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["record_count"], 2)
            serialized = result.stdout + result.stderr
            for forbidden in (
                private_value,
                "phase-action-",
                "2026-08-14",
                "source_record_etag",
                "desired_value",
            ):
                self.assertNotIn(forbidden, serialized)
        inspected = PHASE_ACTIONS.inspect_phase_actions(self.root)
        serialized = json.dumps(inspected, ensure_ascii=False)
        self.assertEqual(inspected["record_count"], 2)
        self.assertTrue(inspected["permissions_ok"])
        self.assertNotIn(private_value, serialized)
        self.assertNotIn("phase-action-", serialized)

    def test_snapshot_inspector_missing_empty_valid_and_private_corruption(self):
        empty = PHASE_ACTIONS.inspect_phase_action_snapshot({})
        self.assertFalse(empty["ledger_present"])
        self.assertIsNone(empty["permissions_ok"])
        present_empty = PHASE_ACTIONS.inspect_phase_action_snapshot(
            {"records/phase-actions.jsonl": b""}
        )
        self.assertTrue(present_empty["ledger_present"])
        self.assertEqual(present_empty["record_count"], 0)

        self.phase_upsert({"next_track": "fitness"})
        self.plan()
        valid = PHASE_ACTIONS.inspect_phase_action_snapshot(
            {"records/phase-actions.jsonl": self.action_path.read_bytes()}
        )
        self.assertEqual(valid["record_count"], 1)
        private_marker = "快照中的值不得泄漏"
        corrupt = (
            '{"schema_version":1,"desired_value":"'
            + private_marker
            + '"}\n'
        ).encode("utf-8")
        with self.assertRaises(PHASE_ACTIONS.PhaseActionError) as raised:
            PHASE_ACTIONS.inspect_phase_action_snapshot(
                {"records/phase-actions.jsonl": corrupt}
            )
        self.assertEqual(str(raised.exception), "阶段动作快照结构无效")
        self.assertNotIn(private_marker, str(raised.exception))
        self.assertIsNone(raised.exception.__cause__)

    def test_corrupt_ledger_fails_closed_without_value_or_path_leak(self):
        private_marker = "损坏台账中的私人内容"
        self.root.mkdir(parents=True)
        corruptions = (
            ('{"private":"' + private_marker + '"}\n').encode("utf-8"),
            b'{"schema_version":NaN}\n',
            b'{"x":1,"x":2}\n',
            b"\xff\xfe\x00",
        )
        for content in corruptions:
            with self.subTest(content=content[:20]):
                self.action_path.write_bytes(content)
                self.action_path.chmod(0o600)
                before = self.action_path.read_bytes()
                result = self.action_tool("status", expect=2)
                self.assertNotIn(private_marker, result.stdout + result.stderr)
                self.assertNotIn(str(self.action_path), result.stdout + result.stderr)
                self.assertEqual(self.action_path.read_bytes(), before)

    def test_data_symlink_and_hardlink_are_rejected_without_touching_target(self):
        self.root.mkdir(parents=True)
        outside = self.base / "outside-private"
        private_marker = "外部动作目标中的内容"
        outside.write_text(private_marker, "utf-8")
        outside.chmod(0o640)
        original = outside.read_bytes()
        original_mode = stat.S_IMODE(outside.stat().st_mode)

        self.action_path.symlink_to(outside)
        result = self.action_tool("status", expect=2)
        self.assertNotIn(private_marker, result.stdout + result.stderr)
        self.assertEqual(outside.read_bytes(), original)
        self.assertEqual(stat.S_IMODE(outside.stat().st_mode), original_mode)

        self.action_path.unlink()
        os.link(outside, self.action_path)
        result = self.action_tool("status", expect=2)
        self.assertNotIn(private_marker, result.stdout + result.stderr)
        self.assertEqual(outside.read_bytes(), original)
        self.assertEqual(stat.S_IMODE(outside.stat().st_mode), original_mode)

    def test_lock_symlink_and_hardlink_are_rejected_without_chmod_or_write(self):
        self.phase_upsert({"goal_intent": "adjust"})
        outside = self.base / "outside-lock"
        outside.write_text("private lock target", "utf-8")
        outside.chmod(0o640)
        original = outside.read_bytes()
        original_mode = stat.S_IMODE(outside.stat().st_mode)

        self.action_lock_path.symlink_to(outside)
        self.plan(expect=2)
        self.assertFalse(self.action_path.exists())
        self.assertEqual(outside.read_bytes(), original)
        self.assertEqual(stat.S_IMODE(outside.stat().st_mode), original_mode)

        self.action_lock_path.unlink()
        os.link(outside, self.action_lock_path)
        self.plan(expect=2)
        self.assertFalse(self.action_path.exists())
        self.assertEqual(outside.read_bytes(), original)
        self.assertEqual(stat.S_IMODE(outside.stat().st_mode), original_mode)

    def test_source_hardlink_and_root_symlink_are_rejected_privately(self):
        self.phase_upsert({"goal_intent": "adjust"})
        source_copy = self.base / "phase-source-copy"
        source_copy.write_bytes(self.phase_path.read_bytes())
        source_copy.chmod(0o600)
        self.phase_path.unlink()
        os.link(source_copy, self.phase_path)
        result = self.plan(expect=2)
        self.assertIn("阶段复盘来源", result.stderr)
        self.assertFalse(self.action_path.exists())

        # 使用另一入口验证 records 根目录符号链接不被跟随。
        outside_root = self.base / "outside-records"
        outside_root.mkdir()
        linked_root = self.base / "linked-records"
        linked_root.symlink_to(outside_root, target_is_directory=True)
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                str(ACTIONS_SCRIPT),
                "plan",
                "--root",
                str(linked_root),
                "--review-date",
                "2026-08-14",
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertNotIn(str(outside_root), result.stdout + result.stderr)
        self.assertFalse((outside_root / "phase-actions.jsonl").exists())

    def test_overpermissive_ledger_is_reported_and_mutations_refuse_it(self):
        self.phase_upsert({"goal_intent": "adjust"})
        self.plan()
        self.action_path.chmod(0o644)
        summary = PHASE_ACTIONS.inspect_phase_actions(self.root)
        self.assertFalse(summary["permissions_ok"])
        result = self.plan(expect=2)
        self.assertIn("0600", result.stderr)
        self.assertEqual(stat.S_IMODE(self.action_path.stat().st_mode), 0o644)

    def test_same_bytes_aba_is_detected_by_inode_identity(self):
        self.phase_upsert({"goal_intent": "adjust"})
        self.plan()
        with PHASE_ACTIONS._actions_lock(self.root) as context:
            original, identity, records = PHASE_ACTIONS._load_actions_locked(context)
            replacement = self.root / "replacement.tmp"
            replacement.write_bytes(original)
            replacement.chmod(0o600)
            replacement.replace(self.action_path)
            with self.assertRaises(PHASE_ACTIONS.PhaseActionError):
                PHASE_ACTIONS._atomic_replace_locked(
                    context,
                    original,
                    identity,
                    PHASE_ACTIONS._serialize_records(records),
                )
        self.assertEqual(self.action_path.read_bytes(), original)

    def test_concurrent_plan_creates_each_action_once(self):
        self.phase_upsert({"goal_intent": "adjust", "next_track": "career"})
        processes = [
            subprocess.Popen(
                [
                    sys.executable,
                    "-B",
                    str(ACTIONS_SCRIPT),
                    "plan",
                    "--root",
                    str(self.root),
                    "--review-date",
                    "2026-08-14",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            for _ in range(4)
        ]
        results = [process.communicate(timeout=20) for process in processes]
        self.assertEqual([process.returncode for process in processes], [0, 0, 0, 0], results)
        payloads = [json.loads(stdout) for stdout, _ in results]
        self.assertEqual(sum(item["created_count"] for item in payloads), 2)
        self.assertEqual(len(self.records()), 2)
        self.assertEqual(len({row["action_id"] for row in self.records()}), 2)

    def test_concurrent_same_mark_is_one_update_and_one_safe_replay(self):
        self.phase_upsert({"goal_intent": "adjust"})
        action = json.loads(self.plan().stdout)["actions"][0]
        body = json.dumps(self.mark_payload(action, "applied"), ensure_ascii=False)
        processes = [
            subprocess.Popen(
                [
                    sys.executable,
                    "-B",
                    str(ACTIONS_SCRIPT),
                    "mark",
                    "--root",
                    str(self.root),
                    "--input",
                    "-",
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            for _ in range(2)
        ]
        results = [process.communicate(body, timeout=20) for process in processes]
        self.assertEqual([process.returncode for process in processes], [0, 0], results)
        actions = sorted(json.loads(stdout)["action"] for stdout, _ in results)
        self.assertEqual(actions, ["marked", "unchanged"])
        record = self.records()[0]
        self.assertEqual(record["state"], "applied")
        self.assertEqual(record["revision"], 2)


if __name__ == "__main__":
    unittest.main()
