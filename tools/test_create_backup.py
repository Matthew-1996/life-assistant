#!/usr/bin/env python3
"""Tests for privacy checks and fail-closed snapshots in create_backup.py."""

from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("create_backup.py")
SPEC = importlib.util.spec_from_file_location("create_backup", MODULE_PATH)
assert SPEC and SPEC.loader
create_backup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(create_backup)


class CreateBackupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self._write("AGENTS.md", "portable\n")
        self._write("web/life-dashboard/.openai/hosting.json", '{"project_id":"not-a-secret"}\n')
        self._write(".env.example", "EXAMPLE_VALUE=replace-me\n")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write(self, relative: str, content: str | bytes) -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content, encoding="utf-8")
        return path

    def _run(self, *args: str) -> tuple[int, str, str]:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            result = create_backup.main(
                list(args), root=self.root, run_validation=False
            )
        return result, stdout.getvalue(), stderr.getvalue()

    @staticmethod
    def _canonical_json(value: object) -> str:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )

    def _valid_insight_ledger(self) -> str:
        """Return a complete, legal synthetic v2 candidate history."""

        record = {
            "candidate_id": "insight-" + ("a" * 64),
            "kind": "candidate_memory",
            "review_file": "reviews/2026/2026-08.md",
            "review_sha256": "b" * 64,
            "summary": "合成候选认识",
            "status": "pending",
            "decided_at": None,
            "proposal_target": None,
            "proposal_text": None,
            "proposal_sha256": None,
            "proposed_at": None,
            "applied_at": None,
            "recorded_at": "2026-08-14T04:00:00+00:00",
            "revision": 1,
        }
        return self._canonical_json(record) + "\n"

    def _valid_phase_action_ledger(self) -> str:
        """Return a complete, legal synthetic phase-action record."""

        identity = {
            "review_date": "2026-08-14",
            "source_record_etag": "c" * 64,
            "category": "journal_cadence",
            "desired_value": "monthly",
        }
        action_id = "phase-action-" + hashlib.sha256(
            self._canonical_json(identity).encode("utf-8")
        ).hexdigest()
        record = {
            "schema_version": 1,
            "action_id": action_id,
            **identity,
            "approval_requirement": "exact_change",
            "state": "pending",
            "failure_code": None,
            "revision": 1,
            "created_at": "2026-08-14T04:00:00Z",
            "updated_at": "2026-08-14T04:00:00Z",
        }
        record["etag"] = hashlib.sha256(
            self._canonical_json(record).encode("utf-8")
        ).hexdigest()
        return self._canonical_json(record) + "\n"

    def test_success_always_warns_personal_data_and_unencrypted_zip(self) -> None:
        result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 0, stderr)
        self.assertIn("个人生活助手项目数据", stdout)
        self.assertIn("ZIP 未设置独立密码", stdout)
        self.assertNotIn("检测到实际日记", stdout)
        self.assertNotIn("检测到实际每周复盘记录", stdout)
        self.assertNotIn("检测到实际阶段复盘记录", stdout)
        self.assertNotIn("日记候选认识确认台账", stdout)
        self.assertNotIn("检测到阶段动作台账", stdout)

        archive = self.root / "backups/生活助手-完整备份-2026-08-01.zip"
        self.assertTrue(archive.is_file())
        with zipfile.ZipFile(archive) as handle:
            names = set(handle.namelist())
        self.assertIn("codex-生活助手/web/life-dashboard/.openai/hosting.json", names)
        self.assertIn("codex-生活助手/.env.example", names)

    def test_nonempty_journal_adds_specific_warning(self) -> None:
        identifier = "20260801-unknown-0123456789ab"
        self._write(
            "journal/entries/2026/2026-08.md",
            f"<!-- journal-id: {identifier} -->\n真实日记\n",
        )
        self._write(
            "journal/index.jsonl",
            '{"id":"20260801-unknown-0123456789ab",'
            '"file":"entries/2026/2026-08.md"}\n',
        )

        result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 0, stderr)
        self.assertIn("个人生活助手项目数据", stdout)
        self.assertIn("检测到实际日记或回顾", stdout)
        self.assertIn("journal/PRIVACY.md", stdout)

    def test_orphan_journal_source_is_refused_from_exact_snapshot_without_leak(self) -> None:
        identifier = "20260801-unknown-fedcba987654"
        sentinel = "PRIVATE-ORPHAN-BACKUP-SENTINEL-9d3e"
        self._write(
            "journal/entries/2026/2026-08.md",
            f"<!-- journal-id: {identifier} -->\n{sentinel}\n",
        )

        result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 4)
        self.assertIn("日记索引与原文不完整", stderr)
        self.assertNotIn(identifier, stdout + stderr)
        self.assertNotIn(sentinel, stdout + stderr)
        self.assertFalse(any((self.root / "backups").glob("*.zip")))

    def test_empty_journal_index_does_not_claim_real_journal(self) -> None:
        self._write("journal/index.jsonl", "")

        result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 0, stderr)
        self.assertNotIn("检测到实际日记", stdout)

    def test_nonempty_daily_checkin_adds_specific_warning(self) -> None:
        self._write(
            "records/daily-checkins.jsonl",
            '{"schema_version":1,"key":"daily-checkin:2026-08-02"}\n',
        )

        result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 0, stderr)
        self.assertIn("个人生活助手项目数据", stdout)
        self.assertIn("检测到实际每日状态记录", stdout)
        self.assertIn("睡眠、精力、情绪", stdout)
        self.assertIn("records/README.md", stdout)

    def test_nonempty_weekly_review_adds_specific_warning_and_is_archived(self) -> None:
        self._write(
            "records/weekly-reviews.jsonl",
            '{"schema_version":1,"key":"weekly-review:2026-W32"}\n',
        )

        result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 0, stderr)
        self.assertIn("检测到实际每周复盘记录", stdout)
        self.assertIn("反复摩擦", stdout)
        self.assertIn("目标决定", stdout)
        self.assertIn("records/README.md", stdout)
        archive = self.root / "backups/生活助手-完整备份-2026-08-01.zip"
        with zipfile.ZipFile(archive) as handle:
            self.assertIn(
                "codex-生活助手/records/weekly-reviews.jsonl",
                set(handle.namelist()),
            )

    def test_empty_weekly_review_file_is_optional_and_has_no_specific_warning(self) -> None:
        self._write("records/weekly-reviews.jsonl", "")

        result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 0, stderr)
        self.assertNotIn("检测到实际每周复盘记录", stdout)

    def test_nonempty_phase_review_adds_specific_warning_and_is_archived(self) -> None:
        record = {
            "schema_version": 1,
            "key": "phase-review:2026-08-14",
            "review_date": "2026-08-14",
            "answers": {
                "recovery_change": "稍微稳定",
                "main_friction": None,
                "life_experience_signal": None,
                "goal_intent": "continue",
                "journal_cadence": "undecided",
                "checkin_experience": "neutral",
                "checkin_cadence": "undecided",
                "next_track": "undecided",
                "career_timing": "undecided",
                "fitness_conversation": None,
            },
            "revision": 1,
            "created_at": "2026-08-14T04:00:00Z",
            "updated_at": "2026-08-14T04:00:00Z",
        }
        self._write(
            "records/phase-reviews.jsonl",
            json.dumps(record, ensure_ascii=False) + "\n",
        )

        result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 0, stderr)
        self.assertIn("检测到实际阶段复盘记录", stdout)
        self.assertIn("整理/回访节奏", stdout)
        self.assertIn("records/README.md", stdout)
        archive = self.root / "backups/生活助手-完整备份-2026-08-01.zip"
        with zipfile.ZipFile(archive) as handle:
            self.assertIn(
                "codex-生活助手/records/phase-reviews.jsonl",
                set(handle.namelist()),
            )

    def test_invalid_phase_review_snapshot_is_refused_without_content_leak(self) -> None:
        sentinel = "PRIVATE-PHASE-REVIEW-MUST-NEVER-LEAK"
        self._write(
            "records/phase-reviews.jsonl",
            json.dumps({"raw_transcript": sentinel}, ensure_ascii=False) + "\n",
        )

        result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 4)
        self.assertIn("阶段复盘台账结构无效", stderr)
        self.assertNotIn(sentinel, stdout + stderr)
        self.assertFalse(any((self.root / "backups").glob("*.zip")))

    def test_nonempty_insight_ledger_adds_specific_warning_and_is_archived(self) -> None:
        self._write(
            "journal/insight-decisions.jsonl",
            self._valid_insight_ledger(),
        )

        result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 0, stderr)
        self.assertIn("日记候选认识确认台账", stdout)
        self.assertIn("精确长期文件提案", stdout)
        self.assertIn("不因“接受”自动改写长期记忆或目标", stdout)
        self.assertIn("journal/PRIVACY.md", stdout)
        archive = self.root / "backups/生活助手-完整备份-2026-08-01.zip"
        with zipfile.ZipFile(archive) as handle:
            self.assertIn(
                "codex-生活助手/journal/insight-decisions.jsonl",
                set(handle.namelist()),
            )

    def test_invalid_insight_snapshot_is_refused_without_content_leak(self) -> None:
        sentinel = "PRIVATE-INSIGHT-PROPOSAL-MUST-NEVER-LEAK"
        self._write(
            "journal/insight-decisions.jsonl",
            json.dumps({"proposal_text": sentinel}, ensure_ascii=False) + "\n",
        )

        result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 4)
        self.assertIn("候选认识确认台账结构无效", stderr)
        self.assertNotIn(sentinel, stdout + stderr)
        self.assertFalse(any((self.root / "backups").iterdir()))

    def test_nonempty_phase_action_adds_specific_warning_and_is_archived(self) -> None:
        self._write(
            "records/phase-actions.jsonl",
            self._valid_phase_action_ledger(),
        )

        result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 0, stderr)
        self.assertIn("检测到阶段动作台账", stdout)
        self.assertIn("期望值", stdout)
        self.assertIn("执行状态", stdout)
        archive = self.root / "backups/生活助手-完整备份-2026-08-01.zip"
        with zipfile.ZipFile(archive) as handle:
            self.assertIn(
                "codex-生活助手/records/phase-actions.jsonl",
                set(handle.namelist()),
            )

    def test_invalid_phase_action_snapshot_is_refused_without_content_leak(self) -> None:
        sentinel = "PRIVATE-PHASE-ACTION-MUST-NEVER-LEAK"
        self._write(
            "records/phase-actions.jsonl",
            json.dumps({"desired_value": sentinel}, ensure_ascii=False) + "\n",
        )

        result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 4)
        self.assertIn("阶段动作台账结构无效", stderr)
        self.assertNotIn(sentinel, stdout + stderr)
        self.assertFalse(any((self.root / "backups").iterdir()))

    def test_ephemeral_lock_files_are_not_archived(self) -> None:
        self._write("journal/.journal.lock", "")
        self._write("records/.daily-checkins.lock", "")
        self._write("records/.phase-actions.lock", "")
        self._write("records/.phase-reviews.lock", "")
        self._write("records/.weekly-reviews.lock", "")
        self._write(".pytest_cache/v/cache/nodeids", "[]\n")
        self._write(".coverage", "generated\n")

        result, _, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 0, stderr)
        archive = self.root / "backups/生活助手-完整备份-2026-08-01.zip"
        with zipfile.ZipFile(archive) as handle:
            names = set(handle.namelist())
        self.assertNotIn("codex-生活助手/journal/.journal.lock", names)
        self.assertNotIn("codex-生活助手/records/.daily-checkins.lock", names)
        self.assertNotIn("codex-生活助手/records/.phase-actions.lock", names)
        self.assertNotIn("codex-生活助手/records/.phase-reviews.lock", names)
        self.assertNotIn("codex-生活助手/records/.weekly-reviews.lock", names)
        self.assertNotIn("codex-生活助手/.pytest_cache/v/cache/nodeids", names)
        self.assertNotIn("codex-生活助手/.coverage", names)

    def test_secret_filename_refuses_without_creating_archive(self) -> None:
        fake_value = "do-" + "not-copy"
        fake_document = '{"to' + 'ken":"' + fake_value + '"}\n'
        self._write("config/credentials.json", fake_document)

        result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 3)
        self.assertIn("秘密预检", stderr)
        self.assertIn("config/credentials.json", stderr)
        self.assertNotIn("do-not-copy", stdout + stderr)
        self.assertFalse(any((self.root / "backups").glob("*.zip")))

    def test_private_key_content_refuses_even_under_benign_name(self) -> None:
        private_key_header = "-----BEGIN OPENSSH " + "PRIVATE" + " KEY-----"
        self._write(
            "notes/setup.txt",
            "prefix\n" + private_key_header + "\nsecret\n",
        )

        result, _, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 3)
        self.assertIn("notes/setup.txt", stderr)
        self.assertNotIn("OPENSSH PRIVATE KEY", stderr)

    def test_dsa_and_pgp_private_key_headers_are_refused(self) -> None:
        fixtures = {
            "notes/legacy.pem": "-----BEGIN DSA " + "PRIVATE" + " KEY-----\nsecret\n",
            "notes/export.asc": (
                "-----BEGIN PGP " + "PRIVATE" + " KEY BLOCK-----\nsecret\n"
            ),
        }
        for relative, content in fixtures.items():
            with self.subTest(relative=relative):
                with tempfile.TemporaryDirectory() as temp_dir:
                    original_root = self.root
                    self.root = Path(temp_dir)
                    try:
                        self._write("AGENTS.md", "portable\n")
                        self._write(relative, content)
                        result, stdout, stderr = self._run("--date", "2026-08-01")
                        self.assertEqual(result, 3)
                        self.assertIn(relative, stderr)
                        self.assertNotIn(content.splitlines()[0], stdout + stderr)
                    finally:
                        self.root = original_root

    def test_public_certificate_pem_is_not_false_positive(self) -> None:
        self._write(
            "docs/public-certificate.pem",
            "-----BEGIN CERTIFICATE-----\npublic material\n-----END CERTIFICATE-----\n",
        )

        result, _, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 0, stderr)

    def test_high_confidence_token_content_is_refused_in_allowed_template(self) -> None:
        fake_key = "sk-" + ("A" * 24)
        self._write(".env.example", "EXAMPLE_VALUE=" + fake_key + "\n")

        result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 3)
        self.assertIn(".env.example", stderr)
        self.assertNotIn(fake_key, stdout + stderr)

    def test_source_content_change_during_archive_is_rejected_before_publish(self) -> None:
        source = self._write("notes/changing.txt", "before\n")
        original_writestr = zipfile.ZipFile.writestr
        changed = False

        def writestr_then_change(archive, member, data, *args, **kwargs):
            nonlocal changed
            result = original_writestr(archive, member, data, *args, **kwargs)
            member_name = member.filename if isinstance(member, zipfile.ZipInfo) else member
            if member_name.endswith("/notes/changing.txt") and not changed:
                source.write_text("after\n", encoding="utf-8")
                changed = True
            return result

        with mock.patch.object(zipfile.ZipFile, "writestr", new=writestr_then_change):
            result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 4)
        self.assertIn("发生变化", stderr)
        self.assertNotIn("before", stdout + stderr)
        self.assertNotIn("after", stdout + stderr)
        self.assertEqual(list((self.root / "backups").iterdir()), [])

    def test_source_member_addition_during_archive_is_rejected(self) -> None:
        self._write("notes/trigger.txt", "stable\n")
        original_writestr = zipfile.ZipFile.writestr
        added = False

        def writestr_then_add(archive, member, data, *args, **kwargs):
            nonlocal added
            result = original_writestr(archive, member, data, *args, **kwargs)
            member_name = member.filename if isinstance(member, zipfile.ZipInfo) else member
            if member_name.endswith("/notes/trigger.txt") and not added:
                self._write("notes/added.txt", "new member\n")
                added = True
            return result

        with mock.patch.object(zipfile.ZipFile, "writestr", new=writestr_then_add):
            result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 4)
        self.assertIn("发生变化", stderr)
        self.assertNotIn("new member", stdout + stderr)
        self.assertEqual(list((self.root / "backups").iterdir()), [])

    def test_source_member_deletion_during_archive_is_rejected(self) -> None:
        source = self._write("notes/deleted.txt", "remove me\n")
        original_writestr = zipfile.ZipFile.writestr
        deleted = False

        def writestr_then_delete(archive, member, data, *args, **kwargs):
            nonlocal deleted
            result = original_writestr(archive, member, data, *args, **kwargs)
            member_name = member.filename if isinstance(member, zipfile.ZipInfo) else member
            if member_name.endswith("/notes/deleted.txt") and not deleted:
                source.unlink()
                deleted = True
            return result

        with mock.patch.object(zipfile.ZipFile, "writestr", new=writestr_then_delete):
            result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 4)
        self.assertIn("发生变化", stderr)
        self.assertNotIn("remove me", stdout + stderr)
        self.assertEqual(list((self.root / "backups").iterdir()), [])

    def test_same_bytes_path_replacement_during_archive_is_rejected(self) -> None:
        source = self._write("notes/replaced.txt", "same bytes\n")
        original_writestr = zipfile.ZipFile.writestr
        replaced = False

        def writestr_then_replace(archive, member, data, *args, **kwargs):
            nonlocal replaced
            result = original_writestr(archive, member, data, *args, **kwargs)
            member_name = member.filename if isinstance(member, zipfile.ZipInfo) else member
            if member_name.endswith("/notes/replaced.txt") and not replaced:
                replacement = source.with_name(".replacement.tmp")
                replacement.write_bytes(source.read_bytes())
                replacement.replace(source)
                replaced = True
            return result

        with mock.patch.object(zipfile.ZipFile, "writestr", new=writestr_then_replace):
            result, _, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 4)
        self.assertIn("发生变化", stderr)
        self.assertEqual(list((self.root / "backups").iterdir()), [])

    def test_drift_with_force_does_not_overwrite_existing_final_trio(self) -> None:
        source = self._write("notes/changing.txt", "before\n")
        backup_dir = self.root / "backups"
        backup_dir.mkdir()
        existing = {
            "生活助手-完整备份-2026-08-01.zip": b"old archive\n",
            "生活助手-完整备份-2026-08-01.zip.sha256": b"old archive hash\n",
            "生活助手-完整备份-2026-08-01.files.sha256": b"old manifest\n",
        }
        for name, content in existing.items():
            (backup_dir / name).write_bytes(content)
        original_writestr = zipfile.ZipFile.writestr
        changed = False

        def writestr_then_change(archive, member, data, *args, **kwargs):
            nonlocal changed
            result = original_writestr(archive, member, data, *args, **kwargs)
            member_name = member.filename if isinstance(member, zipfile.ZipInfo) else member
            if member_name.endswith("/notes/changing.txt") and not changed:
                source.write_text("after\n", encoding="utf-8")
                changed = True
            return result

        with mock.patch.object(zipfile.ZipFile, "writestr", new=writestr_then_change):
            result, _, stderr = self._run("--date", "2026-08-01", "--force")

        self.assertEqual(result, 4)
        self.assertIn("发生变化", stderr)
        for name, content in existing.items():
            self.assertEqual((backup_dir / name).read_bytes(), content)
        self.assertEqual({path.name for path in backup_dir.iterdir()}, set(existing))

    def test_secret_appearing_during_archive_is_rejected_before_publish(self) -> None:
        source = self._write("notes/changing.txt", "safe before archive\n")
        original_writestr = zipfile.ZipFile.writestr
        injected = False
        private_header = "-----BEGIN DSA " + "PRIVATE" + " KEY-----"

        def change_then_writestr(archive, member, data, *args, **kwargs):
            nonlocal injected
            member_name = member.filename if isinstance(member, zipfile.ZipInfo) else member
            if member_name.endswith("/notes/changing.txt") and not injected:
                source.write_text(private_header + "\nsecret\n", encoding="utf-8")
                injected = True
            return original_writestr(archive, member, data, *args, **kwargs)

        with mock.patch.object(zipfile.ZipFile, "writestr", new=change_then_writestr):
            result, stdout, stderr = self._run("--date", "2026-08-01")

        self.assertEqual(result, 4)
        self.assertIn("发生变化", stderr)
        self.assertNotIn(private_header, stdout + stderr)
        self.assertFalse(any((self.root / "backups").glob("*.zip")))


if __name__ == "__main__":
    unittest.main()
