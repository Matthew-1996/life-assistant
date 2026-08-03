import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parent / "weekly_review.py"
MISSING = object()


class WeeklyReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name) / "records"

    def tearDown(self):
        self.temp_dir.cleanup()

    @property
    def data_path(self):
        return self.root / "weekly-reviews.jsonl"

    def run_tool(
        self,
        command,
        *args,
        payload=MISSING,
        raw_input=None,
        expect=0,
    ):
        if payload is not MISSING and raw_input is not None:
            raise AssertionError("payload 和 raw_input 不能同时使用")
        if payload is not MISSING:
            raw_input = json.dumps(payload, ensure_ascii=False)
        result = subprocess.run(
            [sys.executable, str(SCRIPT), command, "--root", str(self.root), *args],
            input=raw_input,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, expect, result.stderr)
        return result

    def upsert(self, week_start, payload, *extra, expect=0):
        return self.run_tool(
            "upsert",
            "--week-start",
            week_start,
            "--input",
            "-",
            *extra,
            payload=payload,
            expect=expect,
        )

    def records(self):
        return [
            json.loads(line)
            for line in self.data_path.read_text("utf-8").splitlines()
            if line.strip()
        ]

    def test_partial_create_uses_canonical_natural_week_and_does_not_echo_content(self):
        private_summary = "早上比上周更容易离床"
        result = self.upsert(
            "2026-08-03",
            {
                "better_summary": private_summary,
                "goal_intent": "continue",
            },
        )
        output = json.loads(result.stdout)
        self.assertEqual(output["action"], "created")
        self.assertEqual(output["key"], "weekly-review:2026-W32")
        self.assertEqual(output["iso_week"], "2026-W32")
        self.assertEqual(output["week_start"], "2026-08-03")
        self.assertEqual(output["week_end"], "2026-08-09")
        self.assertEqual(output["revision"], 1)
        self.assertEqual(
            output["fields_updated"],
            ["answers.better_summary", "answers.goal_intent"],
        )
        self.assertTrue(output["workbook_sync_required"])
        self.assertNotIn(private_summary, result.stdout + result.stderr)

        records = self.records()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["answers"]["better_summary"], private_summary)
        self.assertEqual(records[0]["answers"]["goal_intent"], "continue")
        self.assertIsNone(records[0]["answers"]["friction_summary"])
        self.assertIsNone(records[0]["answers"]["experiment_summary"])
        self.assertIsNone(records[0]["answers"]["stop_summary"])
        self.assertEqual(stat.S_IMODE(self.data_path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.root / ".weekly-reviews.lock").stat().st_mode), 0o600)

    def test_cross_year_week_uses_iso_year_and_records_are_sorted(self):
        self.upsert("2026-08-03", {"better_summary": "夏天开始恢复"})
        result = self.upsert("2025-12-29", {"friction_summary": "跨年安排较多"})
        output = json.loads(result.stdout)
        self.assertEqual(output["key"], "weekly-review:2026-W01")
        self.assertEqual(output["iso_week"], "2026-W01")
        self.assertEqual(output["week_end"], "2026-01-04")
        self.assertEqual(
            [record["week_start"] for record in self.records()],
            ["2025-12-29", "2026-08-03"],
        )

    def test_rejects_non_monday_invalid_dates_and_negative_expected_revision(self):
        for date_value in ("2026-08-02", "2026-02-30", "2026-8-3"):
            with self.subTest(date=date_value):
                result = self.upsert(
                    date_value,
                    {"better_summary": "测试"},
                    expect=2,
                )
                self.assertFalse(self.data_path.exists())
                self.assertIn("week-start", result.stderr)

        result = self.upsert(
            "2026-08-03",
            {"better_summary": "测试"},
            "--expect-revision",
            "-1",
            expect=2,
        )
        self.assertIn("非负", result.stderr)
        self.assertFalse(self.data_path.exists())

    def test_idempotent_noop_preserves_bytes_mtime_revision_then_partial_merge(self):
        first = self.upsert("2026-08-03", {"better_summary": "出门后轻松一点"})
        self.assertEqual(json.loads(first.stdout)["action"], "created")
        original_bytes = self.data_path.read_bytes()
        original_mtime = self.data_path.stat().st_mtime_ns
        original_record = self.records()[0]

        unchanged = self.upsert("2026-08-03", {"better_summary": "出门后轻松一点"})
        unchanged_payload = json.loads(unchanged.stdout)
        self.assertEqual(unchanged_payload["action"], "unchanged")
        self.assertEqual(unchanged_payload["revision"], 1)
        self.assertEqual(unchanged_payload["fields_updated"], [])
        self.assertEqual(self.data_path.read_bytes(), original_bytes)
        self.assertEqual(self.data_path.stat().st_mtime_ns, original_mtime)

        updated = self.upsert(
            "2026-08-03",
            {"experiment_summary": "午后散步十分钟，一周两次"},
            "--expect-revision",
            "1",
        )
        self.assertEqual(json.loads(updated.stdout)["action"], "updated")
        record = self.records()[0]
        self.assertEqual(record["revision"], 2)
        self.assertEqual(record["answers"]["better_summary"], "出门后轻松一点")
        self.assertEqual(record["answers"]["experiment_summary"], "午后散步十分钟，一周两次")
        self.assertEqual(record["created_at"], original_record["created_at"])

        before_conflict = self.data_path.read_bytes()
        conflict = self.upsert(
            "2026-08-03",
            {"stop_summary": "减少临睡前工作"},
            "--expect-revision",
            "1",
            expect=2,
        )
        self.assertIn("修订冲突", conflict.stderr)
        self.assertEqual(self.data_path.read_bytes(), before_conflict)

    def test_input_is_strict_subset_and_null_never_means_clear(self):
        cases = [
            ("", "需要从 stdin"),
            ("[]", "JSON 对象"),
            ('{"raw_transcript":"不应保存"}', "字段集无效"),
            ('{"better_summary":null}', "null 不是清空"),
            ('{"better_summary":"   "}', "不能为空"),
            ('{"goal_intent":"keep-going"}', "明确枚举值"),
            ('{"better_summary":"甲","better_summary":"乙"}', "重复字段"),
            ('{"better_summary":NaN}', "NaN"),
            (json.dumps({"better_summary": "字" * 161}, ensure_ascii=False), "160"),
        ]
        for raw_input, expected_message in cases:
            with self.subTest(raw_input=raw_input[:30]):
                result = self.run_tool(
                    "upsert",
                    "--week-start",
                    "2026-08-03",
                    "--input",
                    "-",
                    raw_input=raw_input,
                    expect=2,
                )
                self.assertIn(expected_message, result.stderr)
                self.assertFalse(self.data_path.exists())

        oversized = self.run_tool(
            "upsert",
            "--week-start",
            "2026-08-03",
            "--input",
            "-",
            raw_input="x" * 8193,
            expect=2,
        )
        self.assertIn("8192", oversized.stderr)
        self.assertFalse(self.data_path.exists())

    def test_high_confidence_secrets_are_redacted_without_echo(self):
        secrets = [
            "s" + "k-abcdefghijklmnopqrstuvwx",
            "person@example.com",
            "13812345678",
            "11010519491231002X",
            "6222021234567890123",
        ]
        summary = "本周材料里误含 " + " ".join(secrets)
        result = self.upsert("2026-08-03", {"friction_summary": summary})
        persisted = self.data_path.read_text("utf-8")
        for secret in secrets:
            self.assertNotIn(secret, persisted)
            self.assertNotIn(secret, result.stdout)
            self.assertNotIn(secret, result.stderr)
        self.assertIn("敏感信息已省略", persisted)

    def test_concurrent_distinct_fields_merge_into_one_week(self):
        values = {
            "better_summary": "下午稍有精神",
            "friction_summary": "工作收尾反复打断休息",
            "experiment_summary": "午后散步十分钟",
            "goal_intent": "continue",
        }
        processes = []
        for field, value in values.items():
            process = subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "upsert",
                    "--root",
                    str(self.root),
                    "--week-start",
                    "2026-08-03",
                    "--input",
                    "-",
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            processes.append((process, json.dumps({field: value}, ensure_ascii=False)))

        for process, body in processes:
            stdout, stderr = process.communicate(body, timeout=20)
            self.assertEqual(process.returncode, 0, f"{stdout}\n{stderr}")

        records = self.records()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["revision"], 4)
        for field, value in values.items():
            self.assertEqual(records[0]["answers"][field], value)

    def test_concurrent_same_revision_allows_exactly_one_writer(self):
        self.upsert("2026-08-03", {"better_summary": "已有回答"})
        processes = []
        for value in ("摩擦版本甲", "摩擦版本乙"):
            process = subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "upsert",
                    "--root",
                    str(self.root),
                    "--week-start",
                    "2026-08-03",
                    "--input",
                    "-",
                    "--expect-revision",
                    "1",
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            processes.append((process, json.dumps({"friction_summary": value}, ensure_ascii=False)))

        results = [process.communicate(body, timeout=20) for process, body in processes]
        return_codes = [process.returncode for process, _ in processes]
        self.assertEqual(sorted(return_codes), [0, 2], results)
        failed_index = return_codes.index(2)
        self.assertIn("修订冲突", results[failed_index][1])
        record = self.records()[0]
        self.assertEqual(record["revision"], 2)
        self.assertIn(record["answers"]["friction_summary"], ("摩擦版本甲", "摩擦版本乙"))

    def test_existing_corruption_duplicate_weeks_and_invalid_utf8_fail_closed(self):
        self.upsert("2026-08-03", {"better_summary": "原始有效回答"})
        original_record = self.records()[0]

        corruptions = []
        unknown = dict(original_record)
        unknown["raw_transcript"] = "不应存在"
        corruptions.append(json.dumps(unknown, ensure_ascii=False) + "\n")

        bool_revision = dict(original_record)
        bool_revision["revision"] = True
        corruptions.append(json.dumps(bool_revision, ensure_ascii=False) + "\n")

        wrong_end = dict(original_record)
        wrong_end["week_end"] = "2026-08-10"
        corruptions.append(json.dumps(wrong_end, ensure_ascii=False) + "\n")

        empty_answers = json.loads(json.dumps(original_record, ensure_ascii=False))
        empty_answers["answers"] = {field: None for field in empty_answers["answers"]}
        corruptions.append(json.dumps(empty_answers, ensure_ascii=False) + "\n")

        nested_duplicate = json.dumps(original_record, ensure_ascii=False)
        nested_duplicate = nested_duplicate.replace(
            '"better_summary": "原始有效回答"',
            '"better_summary": "原始有效回答", "better_summary": "冲突值"',
        )
        corruptions.append(nested_duplicate + "\n")

        duplicate_line = json.dumps(original_record, ensure_ascii=False) + "\n"
        corruptions.append(duplicate_line + duplicate_line)

        for corrupted in corruptions:
            with self.subTest(corrupted=corrupted[:50]):
                self.data_path.write_text(corrupted, "utf-8")
                before = self.data_path.read_bytes()
                result = self.upsert(
                    "2026-08-03",
                    {"friction_summary": "新回答"},
                    expect=2,
                )
                self.assertEqual(self.data_path.read_bytes(), before)
                self.assertNotIn("原始有效回答", result.stdout + result.stderr)

        self.data_path.write_bytes(b"\xff\xfe\x00")
        before = self.data_path.read_bytes()
        result = self.upsert(
            "2026-08-03",
            {"friction_summary": "新回答"},
            expect=2,
        )
        self.assertIn("UTF-8", result.stderr)
        self.assertEqual(self.data_path.read_bytes(), before)

    def test_clear_field_requires_revision_is_exact_and_cannot_make_empty_record(self):
        self.upsert(
            "2026-08-03",
            {
                "better_summary": "睡前更容易停下工作",
                "friction_summary": "会议挤压午休",
            },
        )
        original = self.data_path.read_bytes()

        missing_revision = self.run_tool(
            "upsert",
            "--week-start",
            "2026-08-03",
            "--input",
            "-",
            "--clear-field",
            "friction_summary",
            payload={},
            expect=2,
        )
        self.assertIn("expect-revision", missing_revision.stderr)
        self.assertEqual(self.data_path.read_bytes(), original)

        overlap = self.run_tool(
            "upsert",
            "--week-start",
            "2026-08-03",
            "--input",
            "-",
            "--clear-field",
            "friction_summary",
            "--expect-revision",
            "1",
            payload={"friction_summary": "替代值"},
            expect=2,
        )
        self.assertIn("同时更新和清空", overlap.stderr)
        self.assertEqual(self.data_path.read_bytes(), original)

        cleared = self.run_tool(
            "upsert",
            "--week-start",
            "2026-08-03",
            "--input",
            "-",
            "--clear-field",
            "friction_summary",
            "--expect-revision",
            "1",
            payload={},
        )
        output = json.loads(cleared.stdout)
        self.assertEqual(output["action"], "updated")
        self.assertEqual(output["fields_cleared"], ["answers.friction_summary"])
        self.assertTrue(output["historical_copies_not_deleted"])
        record = self.records()[0]
        self.assertEqual(record["revision"], 2)
        self.assertIsNone(record["answers"]["friction_summary"])
        self.assertEqual(record["answers"]["better_summary"], "睡前更容易停下工作")

        before_last_clear = self.data_path.read_bytes()
        last_clear = self.run_tool(
            "upsert",
            "--week-start",
            "2026-08-03",
            "--input",
            "-",
            "--clear-field",
            "better_summary",
            "--expect-revision",
            "2",
            payload={},
            expect=2,
        )
        self.assertIn("purge-plan/purge", last_clear.stderr)
        self.assertEqual(self.data_path.read_bytes(), before_last_clear)

    def test_purge_is_content_private_conflict_safe_and_retryable(self):
        private_summary = "这段复盘内容不能出现在删除预览或回执里"
        self.upsert("2026-08-03", {"friction_summary": private_summary})
        self.upsert("2026-08-10", {"better_summary": "另一周应保留"})
        before = self.data_path.read_bytes()

        plan = self.run_tool("purge-plan", "--week-start", "2026-08-03")
        plan_payload = json.loads(plan.stdout)
        self.assertEqual(plan_payload["action"], "purge_plan")
        self.assertTrue(plan_payload["exists"])
        self.assertEqual(plan_payload["revision"], 1)
        self.assertEqual(plan_payload["required_confirmation"], "weekly-review:2026-W32")
        self.assertRegex(plan_payload["record_etag"], r"^[0-9a-f]{64}$")
        self.assertNotIn(private_summary, plan.stdout + plan.stderr)
        self.assertEqual(self.data_path.read_bytes(), before)

        common = [
            "--week-start",
            "2026-08-03",
            "--confirm",
            "weekly-review:2026-W32",
            "--expect-revision",
            "1",
            "--expect-record-etag",
            plan_payload["record_etag"],
        ]
        missing_ack = self.run_tool("purge", *common, expect=2)
        self.assertIn("历史", missing_ack.stderr)
        self.assertEqual(self.data_path.read_bytes(), before)

        wrong_confirm = list(common)
        wrong_confirm[wrong_confirm.index("weekly-review:2026-W32")] = "weekly-review:2026-W33"
        result = self.run_tool(
            "purge", *wrong_confirm, "--acknowledge-historical-copies", expect=2
        )
        self.assertIn("完全一致", result.stderr)
        self.assertEqual(self.data_path.read_bytes(), before)

        wrong_revision = list(common)
        wrong_revision[wrong_revision.index("1")] = "2"
        result = self.run_tool(
            "purge", *wrong_revision, "--acknowledge-historical-copies", expect=2
        )
        self.assertIn("修订冲突", result.stderr)
        self.assertEqual(self.data_path.read_bytes(), before)

        wrong_etag = list(common)
        wrong_etag[-1] = "0" * 64
        result = self.run_tool(
            "purge", *wrong_etag, "--acknowledge-historical-copies", expect=2
        )
        self.assertIn("删除预览后发生变化", result.stderr)
        self.assertEqual(self.data_path.read_bytes(), before)

        self.upsert("2026-08-03", {"goal_intent": "adjust"})
        stale = self.run_tool(
            "purge", *common, "--acknowledge-historical-copies", expect=2
        )
        self.assertIn("修订冲突", stale.stderr)

        fresh_plan = json.loads(
            self.run_tool("purge-plan", "--week-start", "2026-08-03").stdout
        )
        fresh_args = [
            "--week-start",
            "2026-08-03",
            "--confirm",
            "weekly-review:2026-W32",
            "--expect-revision",
            str(fresh_plan["revision"]),
            "--expect-record-etag",
            fresh_plan["record_etag"],
            "--acknowledge-historical-copies",
        ]
        purged = self.run_tool("purge", *fresh_args)
        purged_payload = json.loads(purged.stdout)
        self.assertEqual(purged_payload["action"], "purged")
        self.assertTrue(purged_payload["historical_copies_not_deleted"])
        self.assertTrue(purged_payload["journal_daily_goals_not_deleted"])
        self.assertNotIn(private_summary, purged.stdout + purged.stderr)
        remaining = self.records()
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]["key"], "weekly-review:2026-W33")

        second_plan = json.loads(
            self.run_tool("purge-plan", "--week-start", "2026-08-10").stdout
        )
        second_args = [
            "--week-start",
            "2026-08-10",
            "--confirm",
            "weekly-review:2026-W33",
            "--expect-revision",
            str(second_plan["revision"]),
            "--expect-record-etag",
            second_plan["record_etag"],
            "--acknowledge-historical-copies",
        ]
        second_purge = self.run_tool("purge", *second_args)
        self.assertEqual(json.loads(second_purge.stdout)["action"], "purged")
        self.assertEqual(self.data_path.read_bytes(), b"")

        retry = self.run_tool("purge", *second_args)
        retry_payload = json.loads(retry.stdout)
        self.assertEqual(retry_payload["action"], "already_absent")
        self.assertTrue(retry_payload["workbook_sync_required"])


if __name__ == "__main__":
    unittest.main()
