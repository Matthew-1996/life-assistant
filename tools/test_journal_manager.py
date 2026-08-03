#!/usr/bin/env python3
"""journal_manager.py 的独立标准库测试。"""

from __future__ import annotations

import hashlib
import json
import importlib.util
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).with_name("journal_manager.py")
MODULE_SPEC = importlib.util.spec_from_file_location("journal_manager_under_test", SCRIPT)
assert MODULE_SPEC is not None and MODULE_SPEC.loader is not None
JOURNAL_MANAGER = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(JOURNAL_MANAGER)


class JournalManagerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="journal-manager-test-")
        self.temp_path = Path(self.temporary.name)
        self.root = self.temp_path / "journal"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _run(self, *arguments: str, expected_code: int = 0) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *arguments],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            result.returncode,
            expected_code,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )
        return result

    def _run_stdin(
        self,
        command: str,
        payload: dict,
        *,
        expected_code: int = 0,
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                command,
                "--input",
                "-",
                "--root",
                str(self.root),
            ],
            input=json.dumps(payload, ensure_ascii=False),
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            result.returncode,
            expected_code,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )
        return result

    def _add(self, payload: dict, name: str = "entry.json") -> dict:
        input_path = self.temp_path / name
        input_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        result = self._run("add", "--input", str(input_path), "--root", str(self.root))
        return json.loads(result.stdout)

    def _review(
        self,
        payload: dict,
        name: str = "review.json",
        expected_code: int = 0,
        *,
        attach_source_set_etag: bool = True,
    ):
        payload = dict(payload)
        if attach_source_set_etag and "source_set_etag" not in payload:
            payload["source_set_etag"] = JOURNAL_MANAGER._review_source_set_etag(
                payload.get("type", ""),
                payload.get("start", ""),
                payload.get("end", ""),
                payload.get("entry_ids", []),
            )
        input_path = self.temp_path / name
        input_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        result = self._run(
            "review",
            "--input",
            str(input_path),
            "--root",
            str(self.root),
            expected_code=expected_code,
        )
        return json.loads(result.stdout) if expected_code == 0 else result

    def _amend(self, payload: dict, name: str = "amend.json", expected_code: int = 0):
        input_path = self.temp_path / name
        input_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        result = self._run(
            "amend",
            "--input",
            str(input_path),
            "--root",
            str(self.root),
            expected_code=expected_code,
        )
        return json.loads(result.stdout) if expected_code == 0 else result

    def _purge(
        self,
        identifier: str,
        *,
        confirmation: str | None = None,
        acknowledge: bool = True,
        expected_code: int = 0,
    ):
        arguments = [
            "purge",
            "--root",
            str(self.root),
            "--id",
            identifier,
            "--confirm",
            confirmation if confirmation is not None else identifier,
        ]
        if acknowledge:
            arguments.append("--acknowledge-historical-copies")
        result = self._run(*arguments, expected_code=expected_code)
        return json.loads(result.stdout) if expected_code == 0 else result

    def _records(self) -> list[dict]:
        index_path = self.root / "index.jsonl"
        return [json.loads(line) for line in index_path.read_text(encoding="utf-8").splitlines()]

    def _interrupt_purge_after_operation(self, identifier: str) -> Path:
        """在恢复记录已持久化、任何日记或回顾内容未删除时注入中断。"""

        root = self.root.resolve()
        with mock.patch.object(
            JOURNAL_MANAGER,
            "_known_backup_copies",
            side_effect=OSError("simulated interruption after durable operation"),
        ):
            with self.assertRaises(OSError):
                JOURNAL_MANAGER.purge_entry(
                    root,
                    identifier,
                    identifier,
                    acknowledge_historical_copies=True,
                )
        operation_path = JOURNAL_MANAGER._purge_operation_path(root, identifier)
        self.assertTrue(operation_path.exists())
        return operation_path

    @staticmethod
    def _entry(**overrides: object) -> dict:
        payload = {
            "date": "2026-08-01",
            "time": "22:35",
            "title": "晚饭后散步",
            "source": "explicit",
            "raw": "今天晚饭后在小区散步了 25 分钟，吹到风后感觉松了一点。",
            "summary": "散步让晚上稍微放松。",
            "facts": ["晚饭后散步 25 分钟"],
            "feelings": ["放松"],
            "people": ["自己"],
            "places": ["小区"],
            "themes": ["恢复与节律"],
            "tags": ["散步", "恢复"],
            "planning_clues": ["可保留低强度晚间散步"],
            "inferences": [],
        }
        payload.update(overrides)
        return payload

    def _complete_amendment(self, identifier: str, note: str, **overrides: object) -> dict:
        entry = self._entry()
        payload = {
            "id": identifier,
            "note": note,
            "privacy": "local-only",
            "title": entry["title"],
            "summary": entry["summary"],
            "facts": entry["facts"],
            "feelings": entry["feelings"],
            "people": entry["people"],
            "places": entry["places"],
            "themes": entry["themes"],
            "tags": entry["tags"],
            "planning_clues": entry["planning_clues"],
            "inferences": entry["inferences"],
        }
        payload.update(overrides)
        return payload

    def test_add_creates_private_month_and_indexes_idempotently(self) -> None:
        first = self._add(self._entry())
        self.assertEqual(first["status"], "added")
        self.assertEqual(first["privacy"], "local-only")

        month_path = self.root / "entries" / "2026" / "2026-08.md"
        machine_index = self.root / "index.jsonl"
        readable_index = self.root / "INDEX.md"
        self.assertTrue(month_path.exists())
        self.assertTrue(machine_index.exists())
        self.assertTrue(readable_index.exists())

        month_text = month_path.read_text(encoding="utf-8")
        self.assertIn("今天晚饭后在小区散步了 25 分钟", month_text)
        self.assertIn("local-only", month_text)
        self.assertIn("人物：自己", month_text)
        self.assertIn("地点或场景：小区", month_text)
        self.assertIn("生活主题：恢复与节律", month_text)
        self.assertIn(f"journal-id: {first['id']}", month_text)
        self.assertNotIn("今天晚饭后在小区散步了 25 分钟", readable_index.read_text(encoding="utf-8"))

        second = self._add(self._entry(), "same-entry.json")
        self.assertEqual(second["status"], "exists")
        self.assertEqual(second["id"], first["id"])
        self.assertEqual(month_path.read_text(encoding="utf-8").count("journal-id:"), 1)
        self.assertEqual(len(machine_index.read_text(encoding="utf-8").splitlines()), 1)
        record = self._records()[0]
        self.assertEqual(record["people"], ["自己"])
        self.assertEqual(record["places"], ["小区"])
        self.assertEqual(record["themes"], ["恢复与节律"])
        self.assertEqual(record["weekly_reviews"], [])
        self.assertEqual(record["monthly_reviews"], [])

    def test_concurrent_adds_are_serialized_without_lost_entries(self) -> None:
        process_specs: list[tuple[subprocess.Popen[str], Path]] = []
        expected_titles: set[str] = set()
        for position in range(16):
            title = f"并发记录 {position:02d}"
            expected_titles.add(title)
            payload = self._entry(
                time=f"08:{position:02d}",
                title=title,
                raw=f"这是第 {position:02d} 条并发写入的生活记录。",
            )
            input_path = self.temp_path / f"concurrent-{position:02d}.json"
            input_path.write_text(
                json.dumps(payload, ensure_ascii=False), encoding="utf-8"
            )
            process = subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "add",
                    "--input",
                    str(input_path),
                    "--root",
                    str(self.root),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            process_specs.append((process, input_path))

        identifiers: set[str] = set()
        for process, input_path in process_specs:
            stdout, stderr = process.communicate(timeout=30)
            self.assertEqual(
                process.returncode,
                0,
                msg=f"{input_path.name}\nstdout:\n{stdout}\nstderr:\n{stderr}",
            )
            identifiers.add(json.loads(stdout)["id"])

        records = self._records()
        self.assertEqual(len(records), 16)
        self.assertEqual(len(identifiers), 16)
        self.assertEqual({record["title"] for record in records}, expected_titles)
        month_text = (self.root / "entries/2026/2026-08.md").read_text(
            encoding="utf-8"
        )
        self.assertEqual(month_text.count("<!-- journal-id:"), 16)

    def test_partial_state_is_repaired_without_duplicate(self) -> None:
        first = self._add(self._entry())
        month_path = self.root / first["file"]
        month_path.unlink()

        repaired = self._add(self._entry(), "repair.json")
        self.assertEqual(repaired["status"], "repaired")
        self.assertEqual(month_path.read_text(encoding="utf-8").count("journal-id:"), 1)
        self.assertEqual(len((self.root / "index.jsonl").read_text(encoding="utf-8").splitlines()), 1)

    def test_add_remains_compatible_when_new_context_fields_are_omitted(self) -> None:
        payload = self._entry()
        for field in ("people", "places", "themes"):
            payload.pop(field)
        added = self._add(payload, "legacy-shape.json")
        record = self._records()[0]
        self.assertEqual(record["id"], added["id"])
        self.assertEqual(record["people"], [])
        self.assertEqual(record["places"], [])
        self.assertEqual(record["themes"], [])
        self.assertEqual(record["time_precision"], "exact")

    def test_add_accepts_unknown_or_approximate_event_time_without_fake_precision(self) -> None:
        unknown = self._add(
            self._entry(
                date="2026-07-30",
                time=None,
                time_precision="unknown",
                title="前几天和朋友吃饭",
                raw="前几天和朋友吃了饭，但我不记得具体几点。",
            ),
            "unknown-time.json",
        )
        unknown_record = next(record for record in self._records() if record["id"] == unknown["id"])
        self.assertIsNone(unknown["time"])
        self.assertEqual(unknown["time_precision"], "unknown")
        self.assertIsNone(unknown_record["time"])
        self.assertEqual(unknown_record["time_precision"], "unknown")
        self.assertIn("-unknown-", unknown["id"])
        self.assertIn("时间未知｜前几天和朋友吃饭", (self.root / unknown["file"]).read_text(encoding="utf-8"))

        approximate = self._add(
            self._entry(
                date="2026-07-31",
                time="21:00",
                time_precision="approximate",
                title="大约九点散步",
                raw="昨晚大约九点出去走了走。",
            ),
            "approximate-time.json",
        )
        self.assertEqual(approximate["time_precision"], "approximate")
        self.assertIn("约 21:00｜大约九点散步", (self.root / approximate["file"]).read_text(encoding="utf-8"))

    def test_add_and_amend_accept_recommended_stdin_path(self) -> None:
        raw_sentinel = "PRIVATE-STDIN-RAW-7e8a3a7d"
        note_sentinel = "PRIVATE-STDIN-AMEND-NOTE-51fc8612"
        added_result = self._run_stdin(
            "add", self._entry(raw=f"今天的原话 {raw_sentinel}")
        )
        self.assertIn("--input", added_result.args)
        self.assertIn("-", added_result.args)
        for output in (" ".join(added_result.args), added_result.stdout, added_result.stderr):
            self.assertNotIn(raw_sentinel, output)
        added = json.loads(added_result.stdout)
        self.assertNotIn("raw", added)

        amended_result = self._run_stdin(
            "amend",
            self._complete_amendment(
                added["id"],
                f"更正人物。{note_sentinel}",
                people=["同事"],
                summary="和同事散步后稍微放松。",
            ),
        )
        for sentinel in (raw_sentinel, note_sentinel):
            for output in (
                " ".join(amended_result.args),
                amended_result.stdout,
                amended_result.stderr,
            ):
                self.assertNotIn(sentinel, output)
        amended = json.loads(amended_result.stdout)
        self.assertNotIn("note", amended)
        self.assertEqual(amended["status"], "amended")
        record = self._records()[0]
        self.assertEqual(record["people"], ["同事"])
        self.assertEqual(record["summary"], "和同事散步后稍微放松。")
        month_text = (self.root / added["file"]).read_text(encoding="utf-8")
        self.assertIn(raw_sentinel, month_text)
        self.assertIn(note_sentinel, month_text)
        machine_index = (self.root / "index.jsonl").read_text(encoding="utf-8")
        readable_index = (self.root / "INDEX.md").read_text(encoding="utf-8")
        self.assertNotIn(raw_sentinel, machine_index + readable_index)
        self.assertNotIn(note_sentinel, machine_index + readable_index)

    def test_list_filters_sorts_and_limits_metadata(self) -> None:
        self._add(self._entry(), "first.json")
        self._add(
            self._entry(
                date="2026-08-03",
                time="09:15",
                title="早上晒太阳",
                raw="今早晒了十分钟太阳。",
                summary="早上接触了自然光。",
                tags=["睡眠", "日光"],
            ),
            "second.json",
        )
        result = self._run(
            "list",
            "--root",
            str(self.root),
            "--start",
            "2026-08-02",
            "--end",
            "2026-08-04",
            "--tag",
            "睡眠",
            "--limit",
            "1",
        )
        records = json.loads(result.stdout)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["title"], "早上晒太阳")
        self.assertNotIn("raw", records[0])
        self.assertTrue(set(records[0]).issubset(set(JOURNAL_MANAGER.LIST_SAFE_FIELDS)))

        ascending = json.loads(
            self._run("list", "--root", str(self.root), "--order", "asc").stdout
        )
        self.assertEqual([item["date"] for item in ascending], ["2026-08-01", "2026-08-03"])

    def test_machine_index_rejects_unknown_fields_without_leaking_them(self) -> None:
        sentinel = "INJECTED-RAW-INDEX-SENTINEL-6e8a"
        self._add(self._entry(), "strict-index.json")
        record = self._records()[0]
        record["raw"] = sentinel
        (self.root / "index.jsonl").write_text(
            json.dumps(record, ensure_ascii=False) + "\n", encoding="utf-8"
        )

        result = self._run(
            "list", "--root", str(self.root), expected_code=2
        )
        self.assertIn("结构无效", result.stderr)
        self.assertNotIn(sentinel, result.stdout + result.stderr)

    def test_rejects_missing_fields_invalid_datetime_and_nonlocal_privacy(self) -> None:
        invalid_payloads = [
            ({"date": "2026-08-01", "time": "22:35", "title": "", "raw": "x"}, "title"),
            (self._entry(date="2026-02-30"), "有效日期"),
            (self._entry(time="24:01"), "HH:MM"),
            (self._entry(time=None, time_precision="exact"), "必须提供 time"),
            (self._entry(time="21:00", time_precision="unknown"), "不得提供 time"),
            (self._entry(privacy="public"), "local-only"),
            (self._entry(tags="不是数组"), "数组"),
        ]
        for position, (payload, expected_message) in enumerate(invalid_payloads):
            with self.subTest(position=position):
                input_path = self.temp_path / f"invalid-{position}.json"
                input_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
                result = self._run(
                    "add",
                    "--input",
                    str(input_path),
                    "--root",
                    str(self.root),
                    expected_code=2,
                )
                self.assertIn(expected_message, result.stderr)
        self.assertFalse((self.root / "index.jsonl").exists())

    def test_list_rejects_inverted_range(self) -> None:
        result = self._run(
            "list",
            "--root",
            str(self.root),
            "--start",
            "2026-08-10",
            "--end",
            "2026-08-01",
            expected_code=2,
        )
        self.assertIn("start 不能晚于 end", result.stderr)

    def test_redacts_high_risk_secrets_before_writing(self) -> None:
        result = self._add(
            self._entry(
                raw="新卡号 6222123412341234，验证码是 123456，密码是 abcdef。",
                summary="银行卡号 6222123412341234",
            ),
            "secret.json",
        )
        self.assertCountEqual(
            result["redactions"],
            ["verification_code", "password", "long_number"],
        )
        month_text = (self.root / result["file"]).read_text(encoding="utf-8")
        self.assertNotIn("6222123412341234", month_text)
        self.assertNotIn("123456", month_text)
        self.assertNotIn("abcdef", month_text)
        self.assertIn("[完整号码已省略]", month_text)
        self.assertIn("验证码是 [已省略]", month_text)

    def test_redacts_cloud_jwt_recovery_and_english_credentials(self) -> None:
        fake_aws_key = "AKIA" + "A1B2C3D4E5F6G7H8"
        fake_jwt = ".".join(
            ["eyJ" + "a" * 12, "b" * 12, "c" * 12]
        )
        fake_password = "correct" + "-horse-99"
        fake_recovery = "ABCD" + "-EFGH-IJKL"
        raw = (
            f"AWS key {fake_aws_key}；session={fake_jwt}；"
            f"password={fake_password}；恢复码：{fake_recovery}。"
        )
        result = self._add(self._entry(raw=raw), "expanded-secrets.json")
        self.assertCountEqual(
            result["redactions"],
            [
                "cloud_access_key",
                "jwt",
                "recovery_code",
                "credential_assignment",
            ],
        )
        stored = (self.root / result["file"]).read_text(encoding="utf-8")
        for secret in (fake_aws_key, fake_jwt, fake_password, fake_recovery):
            self.assertNotIn(secret, stored)
        self.assertIn("[云访问密钥已省略]", stored)
        self.assertIn("session=[JWT 已省略]", stored)
        self.assertIn("password=[已省略]", stored)
        self.assertIn("恢复码：[已省略]", stored)

    def test_redacts_private_key_variants_unicode_labels_and_grouped_codes(self) -> None:
        encrypted_key = (
            "-----BEGIN " + "ENCRYPTED PRIVATE KEY-----\n"
            "RU5DUllQVEVELUtFWS1URVNU\n"
            "-----END " + "ENCRYPTED PRIVATE KEY-----"
        )
        dsa_key = (
            "-----BEGIN " + "DSA PRIVATE KEY-----\n"
            "RFNBLUtFWS1URVNU\n"
            "-----END " + "DSA PRIVATE KEY-----"
        )
        pgp_key = (
            "-----BEGIN " + "PGP PRIVATE KEY BLOCK-----\n"
            "UEdQLUtFWS1URVNU\n"
            "-----END " + "PGP PRIVATE KEY BLOCK-----"
        )
        raw = "\n".join(
            [
                encrypted_key,
                dsa_key,
                pgp_key,
                "token：abcdefghijklmnop",
                "访问令牌：qrstuvwxyzabcdef",
                "恢复码：1234 5678",
                'password="four words secret"',
                '密码："another secret phrase"',
                "我们关系的密码是坦诚沟通。",
            ]
        )
        result = self._add(self._entry(raw=raw), "adversarial-secrets.json")
        self.assertCountEqual(
            result["redactions"],
            ["private_key", "recovery_code", "credential_assignment", "password"],
        )
        stored = (self.root / result["file"]).read_text(encoding="utf-8")
        for secret in (
            encrypted_key,
            dsa_key,
            pgp_key,
            "abcdefghijklmnop",
            "qrstuvwxyzabcdef",
            "1234 5678",
            "four words secret",
            "another secret phrase",
        ):
            self.assertNotIn(secret, stored)
        self.assertNotIn("words secret", stored)
        self.assertIn("我们关系的密码是坦诚沟通。", stored)
        self.assertGreaterEqual(stored.count("[私钥已省略]"), 3)

    def test_redacts_truncated_private_key_from_header_through_end_of_text(self) -> None:
        truncated_key = (
            "-----BEGIN "
            + "ENCRYPTED PRIVATE KEY-----\n"
            + "VFJVTkNBVEVELVBSSVZBVEUtS0VZ"
        )
        result = self._add(
            self._entry(raw=f"这是普通生活内容。\n{truncated_key}"),
            "truncated-private-key.json",
        )
        self.assertEqual(result["redactions"], ["private_key"])
        stored = (self.root / result["file"]).read_text(encoding="utf-8")
        self.assertIn("这是普通生活内容。", stored)
        self.assertIn("[私钥已省略]", stored)
        self.assertNotIn(truncated_key, stored)
        self.assertNotIn("VFJVTkNBVEVELVBSSVZBVEUtS0VZ", stored)

    def test_amend_appends_auditable_correction_and_is_idempotent(self) -> None:
        added = self._add(self._entry(), "amend-target.json")
        month_path = self.root / added["file"]
        original_raw = self._entry()["raw"]
        payload = self._complete_amendment(
            added["id"],
            "我刚才说错了，实际散步了 15 分钟，而且感觉很平静。",
            title="晚饭后短散步",
            summary="短散步后感觉平静。",
            facts=["晚饭后散步 15 分钟"],
            feelings=["平静"],
            tags=["散步", "恢复"],
        )

        first = self._amend(payload)
        self.assertEqual(first["status"], "amended")
        self.assertTrue(first["amendment_id"].startswith("amend-"))
        self.assertEqual(first["affected_reviews"], [])

        month_text = month_path.read_text(encoding="utf-8")
        self.assertIn(original_raw, month_text)
        self.assertIn("## 2026-08-01 22:35｜晚饭后散步", month_text)
        self.assertIn(f"journal-amendment: {first['amendment_id']}", month_text)
        self.assertIn(payload["note"], month_text)
        self.assertIn("更正后的轻量索引", month_text)

        record = self._records()[0]
        self.assertEqual(record["date"], "2026-08-01")
        self.assertEqual(record["time"], "22:35")
        self.assertEqual(record["title"], "晚饭后短散步")
        self.assertEqual(record["summary"], "短散步后感觉平静。")
        self.assertEqual(record["facts"], ["晚饭后散步 15 分钟"])
        self.assertEqual(record["feelings"], ["平静"])
        self.assertEqual(set(record["amendments"][0]), {"id", "timestamp"})
        self.assertEqual(record["amendments"][0]["id"], first["amendment_id"])
        self.assertNotIn(payload["note"], json.dumps(record, ensure_ascii=False))
        self.assertIn("晚饭后短散步", (self.root / "INDEX.md").read_text(encoding="utf-8"))

        month_before = month_path.read_bytes()
        index_before = (self.root / "index.jsonl").read_bytes()
        readable_before = (self.root / "INDEX.md").read_bytes()
        duplicate = self._amend(payload, "same-amend.json")
        self.assertEqual(duplicate["status"], "exists")
        self.assertEqual(duplicate["amendment_id"], first["amendment_id"])
        self.assertEqual(duplicate["timestamp"], first["timestamp"])
        self.assertEqual(month_path.read_bytes(), month_before)
        self.assertEqual((self.root / "index.jsonl").read_bytes(), index_before)
        self.assertEqual((self.root / "INDEX.md").read_bytes(), readable_before)
        self.assertEqual(month_text.count(f"journal-amendment: {first['amendment_id']}"), 1)
        self.assertEqual(len(self._records()[0]["amendments"]), 1)

    def test_amend_redacts_note_and_updated_metadata_before_writing(self) -> None:
        added = self._add(self._entry(), "secret-amend-target.json")
        fake_token = "sk-" + "abcdefghijklmnopqrstuvwxyz123456"
        note = f"银行卡 6222123412341234，验证码是 123456，Token {fake_token}。"
        result = self._amend(
            self._complete_amendment(
                added["id"],
                note,
                title="密码是 abcdef 的更正",
                planning_clues=["不保存卡号 6222123412341234"],
            ),
            "secret-amend.json",
        )
        self.assertCountEqual(
            result["redactions"],
            ["api_token", "verification_code", "password", "long_number"],
        )
        stored = (self.root / added["file"]).read_text(encoding="utf-8")
        machine = (self.root / "index.jsonl").read_text(encoding="utf-8")
        for secret in ("6222123412341234", "123456", "abcdef", fake_token):
            self.assertNotIn(secret, stored)
            self.assertNotIn(secret, machine)
        self.assertIn("验证码是 [已省略]", stored)
        self.assertIn("密码是 [已省略]", stored)
        self.assertNotIn(note, machine)

    def test_amend_rejects_unsafe_shape_missing_or_inactive_target(self) -> None:
        added = self._add(self._entry(), "invalid-amend-target.json")
        cases = [
            ({"id": added["id"], "note": "缺隐私范围"}, "privacy"),
            ({"id": added["id"], "note": "错误范围", "privacy": "public"}, "local-only"),
            (
                {"id": added["id"], "note": "企图改原文", "privacy": "local-only", "raw": "新原文"},
                "不得覆盖 raw",
            ),
            (
                {"id": added["id"], "note": "不支持字段", "privacy": "local-only", "source": "implicit"},
                "不支持的字段",
            ),
            ({"id": added["id"], "note": " ", "privacy": "local-only"}, "note"),
            (
                {"id": added["id"], "note": "错误数组", "privacy": "local-only", "facts": "不是数组"},
                "数组",
            ),
            (
                {"id": added["id"], "note": "只写说明", "privacy": "local-only"},
                "不能只保存说明",
            ),
            (
                {
                    "id": added["id"],
                    "note": "只改人物但不重建其他字段",
                    "privacy": "local-only",
                    "people": ["同事"],
                },
                "完整轻量索引",
            ),
            (
                {"id": "missing", "note": "不存在", "privacy": "local-only", "date": "2026-08-01"},
                "找不到",
            ),
        ]
        for position, (payload, expected) in enumerate(cases):
            with self.subTest(position=position):
                result = self._amend(payload, f"invalid-amend-{position}.json", expected_code=2)
                self.assertIn(expected, result.stderr)

        self._run("withdraw", "--root", str(self.root), "--id", added["id"])
        inactive = self._amend(
            {"id": added["id"], "note": "已撤回", "privacy": "local-only", "date": "2026-08-01"},
            "inactive-amend.json",
            expected_code=2,
        )
        self.assertIn("active", inactive.stderr)
        self.assertNotIn("journal-amendment:", (self.root / added["file"]).read_text(encoding="utf-8"))

    def test_amend_corrects_effective_date_and_time_without_moving_raw_history(self) -> None:
        added = self._add(self._entry(), "effective-time-target.json")
        source_path = self.root / added["file"]
        original_source = source_path.read_text(encoding="utf-8")
        result = self._amend(
            {
                "id": added["id"],
                "note": "刚才把日期和时间说错了，实际是九月一日晚上九点十分。",
                "privacy": "local-only",
                "date": "2026-09-01",
                "time": "21:10",
            },
            "effective-time-amendment.json",
        )
        self.assertEqual(result["date"], "2026-09-01")
        self.assertEqual(result["time"], "21:10")
        record = self._records()[0]
        self.assertEqual(record["date"], "2026-09-01")
        self.assertEqual(record["time"], "21:10")
        self.assertEqual(record["original_date"], "2026-08-01")
        self.assertEqual(record["original_time"], "22:35")
        self.assertEqual(record["original_time_precision"], "exact")
        self.assertEqual(record["file"], added["file"])
        source = source_path.read_text(encoding="utf-8")
        self.assertIn(self._entry()["raw"], source)
        self.assertIn("有效日期：2026-09-01", source)
        self.assertIn("有效时间：21:10", source)
        self.assertTrue(source.startswith(original_source.split("## ", 1)[0]))
        listed = json.loads(
            self._run(
                "list",
                "--root",
                str(self.root),
                "--start",
                "2026-09-01",
                "--end",
                "2026-09-01",
            ).stdout
        )
        self.assertEqual([item["id"] for item in listed], [added["id"]])

    def test_amend_can_replace_false_exact_time_with_unknown(self) -> None:
        added = self._add(self._entry(), "unknown-time-amend-target.json")
        result = self._amend(
            {
                "id": added["id"],
                "note": "我只记得是那天发生的，不记得具体时间。",
                "privacy": "local-only",
                "time": None,
                "time_precision": "unknown",
            },
            "unknown-time-amend.json",
        )
        self.assertIsNone(result["time"])
        self.assertEqual(result["time_precision"], "unknown")
        record = self._records()[0]
        self.assertIsNone(record["time"])
        self.assertEqual(record["time_precision"], "unknown")
        self.assertEqual(record["original_time"], "22:35")
        self.assertEqual(record["original_time_precision"], "exact")
        source = (self.root / added["file"]).read_text(encoding="utf-8")
        self.assertIn("有效时间：未记录", source)
        self.assertIn("时间精度：unknown", source)

    def test_amend_invalidates_linked_reviews_and_retains_paths(self) -> None:
        target = self._add(self._entry(), "amended-reviewed-target.json")
        other = self._add(
            self._entry(
                date="2026-08-02",
                time="09:15",
                title="早上晒太阳",
                raw="今早晒了十分钟太阳。",
            ),
            "amended-reviewed-other.json",
        )
        common = {
            "title": "更正失效测试回顾",
            "entry_ids": [target["id"], other["id"]],
            "events": ["散步和日光"],
            "replenishing": ["户外活动"],
            "draining": [],
            "recurring": [],
            "open_threads": [],
            "planning_implications": ["保留轻活动"],
            "candidate_memories": [],
        }
        weekly = self._review(
            dict(common, type="weekly", start="2026-07-27", end="2026-08-02"),
            "amend-linked-weekly.json",
        )
        monthly = self._review(
            dict(common, type="monthly", start="2026-08-01", end="2026-08-31"),
            "amend-linked-monthly.json",
        )
        expected = sorted([weekly["file"], monthly["file"]])

        amendment_payload = self._complete_amendment(
            target["id"],
            "更正散步时长。",
            facts=["晚饭后散步 15 分钟"],
            summary="散步 15 分钟后稍微放松。",
        )
        amended = self._amend(
            amendment_payload,
            "review-invalidating-amend.json",
        )
        self.assertEqual(amended["affected_reviews"], expected)
        self.assertEqual(amended["invalidated_reviews"], expected)
        records = {record["id"]: record for record in self._records()}
        self.assertEqual(records[target["id"]]["weekly_reviews"], [])
        self.assertEqual(records[target["id"]]["monthly_reviews"], [])
        self.assertEqual(records[target["id"]]["invalidated_reviews"], expected)
        self.assertEqual(records[other["id"]]["weekly_reviews"], [])
        self.assertEqual(records[other["id"]]["monthly_reviews"], [])
        self.assertEqual(records[other["id"]]["invalidated_reviews"], expected)

        warning = "来源日记已更正，本回顾需刷新后再用于规划"
        for relative_file in expected:
            content = (self.root / relative_file).read_text(encoding="utf-8")
            self.assertEqual(content.count(warning), 1)
            self.assertLess(content.index(warning), 150)

        duplicate = self._amend(
            amendment_payload,
            "review-invalidating-amend-again.json",
        )
        self.assertEqual(duplicate["status"], "exists")
        self.assertEqual(duplicate["affected_reviews"], [])
        self.assertEqual(duplicate["invalidated_reviews"], expected)
        for relative_file in expected:
            self.assertEqual(
                (self.root / relative_file).read_text(encoding="utf-8").count(warning),
                1,
            )

        self._review(
            dict(common, type="weekly", start="2026-07-27", end="2026-08-02"),
            "amend-refreshed-weekly.json",
        )
        after_weekly_records = {record["id"]: record for record in self._records()}
        self.assertEqual(after_weekly_records[target["id"]]["invalidated_reviews"], [monthly["file"]])
        self.assertEqual(after_weekly_records[other["id"]]["invalidated_reviews"], [monthly["file"]])
        self.assertNotIn(warning, (self.root / weekly["file"]).read_text(encoding="utf-8"))
        self._review(
            dict(common, type="monthly", start="2026-08-01", end="2026-08-31"),
            "amend-refreshed-monthly.json",
        )
        refreshed = {record["id"]: record for record in self._records()}
        self.assertEqual(refreshed[target["id"]]["invalidated_reviews"], [])
        self.assertEqual(refreshed[other["id"]]["invalidated_reviews"], [])

    def test_amend_stays_inside_target_block_and_repairs_partial_state(self) -> None:
        first = self._add(self._entry(), "block-first.json")
        second = self._add(
            self._entry(
                date="2026-08-02",
                time="08:20",
                title="第二条",
                raw="这是第二条原文。",
            ),
            "block-second.json",
        )
        payload = self._complete_amendment(
            first["id"], "更正第一条。", summary="第一条的新摘要。"
        )
        amended = self._amend(payload, "block-amend.json")
        month_path = self.root / first["file"]
        content = month_path.read_text(encoding="utf-8")
        correction_position = content.index(f"journal-amendment: {amended['amendment_id']}")
        second_position = content.index(f"journal-id: {second['id']}")
        self.assertLess(correction_position, second_position)

        records = self._records()
        for record in records:
            if record["id"] == first["id"]:
                record["amendments"] = []
                record["summary"] = "旧摘要"
        (self.root / "index.jsonl").write_text(
            "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
            encoding="utf-8",
        )
        repaired = self._amend(payload, "block-amend-repair.json")
        self.assertEqual(repaired["status"], "repaired")
        repaired_record = {record["id"]: record for record in self._records()}[first["id"]]
        self.assertEqual(repaired_record["summary"], "第一条的新摘要。")
        self.assertEqual(len(repaired_record["amendments"]), 1)
        self.assertEqual(
            month_path.read_text(encoding="utf-8").count(
                f"journal-amendment: {amended['amendment_id']}"
            ),
            1,
        )

    def test_amend_retry_repairs_readable_index_after_final_view_write_failed(self) -> None:
        added = self._add(self._entry(), "amend-readable-repair-target.json")
        root = self.root.resolve()
        payload = self._complete_amendment(
            added["id"],
            "把标题更正为一个更准确的说法。",
            title="晚饭后的短散步",
        )
        original_atomic_write = JOURNAL_MANAGER._atomic_write
        failure_injected = False

        def fail_readable_once(path: Path, content: str) -> None:
            nonlocal failure_injected
            if path == root / "INDEX.md" and not failure_injected:
                failure_injected = True
                raise OSError("simulated readable index write failure")
            original_atomic_write(path, content)

        with mock.patch.object(
            JOURNAL_MANAGER, "_atomic_write", side_effect=fail_readable_once
        ):
            with self.assertRaises(OSError):
                JOURNAL_MANAGER.amend_entry(root, payload)

        machine_record = JOURNAL_MANAGER._load_records(root / "index.jsonl")[0]
        self.assertEqual(machine_record["title"], "晚饭后的短散步")
        self.assertNotIn(
            "晚饭后的短散步", (root / "INDEX.md").read_text(encoding="utf-8")
        )

        repaired = JOURNAL_MANAGER.amend_entry(root, payload)
        self.assertEqual(repaired["status"], "repaired")
        self.assertIn(
            "晚饭后的短散步", (root / "INDEX.md").read_text(encoding="utf-8")
        )
        duplicate = JOURNAL_MANAGER.amend_entry(root, payload)
        self.assertEqual(duplicate["status"], "exists")

    def test_withdraw_hides_entry_from_list_and_marks_source(self) -> None:
        added = self._add(self._entry(), "withdraw.json")
        result = self._run(
            "withdraw",
            "--root",
            str(self.root),
            "--id",
            added["id"],
        )
        withdrawal = json.loads(result.stdout)
        self.assertEqual(withdrawal["status"], "withdrawn")
        self.assertEqual(withdrawal["affected_reviews"], [])
        self.assertTrue(withdrawal["content_retained"])
        self.assertEqual(json.loads(self._run("list", "--root", str(self.root)).stdout), [])
        self.assertIn(
            "原文仍保留，但不再用于可读索引、回顾或长期记忆",
            (self.root / added["file"]).read_text(encoding="utf-8"),
        )
        self.assertNotIn("晚饭后散步", (self.root / "INDEX.md").read_text(encoding="utf-8"))

    def test_withdraw_latest_implicit_uses_recorded_at_not_event_date(self) -> None:
        older_implicit = self._add(
            self._entry(
                date="2026-08-01",
                time="20:00",
                title="先记录的当天经历",
                source="implicit",
                raw="这是先保存的隐式生活记录。",
            ),
            "older-implicit.json",
        )
        explicit = self._add(
            self._entry(
                date="2026-08-02",
                time="21:00",
                title="明确要求保存",
                source="explicit",
                raw="这是明确触发的记录。",
            ),
            "explicit-between.json",
        )
        newest_implicit = self._add(
            self._entry(
                date="2026-07-01",
                time=None,
                time_precision="unknown",
                title="刚补记的旧经历",
                source="implicit",
                raw="这是刚刚补记、但发生日期更早的隐式记录。",
            ),
            "newest-backdated-implicit.json",
        )
        records = self._records()
        recorded_times = {
            older_implicit["id"]: "2026-08-01T12:00:00+08:00",
            explicit["id"]: "2026-08-01T12:01:00+08:00",
            newest_implicit["id"]: "2026-08-01T12:02:00+08:00",
        }
        for record in records:
            record["recorded_at"] = recorded_times[record["id"]]
        JOURNAL_MANAGER._write_records(self.root / "index.jsonl", records)

        withdrawn = json.loads(
            self._run("withdraw-latest-implicit", "--root", str(self.root)).stdout
        )
        self.assertEqual(withdrawn["id"], newest_implicit["id"])
        self.assertEqual(withdrawn["resolved_by"], "latest_recorded_implicit")
        states = {record["id"]: record["status"] for record in self._records()}
        self.assertEqual(states[newest_implicit["id"]], "withdrawn")
        self.assertEqual(states[older_implicit["id"]], "active")
        self.assertEqual(states[explicit["id"]], "active")

        second = json.loads(
            self._run("withdraw-latest-implicit", "--root", str(self.root)).stdout
        )
        self.assertEqual(second["id"], older_implicit["id"])
        no_more = self._run(
            "withdraw-latest-implicit",
            "--root",
            str(self.root),
            expected_code=2,
        )
        self.assertIn("没有可撤回", no_more.stderr)
        self.assertEqual(
            next(record for record in self._records() if record["id"] == explicit["id"])["status"],
            "active",
        )

    def test_restore_reactivates_withdrawn_entry_without_reusing_stale_reviews(self) -> None:
        added = self._add(self._entry(), "restore-target.json")
        self._run("withdraw", "--root", str(self.root), "--id", added["id"])
        restored = json.loads(
            self._run("restore", "--root", str(self.root), "--id", added["id"]).stdout
        )
        self.assertEqual(restored["status"], "restored")
        listed = json.loads(self._run("list", "--root", str(self.root)).stdout)
        self.assertEqual([record["id"] for record in listed], [added["id"]])
        self.assertNotIn(
            "状态：已撤回",
            (self.root / added["file"]).read_text(encoding="utf-8"),
        )
        record = self._records()[0]
        self.assertEqual(record["status"], "active")
        self.assertNotIn("withdrawn_at", record)
        duplicate = json.loads(
            self._run("restore", "--root", str(self.root), "--id", added["id"]).stdout
        )
        self.assertEqual(duplicate["status"], "already_active")

    def test_withdraw_and_restore_state_markers_are_scoped_to_target_block(self) -> None:
        first = self._add(
            self._entry(time="20:00", title="同月条目 A", raw="A 的原话。"),
            "same-month-a.json",
        )
        second = self._add(
            self._entry(time="21:00", title="同月条目 B", raw="B 的原话。"),
            "same-month-b.json",
        )
        month_path = self.root / first["file"]

        def block(identifier: str) -> str:
            content = month_path.read_text(encoding="utf-8")
            start, end = JOURNAL_MANAGER._entry_block_bounds(content, identifier)
            return content[start:end]

        self._run("withdraw", "--root", str(self.root), "--id", first["id"])
        self._run("withdraw", "--root", str(self.root), "--id", second["id"])
        self.assertEqual(block(first["id"]).count(JOURNAL_MANAGER.WITHDRAWN_STATE_LINE), 1)
        self.assertEqual(block(second["id"]).count(JOURNAL_MANAGER.WITHDRAWN_STATE_LINE), 1)

        self._run("restore", "--root", str(self.root), "--id", second["id"])
        self.assertEqual(block(first["id"]).count(JOURNAL_MANAGER.WITHDRAWN_STATE_LINE), 1)
        self.assertEqual(block(second["id"]).count(JOURNAL_MANAGER.WITHDRAWN_STATE_LINE), 0)
        statuses = {record["id"]: record["status"] for record in self._records()}
        self.assertEqual(statuses[first["id"]], "withdrawn")
        self.assertEqual(statuses[second["id"]], "active")

        # 对已 active 的 B 重放 restore 也不得删除 A 的状态行。
        duplicate_restore = json.loads(
            self._run("restore", "--root", str(self.root), "--id", second["id"]).stdout
        )
        self.assertEqual(duplicate_restore["status"], "already_active")
        self.assertEqual(block(first["id"]).count(JOURNAL_MANAGER.WITHDRAWN_STATE_LINE), 1)

        # 撤回/恢复各自重放后，目标块的状态行仍是 0 或 1 条。
        self._run("withdraw", "--root", str(self.root), "--id", second["id"])
        repeated_withdraw = json.loads(
            self._run("withdraw", "--root", str(self.root), "--id", second["id"]).stdout
        )
        self.assertEqual(repeated_withdraw["status"], "already_withdrawn")
        self.assertEqual(block(first["id"]).count(JOURNAL_MANAGER.WITHDRAWN_STATE_LINE), 1)
        self.assertEqual(block(second["id"]).count(JOURNAL_MANAGER.WITHDRAWN_STATE_LINE), 1)
        self._run("restore", "--root", str(self.root), "--id", second["id"])
        self.assertEqual(block(first["id"]).count(JOURNAL_MANAGER.WITHDRAWN_STATE_LINE), 1)
        self.assertEqual(block(second["id"]).count(JOURNAL_MANAGER.WITHDRAWN_STATE_LINE), 0)

    def test_withdraw_invalidates_linked_reviews_idempotently(self) -> None:
        target = self._add(self._entry(), "reviewed-target.json")
        other = self._add(
            self._entry(
                date="2026-08-02",
                time="09:15",
                title="早上晒太阳",
                raw="今早晒了十分钟太阳。",
            ),
            "reviewed-other.json",
        )
        common = {
            "title": "测试回顾",
            "entry_ids": [target["id"], other["id"]],
            "events": ["散步和日光"],
            "replenishing": ["户外活动"],
            "draining": [],
            "recurring": [],
            "open_threads": [],
            "planning_implications": ["保留轻活动"],
            "candidate_memories": [],
        }
        weekly = self._review(
            dict(common, type="weekly", start="2026-07-27", end="2026-08-02"),
            "linked-weekly.json",
        )
        monthly = self._review(
            dict(common, type="monthly", start="2026-08-01", end="2026-08-31"),
            "linked-monthly.json",
        )

        first = json.loads(
            self._run("withdraw", "--root", str(self.root), "--id", target["id"]).stdout
        )
        expected_affected = sorted([weekly["file"], monthly["file"]])
        self.assertEqual(first["status"], "withdrawn")
        self.assertEqual(first["affected_reviews"], expected_affected)

        records = {record["id"]: record for record in self._records()}
        self.assertEqual(records[target["id"]]["weekly_reviews"], [])
        self.assertEqual(records[target["id"]]["monthly_reviews"], [])
        self.assertEqual(records[other["id"]]["weekly_reviews"], [])
        self.assertEqual(records[other["id"]]["monthly_reviews"], [])
        self.assertEqual(records[other["id"]]["invalidated_reviews"], expected_affected)

        warning = "来源日记已撤回，本回顾需刷新后再用于规划"
        for relative_file in expected_affected:
            content = (self.root / relative_file).read_text(encoding="utf-8")
            self.assertEqual(content.count(warning), 1)
            self.assertLess(content.index(warning), 150)

        second = json.loads(
            self._run("withdraw", "--root", str(self.root), "--id", target["id"]).stdout
        )
        self.assertEqual(second["status"], "already_withdrawn")
        self.assertEqual(second["affected_reviews"], [])
        self.assertEqual(second["invalidated_reviews"], expected_affected)
        for relative_file in expected_affected:
            content = (self.root / relative_file).read_text(encoding="utf-8")
            self.assertEqual(content.count(warning), 1)

    def test_purge_requires_withdraw_exact_confirmation_and_scope_acknowledgement(self) -> None:
        added = self._add(self._entry(), "purge-guard-target.json")
        plan = json.loads(
            self._run("purge-plan", "--root", str(self.root), "--id", added["id"]).stdout
        )
        self.assertEqual(plan["status"], "withdraw-first")
        self.assertTrue(plan["historical_copies_outside_project_unknown"])
        active = self._purge(added["id"], expected_code=2)
        self.assertIn("先 withdraw", active.stderr)

        self._run("withdraw", "--root", str(self.root), "--id", added["id"])
        mismatch = self._purge(
            added["id"], confirmation="wrong-id", expected_code=2
        )
        self.assertIn("确认不匹配", mismatch.stderr)
        no_ack = self._purge(added["id"], acknowledge=False, expected_code=2)
        self.assertIn("历史 ZIP", no_ack.stderr)
        self.assertIn(added["id"], (self.root / "index.jsonl").read_text(encoding="utf-8"))
        self.assertIn(
            self._entry()["raw"],
            (self.root / added["file"]).read_text(encoding="utf-8"),
        )

    def test_purge_removes_current_source_index_and_derived_review_but_not_backup(self) -> None:
        target = self._add(self._entry(), "purge-target.json")
        other = self._add(
            self._entry(
                date="2026-08-02",
                time="08:20",
                title="保留条目",
                raw="这条内容需要保留。",
            ),
            "purge-other.json",
        )
        review = self._review(
            {
                "type": "weekly",
                "start": "2026-07-27",
                "end": "2026-08-02",
                "title": "含待删除来源的回顾",
                "entry_ids": [target["id"], other["id"]],
                "events": ["散步和另一条经历"],
                "replenishing": [],
                "draining": [],
                "recurring": [],
                "open_threads": [],
                "planning_implications": [],
                "candidate_memories": [],
            },
            "purge-review.json",
        )
        self._run("withdraw", "--root", str(self.root), "--id", target["id"])

        backup_dir = self.temp_path / "backups"
        backup_dir.mkdir()
        backup_path = backup_dir / "生活助手-完整备份-2026-08-01-test.zip"
        source_path = self.root / target["file"]
        with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(
                source_path,
                arcname=f"codex-生活助手/journal/{target['file']}",
            )
        backup_before = backup_path.read_bytes()

        plan_result = self._run(
            "purge-plan", "--root", str(self.root), "--id", target["id"]
        )
        plan = json.loads(plan_result.stdout)
        self.assertEqual(plan["status"], "ready")
        self.assertEqual(plan["affected_reviews"], [review["file"]])
        self.assertEqual(plan["known_backup_copies"], [f"backups/{backup_path.name}"])
        self.assertNotIn(self._entry()["raw"], plan_result.stdout)
        self.assertTrue((self.root / review["file"]).exists())
        self.assertIn(target["id"], (self.root / "index.jsonl").read_text(encoding="utf-8"))

        purged = self._purge(target["id"])
        self.assertEqual(purged["status"], "purged")
        self.assertEqual(purged["scope"], "current-project-only")
        self.assertEqual(purged["deleted_reviews"], [review["file"]])
        self.assertEqual(
            purged["known_backup_copies"],
            [f"backups/{backup_path.name}"],
        )
        self.assertFalse((self.root / review["file"]).exists())
        month_text = source_path.read_text(encoding="utf-8")
        self.assertNotIn(target["id"], month_text)
        self.assertNotIn(self._entry()["raw"], month_text)
        self.assertIn("这条内容需要保留。", month_text)
        records = self._records()
        self.assertEqual([record["id"] for record in records], [other["id"]])
        self.assertEqual(records[0]["weekly_reviews"], [])
        self.assertNotIn(target["id"], (self.root / "INDEX.md").read_text(encoding="utf-8"))
        self.assertEqual(backup_path.read_bytes(), backup_before)

    def test_purge_recovers_after_interruption_before_index_commit(self) -> None:
        target = self._add(self._entry(), "recover-before-index-target.json")
        other = self._add(
            self._entry(
                date="2026-08-02",
                time="08:20",
                title="恢复测试保留条目",
                raw="这条内容在恢复后仍应保留。",
            ),
            "recover-before-index-other.json",
        )
        review = self._review(
            {
                "type": "weekly",
                "start": "2026-07-27",
                "end": "2026-08-02",
                "title": "中断恢复测试回顾",
                "entry_ids": [target["id"], other["id"]],
                "events": ["两条测试记录"],
                "replenishing": [],
                "draining": [],
                "recurring": [],
                "open_threads": [],
                "planning_implications": [],
                "candidate_memories": [],
            },
            "recover-before-index-review.json",
        )
        self._run("withdraw", "--root", str(self.root), "--id", target["id"])

        with mock.patch.object(
            JOURNAL_MANAGER,
            "_write_records",
            side_effect=OSError("simulated interruption before index commit"),
        ):
            with self.assertRaises(OSError):
                JOURNAL_MANAGER.purge_entry(
                    self.root.resolve(),
                    target["id"],
                    target["id"],
                    acknowledge_historical_copies=True,
                )

        operation_path = JOURNAL_MANAGER._purge_operation_path(
            self.root.resolve(), target["id"]
        )
        self.assertTrue(operation_path.exists())
        operation_text = operation_path.read_text(encoding="utf-8")
        self.assertNotIn(self._entry()["raw"], operation_text)
        self.assertFalse((self.root / review["file"]).exists())
        self.assertIn(target["id"], (self.root / "index.jsonl").read_text(encoding="utf-8"))

        plan = json.loads(
            self._run(
                "purge-plan", "--root", str(self.root), "--id", target["id"]
            ).stdout
        )
        self.assertEqual(plan["status"], "resume")
        self.assertTrue(plan["operation_pending"])
        recovered = self._purge(target["id"])
        self.assertEqual(recovered["status"], "recovered")
        self.assertTrue(recovered["resumed_operation"])
        self.assertFalse(operation_path.exists())
        records = self._records()
        self.assertEqual([record["id"] for record in records], [other["id"]])
        self.assertEqual(records[0]["weekly_reviews"], [])
        self.assertEqual(records[0]["invalidated_reviews"], [])

    def test_purge_recovers_when_operation_cleanup_was_interrupted(self) -> None:
        target = self._add(self._entry(), "recover-after-index-target.json")
        self._run("withdraw", "--root", str(self.root), "--id", target["id"])
        root = self.root.resolve()
        operation_path = JOURNAL_MANAGER._purge_operation_path(root, target["id"])
        original_unlink = Path.unlink
        failure_injected = False

        def fail_operation_cleanup(path: Path, *args: object, **kwargs: object) -> None:
            nonlocal failure_injected
            if path == operation_path and not failure_injected:
                failure_injected = True
                raise OSError("simulated interruption during operation cleanup")
            original_unlink(path, *args, **kwargs)

        with mock.patch.object(Path, "unlink", new=fail_operation_cleanup):
            with self.assertRaises(OSError):
                JOURNAL_MANAGER.purge_entry(
                    root,
                    target["id"],
                    target["id"],
                    acknowledge_historical_copies=True,
                )

        self.assertTrue(operation_path.exists())
        self.assertEqual(self._records(), [])
        source_text = (self.root / target["file"]).read_text(encoding="utf-8")
        self.assertNotIn(target["id"], source_text)
        plan = json.loads(
            self._run(
                "purge-plan", "--root", str(self.root), "--id", target["id"]
            ).stdout
        )
        self.assertEqual(plan["status"], "resume")
        self.assertFalse(plan["source_present"])
        recovered = self._purge(target["id"])
        self.assertEqual(recovered["status"], "recovered")
        self.assertTrue(recovered["source_already_absent"])
        self.assertFalse(operation_path.exists())

    def test_pending_purge_freezes_hashes_and_blocks_every_other_write(self) -> None:
        target = self._add(self._entry(), "pending-target.json")
        other = self._add(
            self._entry(
                date="2026-08-02",
                time="09:00",
                title="保留条目",
                raw="这条保留。",
            ),
            "pending-other.json",
        )
        restore_candidate = self._add(
            self._entry(
                date="2026-08-03",
                time="10:00",
                title="可恢复条目",
                raw="这条先撤回。",
            ),
            "pending-restore.json",
        )
        review_payload = {
            "type": "weekly",
            "start": "2026-07-27",
            "end": "2026-08-02",
            "title": "pending purge 测试回顾",
            "entry_ids": [target["id"], other["id"]],
            "events": ["两条记录"],
            "replenishing": [],
            "draining": [],
            "recurring": [],
            "open_threads": [],
            "planning_implications": [],
            "candidate_memories": [],
        }
        review = self._review(review_payload, "pending-review.json")
        self._run(
            "withdraw", "--root", str(self.root), "--id", restore_candidate["id"]
        )
        self._run("withdraw", "--root", str(self.root), "--id", target["id"])
        operation_path = self._interrupt_purge_after_operation(target["id"])

        operation = json.loads(operation_path.read_text(encoding="utf-8"))
        self.assertEqual(operation["schema_version"], 2)
        self.assertRegex(operation["source_block_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(operation["index_references"], [review["file"]])
        self.assertEqual(
            [item["path"] for item in operation["reviews"]], [review["file"]]
        )
        self.assertRegex(operation["reviews"][0]["sha256"], r"^[0-9a-f]{64}$")
        operation_text = operation_path.read_text(encoding="utf-8")
        self.assertNotIn(self._entry()["raw"], operation_text)
        self.assertNotIn(target["title"], operation_text)

        root = self.root.resolve()
        blocked_calls = [
            lambda: JOURNAL_MANAGER.add_entry(
                root,
                self._entry(
                    time="11:00", title="新记录", raw="不应该在 pending purge 时写入。"
                ),
            ),
            lambda: JOURNAL_MANAGER.amend_entry(
                root,
                {
                    "id": other["id"],
                    "note": "不应该写入的更正。",
                    "privacy": "local-only",
                },
            ),
            lambda: JOURNAL_MANAGER.withdraw_entry(root, other["id"]),
            lambda: JOURNAL_MANAGER.restore_entry(root, restore_candidate["id"]),
            lambda: JOURNAL_MANAGER.create_review(
                root, dict(review_payload, entry_ids=[other["id"]])
            ),
            lambda: JOURNAL_MANAGER.purge_entry(
                root,
                restore_candidate["id"],
                restore_candidate["id"],
                acknowledge_historical_copies=True,
            ),
        ]
        for position, call in enumerate(blocked_calls):
            with self.subTest(position=position):
                with self.assertRaisesRegex(
                    JOURNAL_MANAGER.JournalError, "阻止其他写操作"
                ):
                    call()

        listed = JOURNAL_MANAGER.list_entries(root)
        self.assertEqual([item["id"] for item in listed], [other["id"]])
        plan = JOURNAL_MANAGER.purge_plan(root, target["id"])
        self.assertEqual(plan["status"], "resume")
        recovered = JOURNAL_MANAGER.purge_entry(
            root,
            target["id"],
            target["id"],
            acknowledge_historical_copies=True,
        )
        self.assertEqual(recovered["status"], "recovered")
        self.assertFalse(operation_path.exists())

    def test_purge_resume_fails_closed_on_review_source_or_scope_drift(self) -> None:
        target = self._add(self._entry(), "drift-target.json")
        other = self._add(
            self._entry(
                date="2026-08-02",
                time="09:00",
                title="漂移测试保留条目",
                raw="这条需要保留。",
            ),
            "drift-other.json",
        )
        review = self._review(
            {
                "type": "weekly",
                "start": "2026-07-27",
                "end": "2026-08-02",
                "title": "漂移测试回顾",
                "entry_ids": [target["id"], other["id"]],
                "events": ["原始回顾内容"],
                "replenishing": [],
                "draining": [],
                "recurring": [],
                "open_threads": [],
                "planning_implications": [],
                "candidate_memories": [],
            },
            "drift-review.json",
        )
        self._run("withdraw", "--root", str(self.root), "--id", target["id"])
        operation_path = self._interrupt_purge_after_operation(target["id"])
        root = self.root.resolve()
        review_path = root / review["file"]
        original_review = review_path.read_text(encoding="utf-8")

        review_path.write_text(
            original_review.replace("原始回顾内容", "中断后被改写的回顾"),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(JOURNAL_MANAGER.JournalError, "已变化"):
            JOURNAL_MANAGER.purge_entry(
                root,
                target["id"],
                target["id"],
                acknowledge_historical_copies=True,
            )
        self.assertTrue(review_path.exists())
        self.assertTrue(operation_path.exists())
        self.assertIn(target["id"], (root / "index.jsonl").read_text(encoding="utf-8"))

        review_path.write_text(original_review, encoding="utf-8")
        extra_relative = "reviews/2026/2026-08.md"
        extra_review = root / extra_relative
        extra_review.write_text(
            "\n".join(
                [
                    "# 中断后出现的新回顾",
                    "",
                    f"<!-- journal-review: monthly {extra_relative} -->",
                    "",
                    "## 来源日记",
                    "",
                    f"- 2026-08-01 22:35｜条目（`{target['id']}`）",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(JOURNAL_MANAGER.JournalError, "范围漂移"):
            JOURNAL_MANAGER.purge_entry(
                root,
                target["id"],
                target["id"],
                acknowledge_historical_copies=True,
            )
        self.assertTrue(review_path.exists())
        self.assertTrue(extra_review.exists())
        self.assertTrue(operation_path.exists())

    def test_purge_resume_fails_closed_when_target_source_block_changed(self) -> None:
        target = self._add(self._entry(), "source-drift-target.json")
        self._run("withdraw", "--root", str(self.root), "--id", target["id"])
        operation_path = self._interrupt_purge_after_operation(target["id"])
        root = self.root.resolve()
        source_path = root / target["file"]
        source = source_path.read_text(encoding="utf-8")
        source_path.write_text(
            source.replace(self._entry()["raw"], "中断后被改写的目标原文。"),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(JOURNAL_MANAGER.JournalError, "原文块.*已变化"):
            JOURNAL_MANAGER.purge_entry(
                root,
                target["id"],
                target["id"],
                acknowledge_historical_copies=True,
            )
        self.assertTrue(operation_path.exists())
        self.assertIn("中断后被改写的目标原文", source_path.read_text(encoding="utf-8"))
        self.assertIn(target["id"], (root / "index.jsonl").read_text(encoding="utf-8"))

    def test_purge_revalidates_source_after_contract_before_first_delete(self) -> None:
        target = self._add(self._entry(), "pre-delete-source-drift-target.json")
        self._run("withdraw", "--root", str(self.root), "--id", target["id"])
        root = self.root.resolve()
        source_path = root / target["file"]

        def mutate_during_backup_scan(
            _root: Path, _relative_file: str, _identifier: str
        ) -> tuple[list[str], list[str]]:
            source = source_path.read_text(encoding="utf-8")
            source_path.write_text(
                source.replace(self._entry()["raw"], "契约持久化后被改写的内容。"),
                encoding="utf-8",
            )
            return [], []

        with mock.patch.object(
            JOURNAL_MANAGER,
            "_known_backup_copies",
            side_effect=mutate_during_backup_scan,
        ):
            with self.assertRaisesRegex(JOURNAL_MANAGER.JournalError, "原文块.*已变化"):
                JOURNAL_MANAGER.purge_entry(
                    root,
                    target["id"],
                    target["id"],
                    acknowledge_historical_copies=True,
                )

        operation_path = JOURNAL_MANAGER._purge_operation_path(root, target["id"])
        self.assertTrue(operation_path.exists())
        self.assertIn("契约持久化后被改写的内容", source_path.read_text(encoding="utf-8"))
        self.assertIn(target["id"], (root / "index.jsonl").read_text(encoding="utf-8"))

    def test_purge_operation_rejects_unknown_or_sensitive_metadata_fields(self) -> None:
        target = self._add(self._entry(), "operation-shape-target.json")
        self._run("withdraw", "--root", str(self.root), "--id", target["id"])
        operation_path = self._interrupt_purge_after_operation(target["id"])
        payload = json.loads(operation_path.read_text(encoding="utf-8"))
        payload["raw"] = "不应该出现在恢复元数据中的原文"
        operation_path.write_text(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        root = self.root.resolve()
        with self.assertRaisesRegex(JOURNAL_MANAGER.JournalError, "结构无效"):
            JOURNAL_MANAGER.purge_plan(root, target["id"])
        with self.assertRaisesRegex(JOURNAL_MANAGER.JournalError, "结构无效"):
            JOURNAL_MANAGER.purge_entry(
                root,
                target["id"],
                target["id"],
                acknowledge_historical_copies=True,
            )
        self.assertTrue(operation_path.exists())
        self.assertIn(target["id"], (root / "index.jsonl").read_text(encoding="utf-8"))
        self.assertIn(
            self._entry()["raw"], (root / target["file"]).read_text(encoding="utf-8")
        )

    def test_purge_rejects_unmanaged_or_wrong_source_review_references(self) -> None:
        target = self._add(self._entry(), "unsafe-reference-target.json")
        other = self._add(
            self._entry(
                date="2026-08-02",
                time="09:00",
                title="无关回顾来源",
                raw="这条不是待删除条目。",
            ),
            "unsafe-reference-other.json",
        )
        self._run("withdraw", "--root", str(self.root), "--id", target["id"])
        root = self.root.resolve()
        unmanaged_relative = "reviews/2026/unmanaged.md"
        unmanaged_path = root / unmanaged_relative
        unmanaged_path.parent.mkdir(parents=True, exist_ok=True)
        unmanaged_path.write_text("# 完全无关的文件\n", encoding="utf-8")
        records = JOURNAL_MANAGER._load_records(root / "index.jsonl")
        records_by_id = {record["id"]: record for record in records}
        records_by_id[target["id"]]["invalidated_reviews"] = [unmanaged_relative]
        JOURNAL_MANAGER._write_records(root / "index.jsonl", records)

        with self.assertRaisesRegex(JOURNAL_MANAGER.JournalError, "受管标记"):
            JOURNAL_MANAGER.purge_plan(root, target["id"])
        with self.assertRaisesRegex(JOURNAL_MANAGER.JournalError, "受管标记"):
            JOURNAL_MANAGER.purge_entry(
                root,
                target["id"],
                target["id"],
                acknowledge_historical_copies=True,
            )
        self.assertTrue(unmanaged_path.exists())
        self.assertFalse(JOURNAL_MANAGER._purge_operation_path(root, target["id"]).exists())

        records_by_id[target["id"]]["invalidated_reviews"] = []
        JOURNAL_MANAGER._write_records(root / "index.jsonl", records)
        generated = JOURNAL_MANAGER.create_review(
            root,
            {
                "type": "weekly",
                "start": "2026-07-27",
                "end": "2026-08-02",
                "title": "只引用其他条目的回顾",
                "entry_ids": [other["id"]],
                "source_set_etag": JOURNAL_MANAGER._review_source_set_etag(
                    "weekly", "2026-07-27", "2026-08-02", [other["id"]]
                ),
                "events": [],
                "replenishing": [],
                "draining": [],
                "recurring": [],
                "open_threads": [],
                "planning_implications": [],
                "candidate_memories": [],
            },
        )
        records = JOURNAL_MANAGER._load_records(root / "index.jsonl")
        for record in records:
            if record["id"] == target["id"]:
                record["invalidated_reviews"] = [generated["file"]]
        JOURNAL_MANAGER._write_records(root / "index.jsonl", records)
        with self.assertRaisesRegex(JOURNAL_MANAGER.JournalError, "未精确引用"):
            JOURNAL_MANAGER.purge_entry(
                root,
                target["id"],
                target["id"],
                acknowledge_historical_copies=True,
            )
        self.assertTrue((root / generated["file"]).exists())
        self.assertIn(target["id"], (root / "index.jsonl").read_text(encoding="utf-8"))

    def test_list_fails_closed_on_unrecognized_or_missing_status(self) -> None:
        active = self._add(self._entry(), "active-list-entry.json")
        archived = self._add(
            self._entry(date="2026-08-02", time="20:00", title="已归档", raw="这条不再活跃。"),
            "archived-list-entry.json",
        )
        records = self._records()
        for record in records:
            if record["id"] == archived["id"]:
                record["status"] = "archived"
        (self.root / "index.jsonl").write_text(
            "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
            encoding="utf-8",
        )
        archived_result = self._run(
            "list", "--root", str(self.root), expected_code=2
        )
        self.assertIn("结构无效", archived_result.stderr)

        records = self._records()
        for record in records:
            if record["id"] == archived["id"]:
                record["status"] = "active"
            if record["id"] == active["id"]:
                record.pop("status")
        (self.root / "index.jsonl").write_text(
            "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
            encoding="utf-8",
        )
        missing_result = self._run(
            "list", "--root", str(self.root), expected_code=2
        )
        self.assertIn("结构无效", missing_result.stderr)

    def test_weekly_review_updates_index_and_is_idempotent(self) -> None:
        first = self._add(self._entry(), "weekly-first.json")
        second = self._add(
            self._entry(
                date="2026-08-02",
                time="09:15",
                title="早上晒太阳",
                raw="今早晒了十分钟太阳。",
                summary="早上接触了自然光。",
            ),
            "weekly-second.json",
        )
        payload = {
            "type": "weekly",
            "start": "2026-07-27",
            "end": "2026-08-02",
            "title": "8 月第一周生活回顾",
            "entry_ids": [first["id"], second["id"]],
            "events": ["散步", "早上晒太阳"],
            "replenishing": ["户外的风和日光"],
            "draining": ["交接任务叠加"],
            "recurring": ["轻活动后更放松"],
            "open_threads": ["继续观察入睡时间"],
            "planning_implications": ["下周只保留一个轻量实验"],
            "candidate_memories": ["用户可能喜欢低压户外活动"],
            "privacy": "local-only",
        }

        added = self._review(payload)
        self.assertEqual(added["status"], "added")
        self.assertEqual(added["type"], "weekly")
        review_path = self.root / added["file"]
        first_content = review_path.read_text(encoding="utf-8")
        self.assertIn("候选长期认识（待用户确认）", first_content)
        self.assertIn("待用户确认：用户可能喜欢低压户外活动", first_content)
        self.assertIn(first["id"], first_content)
        self.assertIn(second["id"], first_content)

        records = {record["id"]: record for record in self._records()}
        self.assertEqual(records[first["id"]]["weekly_reviews"], [added["file"]])
        self.assertEqual(records[second["id"]]["weekly_reviews"], [added["file"]])
        self.assertEqual(records[first["id"]]["monthly_reviews"], [])

        duplicate = self._review(payload, "weekly-same.json")
        self.assertEqual(duplicate["status"], "exists")
        self.assertEqual(review_path.read_text(encoding="utf-8"), first_content)
        for record in self._records():
            self.assertEqual(record["weekly_reviews"].count(added["file"]), 1)

        payload["events"] = ["散步", "早上晒太阳", "整理了书桌"]
        refreshed = self._review(payload, "weekly-updated.json")
        self.assertEqual(refreshed["status"], "updated")
        self.assertEqual(refreshed["file"], added["file"])
        self.assertIn("整理了书桌", review_path.read_text(encoding="utf-8"))

        review_before = review_path.read_bytes()
        index_before = (self.root / "index.jsonl").read_bytes()
        payload["entry_ids"] = [first["id"]]
        incomplete = self._review(
            payload,
            "weekly-incomplete-source-set.json",
            expected_code=2,
        )
        self.assertIn("来源集合已变化或不完整", incomplete.stderr)
        self.assertEqual(review_path.read_bytes(), review_before)
        self.assertEqual((self.root / "index.jsonl").read_bytes(), index_before)
        records = {record["id"]: record for record in self._records()}
        self.assertEqual(records[first["id"]]["weekly_reviews"], [added["file"]])
        self.assertEqual(records[second["id"]]["weekly_reviews"], [added["file"]])

    def test_review_source_lines_preserve_event_time_precision(self) -> None:
        exact = self._add(self._entry(), "review-time-exact.json")
        unknown = self._add(
            self._entry(
                date="2026-07-30",
                time=None,
                time_precision="unknown",
                title="不确定时间的聚会",
                raw="那天和朋友见了面，但不记得具体时间。",
            ),
            "review-time-unknown.json",
        )
        approximate = self._add(
            self._entry(
                date="2026-07-31",
                time="21:00",
                time_precision="approximate",
                title="大约九点散步",
                raw="那天大约九点出去走了走。",
            ),
            "review-time-approximate.json",
        )
        reviewed = self._review(
            {
                "type": "weekly",
                "start": "2026-07-27",
                "end": "2026-08-02",
                "title": "时间精度回顾",
                "entry_ids": [exact["id"], unknown["id"], approximate["id"]],
                "events": [],
                "replenishing": [],
                "draining": [],
                "recurring": [],
                "open_threads": [],
                "planning_implications": [],
                "candidate_memories": [],
                "privacy": "local-only",
            },
            "review-time-precision.json",
        )

        review_text = (self.root / reviewed["file"]).read_text(encoding="utf-8")
        self.assertIn("2026-07-30 时间未知｜", review_text)
        self.assertIn("2026-07-31 约 21:00｜", review_text)
        self.assertIn("2026-08-01 22:35｜", review_text)
        self.assertNotIn(" None｜", review_text)

    def test_review_plan_waits_for_closed_periods_and_backfills_new_entries(self) -> None:
        first = self._add(
            self._entry(date="2026-08-01", time="20:00", title="周六记录"),
            "review-plan-first.json",
        )
        second = self._add(
            self._entry(
                date="2026-08-02",
                time=None,
                time_precision="unknown",
                title="周日记录",
                raw="周日发生了一件值得记下的事，具体时间不清楚。",
            ),
            "review-plan-second.json",
        )
        current_week = self._add(
            self._entry(date="2026-08-03", time="09:00", title="新周记录"),
            "review-plan-current.json",
        )

        sunday_plan = JOURNAL_MANAGER.review_plan(
            self.root.resolve(), "weekly", "2026-08-02"
        )
        self.assertEqual(sunday_plan["due"], [])

        monday_plan = JOURNAL_MANAGER.review_plan(
            self.root.resolve(), "weekly", "2026-08-03"
        )
        self.assertEqual(len(monday_plan["due"]), 1)
        period = monday_plan["due"][0]
        self.assertEqual((period["start"], period["end"]), ("2026-07-27", "2026-08-02"))
        self.assertEqual(set(period["entry_ids"]), {first["id"], second["id"]})
        self.assertEqual(period["reason"], "missing_review")
        expected_contract = {
            "schema_version": 1,
            "type": "weekly",
            "start": "2026-07-27",
            "end": "2026-08-02",
            "entry_ids": sorted([first["id"], second["id"]]),
        }
        expected_etag = hashlib.sha256(
            json.dumps(
                expected_contract,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        self.assertEqual(period["source_set_etag"], expected_etag)
        self.assertEqual(
            period["source_set_etag"],
            JOURNAL_MANAGER._review_source_set_etag(
                "weekly",
                "2026-07-27",
                "2026-08-02",
                list(reversed(period["entry_ids"])),
            ),
        )
        self.assertNotIn(current_week["id"], json.dumps(monday_plan))

        review_payload = {
            "type": "weekly",
            "start": period["start"],
            "end": period["end"],
            "title": "刚结束自然周的生活回顾",
            "entry_ids": period["entry_ids"],
            "source_set_etag": period["source_set_etag"],
            "events": ["周末的两段生活记录"],
            "replenishing": [],
            "draining": [],
            "recurring": [],
            "open_threads": [],
            "planning_implications": [],
            "candidate_memories": [],
            "privacy": "local-only",
        }
        self._review(review_payload, "review-plan-created.json")
        self.assertEqual(
            JOURNAL_MANAGER.review_plan(self.root.resolve(), "weekly", "2026-08-03")["due"],
            [],
        )

        late = self._add(
            self._entry(
                date="2026-08-02",
                time="23:00",
                title="后来补记的周日晚间",
                raw="周一才补记周日晚间发生的事情。",
            ),
            "review-plan-late.json",
        )
        refreshed_plan = JOURNAL_MANAGER.review_plan(
            self.root.resolve(), "weekly", "2026-08-04"
        )
        self.assertEqual(len(refreshed_plan["due"]), 1)
        self.assertEqual(refreshed_plan["due"][0]["reason"], "source_set_changed")
        self.assertEqual(
            set(refreshed_plan["due"][0]["entry_ids"]),
            {first["id"], second["id"], late["id"]},
        )

        monthly_plan = JOURNAL_MANAGER.review_plan(
            self.root.resolve(), "monthly", "2026-09-01"
        )
        self.assertEqual(len(monthly_plan["due"]), 1)
        self.assertEqual(
            (monthly_plan["due"][0]["start"], monthly_plan["due"][0]["end"]),
            ("2026-08-01", "2026-08-31"),
        )
        self.assertIn(current_week["id"], monthly_plan["due"][0]["entry_ids"])

    def test_review_fails_closed_when_another_write_changes_sources_after_plan(self) -> None:
        first = self._add(
            self._entry(date="2026-08-01", time="20:00", title="计划时已有记录"),
            "source-race-first.json",
        )
        plan = JOURNAL_MANAGER.review_plan(
            self.root.resolve(), "weekly", "2026-08-03"
        )
        self.assertEqual(len(plan["due"]), 1)
        stale_period = plan["due"][0]
        self.assertEqual(stale_period["entry_ids"], [first["id"]])

        # 模拟 review-plan 释放锁后，另一个写请求补记到同一已闭合周期。
        late = self._add(
            self._entry(
                date="2026-08-02",
                time="23:10",
                title="计划后并发补记",
                raw="另一个写请求在回顾计划后补记了周日经历。",
            ),
            "source-race-late.json",
        )
        index_before = (self.root / "index.jsonl").read_bytes()
        readable_index_before = (self.root / "INDEX.md").read_bytes()
        result = self._review(
            {
                "type": "weekly",
                "start": stale_period["start"],
                "end": stale_period["end"],
                "title": "使用过期来源契约的回顾",
                "entry_ids": stale_period["entry_ids"],
                "source_set_etag": stale_period["source_set_etag"],
                "events": ["只包含计划时的记录"],
                "replenishing": [],
                "draining": [],
                "recurring": [],
                "open_threads": [],
                "planning_implications": [],
                "candidate_memories": [],
            },
            "source-race-stale-review.json",
            expected_code=2,
        )
        self.assertIn("来源集合已变化或不完整", result.stderr)
        self.assertEqual((self.root / "index.jsonl").read_bytes(), index_before)
        self.assertEqual((self.root / "INDEX.md").read_bytes(), readable_index_before)
        self.assertFalse((self.root / stale_period["file"]).exists())

        refreshed = JOURNAL_MANAGER.review_plan(
            self.root.resolve(), "weekly", "2026-08-03"
        )["due"][0]
        self.assertEqual(set(refreshed["entry_ids"]), {first["id"], late["id"]})
        self.assertNotEqual(refreshed["source_set_etag"], stale_period["source_set_etag"])

    def test_review_requires_and_validates_source_set_etag(self) -> None:
        entry = self._add(self._entry(), "missing-source-etag-entry.json")
        payload = {
            "type": "weekly",
            "start": "2026-07-27",
            "end": "2026-08-02",
            "title": "缺少来源契约的回顾",
            "entry_ids": [entry["id"]],
            "events": [],
            "replenishing": [],
            "draining": [],
            "recurring": [],
            "open_threads": [],
            "planning_implications": [],
            "candidate_memories": [],
        }
        missing = self._review(
            payload,
            "missing-source-etag-review.json",
            expected_code=2,
            attach_source_set_etag=False,
        )
        self.assertIn("缺少必填字段：source_set_etag", missing.stderr)

        wrong = self._review(
            dict(payload, source_set_etag="0" * 64),
            "wrong-source-etag-review.json",
            expected_code=2,
        )
        self.assertIn("来源集合已变化或不完整", wrong.stderr)
        self.assertFalse((self.root / "reviews").exists())

    def test_monthly_review_updates_monthly_status(self) -> None:
        entry = self._add(self._entry(), "monthly-entry.json")
        result = self._review(
            {
                "type": "monthly",
                "start": "2026-08-01",
                "end": "2026-08-31",
                "title": "2026 年 8 月生活回顾",
                "entry_ids": [entry["id"]],
                "events": ["开始用对话记录生活"],
                "replenishing": [],
                "draining": [],
                "recurring": [],
                "open_threads": ["睡眠恢复"],
                "planning_implications": ["保持低负担记录"],
                "candidate_memories": [],
            },
            "monthly.json",
        )
        self.assertEqual(result["status"], "added")
        self.assertEqual(result["file"], "reviews/2026/2026-08.md")
        record = self._records()[0]
        self.assertEqual(record["monthly_reviews"], [result["file"]])
        self.assertEqual(record["weekly_reviews"], [])
        self.assertIn("每月生活回顾", (self.root / result["file"]).read_text(encoding="utf-8"))

    def test_reviews_require_canonical_natural_periods(self) -> None:
        entry = self._add(self._entry(), "canonical-period-entry.json")
        base = {
            "title": "周期校验回顾",
            "entry_ids": [entry["id"]],
            "events": [],
            "replenishing": [],
            "draining": [],
            "recurring": [],
            "open_threads": [],
            "planning_implications": [],
            "candidate_memories": [],
        }
        weekly = self._review(
            dict(
                base,
                type="weekly",
                start="2026-08-01",
                end="2026-08-07",
            ),
            "noncanonical-week.json",
            expected_code=2,
        )
        self.assertIn("周一至周日", weekly.stderr)
        monthly = self._review(
            dict(
                base,
                type="monthly",
                start="2026-08-01",
                end="2026-08-30",
            ),
            "partial-month.json",
            expected_code=2,
        )
        self.assertIn("完整自然月", monthly.stderr)

    def test_cross_year_iso_week_uses_iso_year_filename(self) -> None:
        entry = self._add(
            self._entry(
                date="2026-12-31",
                time="18:00",
                title="跨年周记录",
                raw="跨年周里的一条生活记录。",
            ),
            "cross-year-entry.json",
        )
        result = self._review(
            {
                "type": "weekly",
                "start": "2026-12-28",
                "end": "2027-01-03",
                "title": "跨年自然周回顾",
                "entry_ids": [entry["id"]],
                "events": [],
                "replenishing": [],
                "draining": [],
                "recurring": [],
                "open_threads": [],
                "planning_implications": [],
                "candidate_memories": [],
            },
            "cross-year-review.json",
        )
        self.assertEqual(result["file"], "reviews/2026/2026-W53.md")

    def test_existing_review_with_conflicting_period_is_not_overwritten(self) -> None:
        entry = self._add(self._entry(), "conflicting-period-entry.json")
        review_path = self.root / "reviews/2026/2026-W31.md"
        review_path.parent.mkdir(parents=True, exist_ok=True)
        original = (
            "# 旧回顾\n\n"
            "<!-- journal-review: weekly reviews/2026/2026-W31.md -->\n\n"
            "- 范围：2026-07-28 至 2026-08-03\n\n"
            "不得被覆盖。\n"
        )
        review_path.write_text(original, encoding="utf-8")
        result = self._review(
            {
                "type": "weekly",
                "start": "2026-07-27",
                "end": "2026-08-02",
                "title": "新回顾",
                "entry_ids": [entry["id"]],
                "events": [],
                "replenishing": [],
                "draining": [],
                "recurring": [],
                "open_threads": [],
                "planning_implications": [],
                "candidate_memories": [],
            },
            "conflicting-period-review.json",
            expected_code=2,
        )
        self.assertIn("不同日期范围", result.stderr)
        self.assertEqual(review_path.read_text(encoding="utf-8"), original)

    def test_existing_same_period_unmanaged_review_is_not_overwritten(self) -> None:
        entry = self._add(self._entry(), "unmanaged-collision-entry.json")
        review_path = self.root / "reviews/2026/2026-W31.md"
        review_path.parent.mkdir(parents=True, exist_ok=True)
        original = (
            "# 用户自己的同周期文件\n\n"
            "- 范围：2026-07-27 至 2026-08-02\n\n"
            "即使范围相同也不得被覆盖。\n"
        )
        review_path.write_text(original, encoding="utf-8")
        result = self._review(
            {
                "type": "weekly",
                "start": "2026-07-27",
                "end": "2026-08-02",
                "title": "新回顾",
                "entry_ids": [entry["id"]],
                "events": [],
                "replenishing": [],
                "draining": [],
                "recurring": [],
                "open_threads": [],
                "planning_implications": [],
                "candidate_memories": [],
            },
            "unmanaged-collision-review.json",
            expected_code=2,
        )
        self.assertIn("非本工具管理", result.stderr)
        self.assertEqual(review_path.read_text(encoding="utf-8"), original)

    def test_review_rejects_missing_withdrawn_and_out_of_range_ids(self) -> None:
        active = self._add(self._entry(), "active-entry.json")
        withdrawn = self._add(
            self._entry(date="2026-08-02", time="20:00", title="待撤回", raw="这条会撤回。"),
            "withdrawn-entry.json",
        )
        self._run("withdraw", "--root", str(self.root), "--id", withdrawn["id"])

        base = {
            "type": "weekly",
            "start": "2026-07-27",
            "end": "2026-08-02",
            "title": "无效回顾",
            "events": [],
            "replenishing": [],
            "draining": [],
            "recurring": [],
            "open_threads": [],
            "planning_implications": [],
            "candidate_memories": [],
        }
        cases = [
            (["not-an-entry"], "不存在"),
            ([withdrawn["id"]], "active"),
        ]
        for position, (entry_ids, expected) in enumerate(cases):
            with self.subTest(position=position):
                payload = dict(base, entry_ids=entry_ids)
                result = self._review(payload, f"invalid-review-{position}.json", expected_code=2)
                self.assertIn(expected, result.stderr)

        out_of_range = dict(base, start="2026-08-03", end="2026-08-09", entry_ids=[active["id"]])
        result = self._review(out_of_range, "out-of-range.json", expected_code=2)
        self.assertIn("不在回顾范围", result.stderr)
        self.assertFalse((self.root / "reviews").exists())

    def test_review_redacts_sensitive_content_before_writing(self) -> None:
        entry = self._add(self._entry(), "safe-source.json")
        fake_token = "sk-" + "abcdefghijklmnopqrstuvwxyz123456"
        result = self._review(
            {
                "type": "weekly",
                "start": "2026-07-27",
                "end": "2026-08-02",
                "title": "包含敏感内容的回顾",
                "entry_ids": [entry["id"]],
                "events": ["收到新卡 6222123412341234"],
                "replenishing": [],
                "draining": ["密码是 abcdef 的事让人分心"],
                "recurring": [],
                "open_threads": ["验证码是 123456"],
                "planning_implications": [],
                "candidate_memories": [f"Token {fake_token} 不应被记住"],
            },
            "sensitive-review.json",
        )
        self.assertCountEqual(
            result["redactions"],
            ["api_token", "verification_code", "password", "long_number"],
        )
        content = (self.root / result["file"]).read_text(encoding="utf-8")
        for secret in ("6222123412341234", "abcdef", "123456", fake_token):
            self.assertNotIn(secret, content)
        self.assertIn("[完整号码已省略]", content)
        self.assertIn("待用户确认：Token [访问令牌已省略] 不应被记住", content)


if __name__ == "__main__":
    unittest.main()
