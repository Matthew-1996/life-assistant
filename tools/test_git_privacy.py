#!/usr/bin/env python3
"""Tests for the Git privacy boundary checker."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("check_git_privacy.sh")


class GitPrivacyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        subprocess.run(
            ["git", "init", "-b", "agent/test"],
            cwd=self.root,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write(self, relative: str, content: str) -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def _add(self, relative: str, *, force: bool = False) -> None:
        command = ["git", "add"]
        if force:
            command.append("--force")
        command.extend(["--", relative])
        subprocess.run(command, cwd=self.root, check=True)

    def _check(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(SCRIPT)],
            cwd=self.root,
            text=True,
            capture_output=True,
            check=False,
        )

    def _commit(self, message: str) -> None:
        env = {
            "GIT_AUTHOR_NAME": "t",
            "GIT_AUTHOR_EMAIL": "t@example.com",
            "GIT_COMMITTER_NAME": "t",
            "GIT_COMMITTER_EMAIL": "t@example.com",
        }
        subprocess.run(
            ["git", "commit", "-q", "-m", message],
            cwd=self.root,
            check=True,
            env={**os.environ, **env},
        )

    def _check_history(self, rev_range: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(SCRIPT), "--history", rev_range],
            cwd=self.root,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_safe_synthetic_source_passes(self) -> None:
        self._write("tools/example.py", "print('synthetic')\n")
        self._add("tools/example.py")

        result = self._check()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PASS", result.stdout)

    def test_private_path_is_rejected_without_printing_content(self) -> None:
        sentinel = "PRIVATE-CONTENT-MUST-NOT-BE-PRINTED"
        self._write("USER.md", sentinel)
        self._add("USER.md", force=True)

        result = self._check()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("USER.md", result.stderr)
        self.assertNotIn(sentinel, result.stdout + result.stderr)

    def test_nested_life_console_private_path_is_rejected(self) -> None:
        sentinel = "NESTED-PRIVATE-CONTENT-MUST-NOT-BE-PRINTED"
        private_path = "apps/life-console/contracts/fixtures/USER.md"
        self._write(private_path, sentinel)
        self._add(private_path)

        result = self._check()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(private_path, result.stderr)
        self.assertNotIn(sentinel, result.stdout + result.stderr)

    def test_nested_life_console_record_is_rejected(self) -> None:
        private_path = "apps/life-console/tests/fixtures/records/daily-checkins.jsonl"
        self._write(private_path, '{"synthetic": true}\n')
        self._add(private_path)

        result = self._check()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(private_path, result.stderr)

    def test_generated_sites_snapshot_is_rejected(self) -> None:
        private_path = "apps/life-console/public/life-console-snapshot.json"
        self._write(private_path, '{"private": true}\n')
        self._add(private_path)

        result = self._check()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(private_path, result.stderr)

    def test_sites_hosting_binding_is_rejected(self) -> None:
        private_path = "apps/life-console/.openai/hosting.json"
        self._write(private_path, '{"project_id": "private"}\n')
        self._add(private_path)

        result = self._check()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(private_path, result.stderr)

    def test_arbitrary_personal_plan_is_rejected(self) -> None:
        private_path = "plans/2026-08-10-personal-plan.md"
        self._write(private_path, "private plan\n")
        self._add(private_path)

        result = self._check()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(private_path, result.stderr)

    def test_personal_maintenance_path_is_rejected(self) -> None:
        private_path = "需求文档（个人维护）/note.md"
        self._write(private_path, "local compatibility content\n")
        self._add(private_path)

        result = self._check()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(private_path, result.stderr)

    def test_generic_plan_template_is_allowed(self) -> None:
        public_path = "plans/睡眠与状态记录模板.md"
        self._write(public_path, "generic template\n")
        self._add(public_path)

        result = self._check()

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_secret_content_is_rejected_without_echo(self) -> None:
        secret = "ghp_" + ("a" * 24)
        self._write("tools/example.txt", secret)
        self._add("tools/example.txt")

        result = self._check()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("高置信凭据", result.stderr)
        self.assertNotIn(secret, result.stdout + result.stderr)

    def test_machine_specific_absolute_path_is_rejected_without_echo(self) -> None:
        machine_path = "/" + "Users/example-person/private-project/"
        self._write("tools/example.txt", machine_path)
        self._add("tools/example.txt")

        result = self._check()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("机器专属绝对路径", result.stderr)
        self.assertNotIn(machine_path, result.stdout + result.stderr)

    def test_history_scan_rejects_added_then_deleted_private_file(self) -> None:
        # 首个干净提交作为 base。
        self._write("tools/example.py", "print('ok')\n")
        self._add("tools/example.py")
        self._commit("base")
        base = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.root,
            text=True,
            capture_output=True,
            check=True,
        ).stdout.strip()

        # 中间提交引入个人文件，随后删除——索引最终干净，但历史留痕。
        sentinel = "PRIVATE-HISTORY-MUST-NOT-LEAK"
        self._write("USER.md", sentinel)
        self._add("USER.md", force=True)
        self._commit("add private file")
        subprocess.run(["git", "rm", "-q", "USER.md"], cwd=self.root, check=True)
        self._commit("remove private file")

        # 索引扫描此时应通过（最终树干净）。
        self.assertEqual(self._check().returncode, 0)

        # 历史扫描应拒绝，且不回显个人内容。
        result = self._check_history(f"{base}..HEAD")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("USER.md", result.stderr)
        self.assertNotIn(sentinel, result.stdout + result.stderr)

    def test_history_scan_rejects_secret_in_old_commit(self) -> None:
        self._write("tools/example.py", "print('ok')\n")
        self._add("tools/example.py")
        self._commit("base")
        base = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.root,
            text=True,
            capture_output=True,
            check=True,
        ).stdout.strip()

        secret = "ghp_" + ("b" * 24)
        self._write("tools/leak.txt", secret)
        self._add("tools/leak.txt")
        self._commit("leak secret")
        subprocess.run(["git", "rm", "-q", "tools/leak.txt"], cwd=self.root, check=True)
        self._commit("remove secret")

        result = self._check_history(f"{base}..HEAD")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("高置信凭据", result.stderr)
        self.assertNotIn(secret, result.stdout + result.stderr)

    def test_history_scan_passes_for_clean_history(self) -> None:
        self._write("tools/example.py", "print('ok')\n")
        self._add("tools/example.py")
        self._commit("base")
        base = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.root,
            text=True,
            capture_output=True,
            check=True,
        ).stdout.strip()

        self._write("tools/example2.py", "print('still ok')\n")
        self._add("tools/example2.py")
        self._commit("more synthetic code")

        result = self._check_history(f"{base}..HEAD")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PASS", result.stdout)


if __name__ == "__main__":
    unittest.main()
