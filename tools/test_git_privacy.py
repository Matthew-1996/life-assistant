#!/usr/bin/env python3
"""Tests for the Git privacy boundary checker."""

from __future__ import annotations

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

    def test_secret_content_is_rejected_without_echo(self) -> None:
        secret = "ghp_" + ("a" * 24)
        self._write("tools/example.txt", secret)
        self._add("tools/example.txt")

        result = self._check()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("高置信凭据", result.stderr)
        self.assertNotIn(secret, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
