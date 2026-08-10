#!/usr/bin/env python3
"""日记索引—原文双向完整性检查测试。"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("journal_integrity.py")
SPEC = importlib.util.spec_from_file_location("journal_integrity", MODULE_PATH)
assert SPEC and SPEC.loader
integrity = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(integrity)


IDENTIFIER = "20260801-unknown-0123456789ab"
SENTINEL = "PRIVATE-ORPHAN-SOURCE-CONTENT-72af"


class JournalIntegrityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "journal"
        self.root.mkdir()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write_source(
        self,
        *,
        identifier: str = IDENTIFIER,
        relative: str = "entries/2026/2026-08.md",
    ) -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            f"# 月度日记\n\n<!-- journal-id: {identifier} -->\n\n{SENTINEL}\n",
            encoding="utf-8",
        )
        return path

    def _write_index(
        self,
        *,
        identifier: str = IDENTIFIER,
        relative: str = "entries/2026/2026-08.md",
    ) -> Path:
        path = self.root / "index.jsonl"
        path.write_text(
            json.dumps({"id": identifier, "file": relative}, ensure_ascii=False)
            + "\n",
            encoding="utf-8",
        )
        return path

    def _run_cli(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(MODULE_PATH),
                "--root",
                str(self.root),
                "--json",
            ],
            check=False,
            capture_output=True,
            text=True,
        )

    def test_empty_journal_without_machine_index_is_valid(self) -> None:
        report = integrity.inspect_journal_graph(self.root)
        self.assertTrue(report["valid"])
        self.assertFalse(report["index_present"])
        self.assertEqual(report["indexed_entries"], 0)

    def test_index_and_source_match_bidirectionally(self) -> None:
        self._write_source()
        self._write_index()
        report = integrity.inspect_journal_graph(self.root)
        self.assertEqual(report["indexed_entries"], 1)
        self.assertEqual(report["source_entries"], 1)
        self.assertEqual(report["source_files"], 1)

    def test_orphan_source_fails_without_leaking_content_or_identifier(self) -> None:
        self._write_source()
        result = self._run_cli()
        self.assertEqual(result.returncode, 2)
        self.assertNotIn(SENTINEL, result.stdout + result.stderr)
        self.assertNotIn(IDENTIFIER, result.stdout + result.stderr)

    def test_index_without_source_fails(self) -> None:
        self._write_index()
        with self.assertRaises(integrity.JournalIntegrityError):
            integrity.inspect_journal_graph(self.root)

    def test_wrong_source_path_fails(self) -> None:
        self._write_source(relative="entries/2026/2026-08.md")
        self._write_index(relative="entries/2026/2026-07.md")
        with self.assertRaises(integrity.JournalIntegrityError):
            integrity.inspect_journal_graph(self.root)

    def test_duplicate_marker_across_files_fails(self) -> None:
        self._write_source(relative="entries/2026/2026-08.md")
        self._write_source(relative="entries/2026/2026-09.md")
        self._write_index()
        with self.assertRaises(integrity.JournalIntegrityError):
            integrity.inspect_journal_graph(self.root)

    def test_duplicate_marker_inside_one_file_fails(self) -> None:
        path = self._write_source()
        path.write_text(
            f"<!-- journal-id: {IDENTIFIER} -->\n"
            f"<!-- journal-id: {IDENTIFIER} -->\n",
            encoding="utf-8",
        )
        self._write_index()
        with self.assertRaises(integrity.JournalIntegrityError):
            integrity.inspect_journal_graph(self.root)

    def test_unexpected_entry_path_fails(self) -> None:
        self._write_source(relative="entries/conflicted-copy.md")
        with self.assertRaises(integrity.JournalIntegrityError):
            integrity.inspect_journal_graph(self.root)

    def test_live_scan_ignores_regular_ds_store_metadata(self) -> None:
        self._write_source()
        self._write_index()
        (self.root / "entries/.DS_Store").write_bytes(b"finder metadata")
        (self.root / "entries/2026/.DS_Store").write_bytes(b"finder metadata")

        report = integrity.inspect_journal_graph(self.root)

        self.assertTrue(report["valid"])
        self.assertEqual(report["source_files"], 1)

    def test_live_scan_rejects_ds_store_symlink(self) -> None:
        self._write_source()
        self._write_index()
        target = self.root / "finder-metadata"
        target.write_bytes(b"finder metadata")
        (self.root / "entries/.DS_Store").symlink_to(target)

        with self.assertRaises(integrity.JournalIntegrityError):
            integrity.inspect_journal_graph(self.root)

    def test_backup_snapshot_rejects_ds_store_metadata(self) -> None:
        members = {"journal/entries/.DS_Store": b"finder metadata"}

        with self.assertRaises(integrity.JournalIntegrityError):
            integrity.inspect_journal_snapshot(members)

    def test_malformed_marker_line_fails_but_blockquoted_text_is_not_a_marker(self) -> None:
        path = self._write_source()
        path.write_text(
            "# 月度日记\n\n<!-- journal-id: invalid -->\n"
            "> <!-- journal-id: 用户原话不是元数据 -->\n",
            encoding="utf-8",
        )
        with self.assertRaises(integrity.JournalIntegrityError):
            integrity.inspect_journal_graph(self.root)

    def test_duplicate_index_keys_and_nonstandard_constants_fail_closed(self) -> None:
        self._write_source()
        index = self.root / "index.jsonl"
        invalid_lines = (
            '{"id":"20260801-unknown-0123456789ab",'
            '"id":"20260801-unknown-0123456789ab",'
            '"file":"entries/2026/2026-08.md"}',
            '{"id":"20260801-unknown-0123456789ab",'
            '"file":"entries/2026/2026-08.md","extra":NaN}',
        )
        for line in invalid_lines:
            with self.subTest(line=line):
                index.write_text(line + "\n", encoding="utf-8")
                with self.assertRaises(integrity.JournalIntegrityError):
                    integrity.inspect_journal_graph(self.root)

    def test_exact_backup_snapshot_bytes_are_checked_without_content_leak(self) -> None:
        members = {
            "journal/entries/2026/2026-08.md": (
                f"<!-- journal-id: {IDENTIFIER} -->\n{SENTINEL}\n"
            ).encode("utf-8")
        }
        with self.assertRaises(integrity.JournalIntegrityError) as context:
            integrity.inspect_journal_snapshot(members)
        self.assertNotIn(IDENTIFIER, str(context.exception))
        self.assertNotIn(SENTINEL, str(context.exception))

        members["journal/index.jsonl"] = (
            json.dumps(
                {
                    "id": IDENTIFIER,
                    "file": "entries/2026/2026-08.md",
                }
            )
            + "\n"
        ).encode("utf-8")
        report = integrity.inspect_journal_snapshot(members)
        self.assertTrue(report["valid"])
        self.assertEqual(report["indexed_entries"], 1)


if __name__ == "__main__":
    unittest.main()
