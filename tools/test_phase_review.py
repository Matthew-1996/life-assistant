import importlib.util
import json
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parent / "phase_review.py"
MISSING = object()
SPEC = importlib.util.spec_from_file_location("phase_review_under_test", SCRIPT)
assert SPEC and SPEC.loader
PHASE_REVIEW = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PHASE_REVIEW)


class PhaseReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name) / "records"

    def tearDown(self):
        self.temp_dir.cleanup()

    @property
    def data_path(self):
        return self.root / "phase-reviews.jsonl"

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

    def upsert(self, review_date, payload, *extra, expect=0):
        return self.run_tool(
            "upsert",
            "--review-date",
            review_date,
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

    def test_optional_source_and_partial_create_leave_missing_answers_null(self):
        empty = self.run_tool("list")
        empty_payload = json.loads(empty.stdout)
        self.assertEqual(empty_payload["count"], 0)
        self.assertEqual(empty_payload["records"], [])
        self.assertFalse(self.data_path.exists())

        private_summary = "这两周睡前更容易停下工作"
        result = self.upsert(
            "2026-08-14",
            {
                "recovery_change": private_summary,
                "life_experience_signal": "重新感到一点生活余量",
                "goal_intent": "continue",
                "checkin_experience": "helpful",
                "fitness_conversation": True,
            },
        )
        output = json.loads(result.stdout)
        self.assertEqual(output["action"], "created")
        self.assertEqual(output["key"], "phase-review:2026-08-14")
        self.assertEqual(output["review_date"], "2026-08-14")
        self.assertEqual(output["revision"], 1)
        self.assertTrue(output["planning_changes_not_applied"])
        self.assertNotIn(private_summary, result.stdout + result.stderr)

        record = self.records()[0]
        self.assertEqual(record["answers"]["recovery_change"], private_summary)
        self.assertEqual(
            record["answers"]["life_experience_signal"], "重新感到一点生活余量"
        )
        self.assertEqual(record["answers"]["goal_intent"], "continue")
        self.assertEqual(record["answers"]["checkin_experience"], "helpful")
        self.assertIs(record["answers"]["fitness_conversation"], True)
        for field in (
            "main_friction",
            "journal_cadence",
            "checkin_cadence",
            "next_track",
            "career_timing",
        ):
            self.assertIsNone(record["answers"][field])
        self.assertEqual(stat.S_IMODE(self.data_path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.root / ".phase-reviews.lock").stat().st_mode), 0o600)

    def test_idempotent_noop_preserves_bytes_mtime_revision_and_partial_merge(self):
        first = self.upsert(
            "2026-08-14",
            {"recovery_change": "晚上更能停下来", "journal_cadence": "undecided"},
        )
        self.assertEqual(json.loads(first.stdout)["action"], "created")
        original_bytes = self.data_path.read_bytes()
        original_mtime = self.data_path.stat().st_mtime_ns
        original_record = self.records()[0]

        unchanged = self.upsert(
            "2026-08-14",
            {"recovery_change": "晚上更能停下来", "journal_cadence": "undecided"},
        )
        unchanged_payload = json.loads(unchanged.stdout)
        self.assertEqual(unchanged_payload["action"], "unchanged")
        self.assertEqual(unchanged_payload["revision"], 1)
        self.assertEqual(unchanged_payload["fields_updated"], [])
        self.assertEqual(self.data_path.read_bytes(), original_bytes)
        self.assertEqual(self.data_path.stat().st_mtime_ns, original_mtime)

        updated = self.upsert(
            "2026-08-14",
            {"main_friction": "交接消息打断休息", "next_track": "fitness"},
            "--expect-revision",
            "1",
        )
        self.assertEqual(json.loads(updated.stdout)["action"], "updated")
        record = self.records()[0]
        self.assertEqual(record["revision"], 2)
        self.assertEqual(record["answers"]["recovery_change"], "晚上更能停下来")
        self.assertEqual(record["answers"]["journal_cadence"], "undecided")
        self.assertEqual(record["answers"]["main_friction"], "交接消息打断休息")
        self.assertEqual(record["answers"]["next_track"], "fitness")
        self.assertEqual(record["created_at"], original_record["created_at"])

        before_conflict = self.data_path.read_bytes()
        conflict = self.upsert(
            "2026-08-14",
            {"checkin_cadence": "weekly"},
            "--expect-revision",
            "1",
            expect=2,
        )
        self.assertIn("修订冲突", conflict.stderr)
        self.assertEqual(self.data_path.read_bytes(), before_conflict)

    def test_dates_are_strict_and_records_sort_by_review_date(self):
        for date_value in ("2026-02-30", "2026-8-14", "not-a-date"):
            with self.subTest(date=date_value):
                result = self.upsert(date_value, {"goal_intent": "unsure"}, expect=2)
                self.assertIn("review-date", result.stderr)
                self.assertFalse(self.data_path.exists())

        self.upsert("2026-08-14", {"goal_intent": "unsure"})
        self.upsert("2026-07-31", {"next_track": "undecided"})
        self.assertEqual(
            [record["review_date"] for record in self.records()],
            ["2026-07-31", "2026-08-14"],
        )

    def test_all_enum_values_and_boolean_values_are_accepted(self):
        enum_values = {
            "goal_intent": (
                "continue",
                "adjust",
                "downgrade",
                "pause",
                "complete",
                "replace",
                "unsure",
            ),
            "journal_cadence": (
                "weekly",
                "monthly",
                "on_demand",
                "paused",
                "undecided",
            ),
            "checkin_cadence": (
                "daily",
                "weekly",
                "on_demand",
                "paused",
                "undecided",
            ),
            "checkin_experience": (
                "helpful",
                "neutral",
                "disruptive",
                "undecided",
            ),
            "next_track": ("fitness", "career", "neither", "undecided"),
            "career_timing": ("now", "2026-08-31", "later", "undecided"),
        }
        revision = 0
        for field, values in enum_values.items():
            for value in values:
                revision += 1
                result = self.upsert(
                    "2026-08-14",
                    {field: value},
                    "--expect-revision",
                    str(revision - 1),
                )
                self.assertEqual(json.loads(result.stdout)["revision"], revision)
                self.assertEqual(self.records()[0]["answers"][field], value)

        true_result = self.upsert("2026-08-14", {"fitness_conversation": True})
        self.assertEqual(json.loads(true_result.stdout)["action"], "updated")
        false_result = self.upsert("2026-08-14", {"fitness_conversation": False})
        self.assertEqual(json.loads(false_result.stdout)["action"], "updated")
        self.assertIs(self.records()[0]["answers"]["fitness_conversation"], False)

    def test_input_is_strict_blank_and_null_is_never_a_clear_instruction(self):
        cases = [
            ("", "需要从 stdin"),
            ("[]", "JSON 对象"),
            ("{}", "至少提供"),
            ('{"raw_transcript":"不应保存"}', "字段集无效"),
            ('{"recovery_change":null}', "null 不是清空"),
            ('{"life_experience_signal":null}', "null 不是清空"),
            ('{"recovery_change":"   "}', "不能为空"),
            ('{"fitness_conversation":null}', "true 或 false"),
            ('{"fitness_conversation":1}', "true 或 false"),
            ('{"goal_intent":"keep-going"}', "明确枚举值"),
            ('{"journal_cadence":"daily"}', "明确枚举值"),
            ('{"checkin_cadence":"monthly"}', "明确枚举值"),
            ('{"checkin_experience":"good"}', "明确枚举值"),
            ('{"next_track":"sleep"}', "明确枚举值"),
            ('{"career_timing":"tomorrow"}', "明确枚举值"),
            ('{"main_friction":"甲","main_friction":"乙"}', "重复字段"),
            ('{"main_friction":NaN}', "NaN"),
            (json.dumps({"main_friction": "字" * 161}, ensure_ascii=False), "160"),
            (
                json.dumps(
                    {"life_experience_signal": "字" * 161}, ensure_ascii=False
                ),
                "160",
            ),
        ]
        for raw_input, expected_message in cases:
            with self.subTest(raw_input=raw_input[:40]):
                result = self.run_tool(
                    "upsert",
                    "--review-date",
                    "2026-08-14",
                    "--input",
                    "-",
                    raw_input=raw_input,
                    expect=2,
                )
                self.assertIn(expected_message, result.stderr)
                self.assertFalse(self.data_path.exists())

        oversized = self.run_tool(
            "upsert",
            "--review-date",
            "2026-08-14",
            "--input",
            "-",
            raw_input="x" * 8193,
            expect=2,
        )
        self.assertIn("8192", oversized.stderr)
        self.assertFalse(self.data_path.exists())

        negative_revision = self.upsert(
            "2026-08-14",
            {"goal_intent": "unsure"},
            "--expect-revision",
            "-1",
            expect=2,
        )
        self.assertIn("非负", negative_revision.stderr)
        self.assertFalse(self.data_path.exists())

    def test_high_confidence_secrets_are_redacted_without_echo(self):
        secrets = [
            "s" + "k-abcdefghijklmnopqrstuvwx",
            "person@example.com",
            "13812345678",
            "11010519491231002X",
            "6222021234567890123",
        ]
        summary = "阶段复盘材料误含 " + " ".join(secrets)
        result = self.upsert("2026-08-14", {"main_friction": summary})
        persisted = self.data_path.read_text("utf-8")
        for secret in secrets:
            self.assertNotIn(secret, persisted)
            self.assertNotIn(secret, result.stdout)
            self.assertNotIn(secret, result.stderr)
        self.assertIn("敏感信息已省略", persisted)

    def test_list_only_projects_metadata_and_can_filter_by_date(self):
        private_summary = "这段原始回答不能从 list 输出"
        self.upsert(
            "2026-08-14",
            {
                "recovery_change": private_summary,
                "goal_intent": "adjust",
                "fitness_conversation": False,
            },
        )
        self.upsert("2026-08-31", {"career_timing": "later"})

        result = self.run_tool("list")
        output = json.loads(result.stdout)
        self.assertEqual(output["count"], 2)
        self.assertTrue(output["answer_values_omitted"])
        self.assertNotIn(private_summary, result.stdout + result.stderr)
        self.assertNotIn('"adjust"', result.stdout)
        self.assertNotIn('"later"', result.stdout)
        self.assertEqual(
            output["records"][0]["fields_present"],
            ["fitness_conversation", "goal_intent", "recovery_change"],
        )

        filtered = self.run_tool("list", "--review-date", "2026-08-31")
        filtered_output = json.loads(filtered.stdout)
        self.assertEqual(filtered_output["count"], 1)
        self.assertEqual(filtered_output["records"][0]["key"], "phase-review:2026-08-31")

        invalid = self.run_tool("list", "--review-date", "2026-8-31", expect=2)
        self.assertIn("review-date", invalid.stderr)

    def test_concurrent_distinct_fields_merge_into_one_date(self):
        values = {
            "recovery_change": "睡前更容易停下来",
            "main_friction": "工作消息打断休息",
            "goal_intent": "adjust",
            "journal_cadence": "monthly",
            "checkin_cadence": "weekly",
            "next_track": "fitness",
            "fitness_conversation": True,
            "career_timing": "2026-08-31",
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
                    "--review-date",
                    "2026-08-14",
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
        self.assertEqual(records[0]["revision"], len(values))
        for field, value in values.items():
            self.assertEqual(records[0]["answers"][field], value)

    def test_concurrent_same_revision_allows_exactly_one_writer(self):
        self.upsert("2026-08-14", {"goal_intent": "unsure"})
        processes = []
        for value in ("weekly", "monthly"):
            process = subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "upsert",
                    "--root",
                    str(self.root),
                    "--review-date",
                    "2026-08-14",
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
            processes.append(
                (process, json.dumps({"journal_cadence": value}, ensure_ascii=False))
            )

        results = [process.communicate(body, timeout=20) for process, body in processes]
        return_codes = [process.returncode for process, _ in processes]
        self.assertEqual(sorted(return_codes), [0, 2], results)
        failed_index = return_codes.index(2)
        self.assertIn("修订冲突", results[failed_index][1])
        record = self.records()[0]
        self.assertEqual(record["revision"], 2)
        self.assertIn(record["answers"]["journal_cadence"], ("weekly", "monthly"))

    def test_existing_corruption_fails_closed_without_exposing_content(self):
        private_summary = "原始有效阶段复盘"
        self.upsert("2026-08-14", {"recovery_change": private_summary})
        original_record = self.records()[0]

        corruptions = []
        unknown = dict(original_record)
        unknown["raw_transcript"] = "不应存在"
        corruptions.append(json.dumps(unknown, ensure_ascii=False) + "\n")

        bool_revision = dict(original_record)
        bool_revision["revision"] = True
        corruptions.append(json.dumps(bool_revision, ensure_ascii=False) + "\n")

        wrong_key = dict(original_record)
        wrong_key["key"] = "phase-review:2026-08-15"
        corruptions.append(json.dumps(wrong_key, ensure_ascii=False) + "\n")

        empty_answers = json.loads(json.dumps(original_record, ensure_ascii=False))
        empty_answers["answers"] = {field: None for field in empty_answers["answers"]}
        corruptions.append(json.dumps(empty_answers, ensure_ascii=False) + "\n")

        wrong_boolean = json.loads(json.dumps(original_record, ensure_ascii=False))
        wrong_boolean["answers"]["fitness_conversation"] = 1
        corruptions.append(json.dumps(wrong_boolean, ensure_ascii=False) + "\n")

        nested_duplicate = json.dumps(original_record, ensure_ascii=False)
        nested_duplicate = nested_duplicate.replace(
            '"recovery_change": "原始有效阶段复盘"',
            '"recovery_change": "原始有效阶段复盘", "recovery_change": "冲突值"',
        )
        corruptions.append(nested_duplicate + "\n")

        nan_record = json.dumps(original_record, ensure_ascii=False).replace(
            '"revision": 1', '"revision": NaN'
        )
        corruptions.append(nan_record + "\n")

        duplicate_line = json.dumps(original_record, ensure_ascii=False) + "\n"
        corruptions.append(duplicate_line + duplicate_line)

        for corrupted in corruptions:
            with self.subTest(corrupted=corrupted[:50]):
                self.data_path.write_text(corrupted, "utf-8")
                before = self.data_path.read_bytes()
                result = self.upsert(
                    "2026-08-14", {"main_friction": "新回答"}, expect=2
                )
                self.assertEqual(self.data_path.read_bytes(), before)
                self.assertNotIn(private_summary, result.stdout + result.stderr)

        self.data_path.write_bytes(b"\xff\xfe\x00")
        before = self.data_path.read_bytes()
        result = self.run_tool("list", expect=2)
        self.assertIn("UTF-8", result.stderr)
        self.assertEqual(self.data_path.read_bytes(), before)

    def test_data_file_symlink_and_directory_fail_closed_without_reading_target(self):
        self.root.mkdir(parents=True)
        outside = Path(self.temp_dir.name) / "outside-private.jsonl"
        private_target = "符号链接目标里的隐私内容不得被读取"
        outside.write_text(private_target, "utf-8")
        original_target = outside.read_bytes()
        self.data_path.symlink_to(outside)

        for command, args, payload in (
            ("list", (), MISSING),
            (
                "upsert",
                ("--review-date", "2026-08-14", "--input", "-"),
                {"goal_intent": "unsure"},
            ),
        ):
            with self.subTest(command=command):
                result = self.run_tool(command, *args, payload=payload, expect=2)
                self.assertIn("普通文件", result.stderr)
                self.assertNotIn(private_target, result.stdout + result.stderr)
                self.assertTrue(self.data_path.is_symlink())
                self.assertEqual(outside.read_bytes(), original_target)

        self.data_path.unlink()
        self.data_path.mkdir()
        result = self.run_tool("list", expect=2)
        self.assertIn("普通文件", result.stderr)
        self.assertTrue(self.data_path.is_dir())

    def test_direct_inspector_is_read_only_and_rejects_unsafe_root_without_leaks(self):
        missing_root = Path(self.temp_dir.name) / "missing-records"
        missing = PHASE_REVIEW.inspect_phase_reviews(missing_root)
        self.assertEqual(missing, {"valid": True, "count": 0, "dates_unique": True})
        self.assertFalse(missing_root.exists())

        empty_root = Path(self.temp_dir.name) / "empty-records"
        empty_root.mkdir()
        entries_before = tuple(empty_root.iterdir())
        empty = PHASE_REVIEW.inspect_phase_reviews(empty_root)
        self.assertEqual(empty["count"], 0)
        self.assertEqual(tuple(empty_root.iterdir()), entries_before)
        self.assertFalse((empty_root / ".phase-reviews.lock").exists())

        private_marker = "外部目录中的阶段答案不得被读取"
        outside_file = Path(self.temp_dir.name) / "outside-phase-data.jsonl"
        outside_file.write_text(private_marker, "utf-8")
        linked_data = empty_root / "phase-reviews.jsonl"
        linked_data.symlink_to(outside_file)
        with self.assertRaises(PHASE_REVIEW.PhaseReviewError) as raised:
            PHASE_REVIEW.inspect_phase_reviews(empty_root)
        self.assertNotIn(private_marker, str(raised.exception))
        self.assertNotIn(str(outside_file), str(raised.exception))
        self.assertTrue(linked_data.is_symlink())

        outside_root = Path(self.temp_dir.name) / "outside-inspection-root"
        outside_root.mkdir()
        (outside_root / "phase-reviews.jsonl").write_text(private_marker, "utf-8")
        linked_root = Path(self.temp_dir.name) / "linked-records"
        linked_root.symlink_to(outside_root, target_is_directory=True)
        with self.assertRaises(PHASE_REVIEW.PhaseReviewError) as raised:
            PHASE_REVIEW.inspect_phase_reviews(linked_root)
        self.assertNotIn(private_marker, str(raised.exception))
        self.assertNotIn(str(outside_root), str(raised.exception))
        self.assertIsNone(raised.exception.__cause__)
        self.assertTrue(linked_root.is_symlink())

        non_directory_root = Path(self.temp_dir.name) / "records-file"
        non_directory_root.write_text(private_marker, "utf-8")
        with self.assertRaises(PHASE_REVIEW.PhaseReviewError) as raised:
            PHASE_REVIEW.inspect_phase_reviews(non_directory_root)
        self.assertNotIn(private_marker, str(raised.exception))
        self.assertNotIn(str(non_directory_root), str(raised.exception))
        self.assertIsNone(raised.exception.__cause__)

    def test_direct_inspector_validates_without_returning_answer_values(self):
        private_summary = "阶段恢复变化只应留在台账字节中"
        self.upsert(
            "2026-08-14",
            {
                "recovery_change": private_summary,
                "checkin_experience": "neutral",
            },
        )
        entries_before = tuple(sorted(path.name for path in self.root.iterdir()))
        result = PHASE_REVIEW.inspect_phase_reviews(self.root)
        self.assertEqual(result, {"valid": True, "count": 1, "dates_unique": True})
        self.assertNotIn(private_summary, json.dumps(result, ensure_ascii=False))
        self.assertEqual(
            tuple(sorted(path.name for path in self.root.iterdir())), entries_before
        )

        raw = self.data_path.read_text("utf-8")
        corrupted = raw.replace(
            '"schema_version":1',
            '"schema_version":1,"raw_transcript":"不应泄露的答案"',
        )
        self.data_path.write_text(corrupted, "utf-8")
        with self.assertRaises(PHASE_REVIEW.PhaseReviewError) as raised:
            PHASE_REVIEW.inspect_phase_reviews(self.root)
        self.assertEqual(str(raised.exception), "阶段复盘台账结构无效")
        self.assertNotIn("不应泄露的答案", str(raised.exception))
        self.assertNotIn(str(self.data_path), str(raised.exception))
        self.assertIsNone(raised.exception.__cause__)

    def test_snapshot_inspector_accepts_missing_empty_and_strict_valid_bytes(self):
        expected_empty = {"valid": True, "count": 0, "dates_unique": True}
        self.assertEqual(PHASE_REVIEW.inspect_phase_review_snapshot({}), expected_empty)
        self.assertEqual(
            PHASE_REVIEW.inspect_phase_review_snapshot(
                {"records/phase-reviews.jsonl": b""}
            ),
            expected_empty,
        )
        self.assertEqual(
            PHASE_REVIEW.inspect_phase_review_snapshot(
                {"records/phase-reviews.jsonl": b"  \n"}
            ),
            expected_empty,
        )

        private_summary = "备份快照中的阶段恢复摘要"
        self.upsert(
            "2026-08-14",
            {
                "recovery_change": private_summary,
                "goal_intent": "adjust",
                "journal_cadence": "monthly",
                "checkin_cadence": "weekly",
                "checkin_experience": "helpful",
                "next_track": "career",
                "fitness_conversation": False,
                "career_timing": "2026-08-31",
            },
        )
        snapshot = {"records/phase-reviews.jsonl": self.data_path.read_bytes()}
        result = PHASE_REVIEW.inspect_phase_review_snapshot(snapshot)
        self.assertEqual(result, {"valid": True, "count": 1, "dates_unique": True})
        self.assertNotIn(private_summary, json.dumps(result, ensure_ascii=False))

    def test_snapshot_inspector_rejects_corruption_and_mapping_errors_privately(self):
        private_marker = "快照错误中的私人答案或路径"
        corruptions = (
            (
                '{"schema_version":1,"raw_transcript":"'
                + private_marker
                + '"}\n'
            ).encode("utf-8"),
            ('{"schema_version":NaN,"private":"' + private_marker + '"}\n').encode(
                "utf-8"
            ),
            b"\xff\xfe\x00",
        )
        for corrupted in corruptions:
            with self.subTest(corrupted=corrupted[:20]):
                with self.assertRaises(PHASE_REVIEW.PhaseReviewError) as raised:
                    PHASE_REVIEW.inspect_phase_review_snapshot(
                        {"records/phase-reviews.jsonl": corrupted}
                    )
                self.assertEqual(str(raised.exception), "阶段复盘快照结构无效")
                self.assertNotIn(private_marker, str(raised.exception))
                self.assertNotIn("records/", str(raised.exception))
                self.assertIsNone(raised.exception.__cause__)

        with self.assertRaises(PHASE_REVIEW.PhaseReviewError) as raised:
            PHASE_REVIEW.inspect_phase_review_snapshot(
                {"records/phase-reviews.jsonl": bytearray(b"")}
            )
        self.assertEqual(str(raised.exception), "阶段复盘快照结构无效")

        class FailingSnapshot(dict):
            def get(self, *args, **kwargs):
                raise OSError(private_marker)

        with self.assertRaises(PHASE_REVIEW.PhaseReviewError) as raised:
            PHASE_REVIEW.inspect_phase_review_snapshot(FailingSnapshot())
        self.assertEqual(str(raised.exception), "阶段复盘快照结构无效")
        self.assertNotIn(private_marker, str(raised.exception))
        self.assertIsNone(raised.exception.__cause__)

    def test_records_root_and_lock_unsafe_paths_fail_closed(self):
        private_marker = "不安全路径中的内容不得出现在错误信息里"

        outside_root = Path(self.temp_dir.name) / "outside-records"
        outside_root.mkdir()
        (outside_root / "private.txt").write_text(private_marker, "utf-8")
        self.root.symlink_to(outside_root, target_is_directory=True)
        result = self.run_tool("list", expect=2)
        self.assertIn("真实目录", result.stderr)
        self.assertNotIn(private_marker, result.stdout + result.stderr)
        self.assertTrue(self.root.is_symlink())

        self.root.unlink()
        self.root.write_text(private_marker, "utf-8")
        result = self.run_tool("list", expect=2)
        self.assertIn("真实目录", result.stderr)
        self.assertNotIn(private_marker, result.stdout + result.stderr)

        self.root.unlink()
        self.root.mkdir()
        outside_lock = Path(self.temp_dir.name) / "outside-lock"
        outside_lock.write_text(private_marker, "utf-8")
        lock_path = self.root / ".phase-reviews.lock"
        lock_path.symlink_to(outside_lock)
        result = self.run_tool("list", expect=2)
        self.assertIn("锁路径", result.stderr)
        self.assertNotIn(private_marker, result.stdout + result.stderr)
        self.assertTrue(lock_path.is_symlink())

        lock_path.unlink()
        lock_path.mkdir()
        result = self.upsert("2026-08-14", {"goal_intent": "unsure"}, expect=2)
        self.assertIn("锁路径", result.stderr)
        self.assertFalse(self.data_path.exists())

    def test_purge_is_private_conflict_safe_confirmed_and_retryable(self):
        private_summary = "这段阶段复盘不能出现在删除预览或回执里"
        self.upsert("2026-08-14", {"main_friction": private_summary})
        self.upsert("2026-08-31", {"career_timing": "later"})
        before = self.data_path.read_bytes()

        plan = self.run_tool("purge-plan", "--review-date", "2026-08-14")
        plan_payload = json.loads(plan.stdout)
        self.assertEqual(plan_payload["action"], "purge_plan")
        self.assertTrue(plan_payload["exists"])
        self.assertEqual(plan_payload["revision"], 1)
        self.assertEqual(plan_payload["required_confirmation"], "phase-review:2026-08-14")
        self.assertRegex(plan_payload["record_etag"], r"^[0-9a-f]{64}$")
        self.assertNotIn(private_summary, plan.stdout + plan.stderr)
        self.assertEqual(self.data_path.read_bytes(), before)

        common = [
            "--review-date",
            "2026-08-14",
            "--confirm",
            "phase-review:2026-08-14",
            "--expect-revision",
            "1",
            "--expect-record-etag",
            plan_payload["record_etag"],
        ]
        missing_ack = self.run_tool("purge", *common, expect=2)
        self.assertIn("历史", missing_ack.stderr)
        self.assertEqual(self.data_path.read_bytes(), before)

        wrong_confirm = list(common)
        wrong_confirm[wrong_confirm.index("phase-review:2026-08-14")] = (
            "phase-review:2026-08-15"
        )
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

        self.upsert("2026-08-14", {"goal_intent": "adjust"})
        stale = self.run_tool(
            "purge", *common, "--acknowledge-historical-copies", expect=2
        )
        self.assertIn("修订冲突", stale.stderr)

        fresh_plan = json.loads(
            self.run_tool("purge-plan", "--review-date", "2026-08-14").stdout
        )
        fresh_args = [
            "--review-date",
            "2026-08-14",
            "--confirm",
            "phase-review:2026-08-14",
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
        self.assertTrue(
            purged_payload["journals_checkins_goals_memory_automations_not_deleted"]
        )
        self.assertNotIn(private_summary, purged.stdout + purged.stderr)
        remaining = self.records()
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]["key"], "phase-review:2026-08-31")

        second_plan = json.loads(
            self.run_tool("purge-plan", "--review-date", "2026-08-31").stdout
        )
        second_args = [
            "--review-date",
            "2026-08-31",
            "--confirm",
            "phase-review:2026-08-31",
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
        self.assertEqual(json.loads(retry.stdout)["action"], "already_absent")


if __name__ == "__main__":
    unittest.main()
