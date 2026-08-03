#!/usr/bin/env python3
"""Tests for the dependency-free backup verifier and safe extractor."""

from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import os
import stat
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("verify_backup.py")
SPEC = importlib.util.spec_from_file_location("verify_backup", MODULE_PATH)
assert SPEC and SPEC.loader
verify_backup = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = verify_backup
SPEC.loader.exec_module(verify_backup)


class VerifyBackupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _bundle(
        self,
        files: dict[str, bytes] | None = None,
        *,
        archive_members: list[tuple[zipfile.ZipInfo | str, bytes]] | None = None,
        manifest_files: dict[str, bytes] | None = None,
    ) -> Path:
        files = files or {"AGENTS.md": b"portable\n", "records/README.md": b"records\n"}
        manifest_files = files if manifest_files is None else manifest_files
        archive_path = self.root / "life-r1.zip"
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as archive:
            if archive_members is None:
                archive_members = [
                    (f"{verify_backup.ARCHIVE_ROOT}/{relative}", content)
                    for relative, content in files.items()
                ]
            for member, content in archive_members:
                archive.writestr(member, content)
        manifest = "".join(
            f"{hashlib.sha256(content).hexdigest()}  {relative}\n"
            for relative, content in manifest_files.items()
        )
        archive_path.with_name(f"{archive_path.stem}.files.sha256").write_text(
            manifest, encoding="utf-8"
        )
        archive_path.with_name(f"{archive_path.name}.sha256").write_text(
            f"{hashlib.sha256(archive_path.read_bytes()).hexdigest()}  {archive_path.name}\n",
            encoding="utf-8",
        )
        return archive_path

    def _refresh_archive_checksum(self, archive_path: Path) -> None:
        archive_path.with_name(f"{archive_path.name}.sha256").write_text(
            f"{hashlib.sha256(archive_path.read_bytes()).hexdigest()}  {archive_path.name}\n",
            encoding="utf-8",
        )

    def _run(self, *args: str) -> tuple[int, str, str]:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            result = verify_backup.main(list(args))
        return result, stdout.getvalue(), stderr.getvalue()

    def test_valid_bundle_is_verified_without_writing(self) -> None:
        archive = self._bundle()

        result, stdout, stderr = self._run("--archive", str(archive))

        self.assertEqual(result, 0, stderr)
        self.assertIn("2 个项目文件", stdout)
        self.assertEqual(
            {path.name for path in self.root.iterdir()},
            {"life-r1.zip", "life-r1.zip.sha256", "life-r1.files.sha256"},
        )

    def test_valid_bundle_extracts_only_after_verification(self) -> None:
        archive = self._bundle({"AGENTS.md": b"portable\n", "nested/a.txt": b"alpha"})
        destination = self.root / "restore-test"

        result, _, stderr = self._run(
            "--archive", str(archive), "--extract-to", str(destination)
        )

        self.assertEqual(result, 0, stderr)
        project = destination / verify_backup.ARCHIVE_ROOT
        self.assertEqual((project / "AGENTS.md").read_bytes(), b"portable\n")
        self.assertEqual((project / "nested/a.txt").read_bytes(), b"alpha")

    def test_existing_extract_target_is_never_overwritten(self) -> None:
        archive = self._bundle()
        destination = self.root / "existing"
        destination.mkdir()
        sentinel = destination / "keep.txt"
        sentinel.write_text("keep\n", encoding="utf-8")

        result, _, stderr = self._run(
            "--archive", str(archive), "--extract-to", str(destination)
        )

        self.assertEqual(result, 1)
        self.assertIn("不存在的新目录", stderr)
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep\n")

    def test_bad_archive_checksum_fails_before_creating_destination(self) -> None:
        archive = self._bundle()
        archive.with_name(f"{archive.name}.sha256").write_text(
            f"{'0' * 64}  {archive.name}\n", encoding="utf-8"
        )
        destination = self.root / "not-created"

        result, _, stderr = self._run(
            "--archive", str(archive), "--extract-to", str(destination)
        )

        self.assertEqual(result, 1)
        self.assertIn("ZIP SHA-256 校验失败", stderr)
        self.assertFalse(os.path.lexists(destination))

    def test_crc_corruption_is_rejected_even_with_refreshed_outer_checksum(self) -> None:
        marker = b"unique-crc-marker-72e3"
        archive = self._bundle({"AGENTS.md": marker})
        payload = bytearray(archive.read_bytes())
        position = bytes(payload).find(marker)
        self.assertGreaterEqual(position, 0)
        self.assertEqual(bytes(payload).count(marker), 1)
        payload[position] ^= 0x01
        archive.write_bytes(payload)
        self._refresh_archive_checksum(archive)

        result, _, stderr = self._run("--archive", str(archive))

        self.assertEqual(result, 1)
        self.assertIn("CRC", stderr)

    def test_member_content_hash_must_match_manifest(self) -> None:
        archive = self._bundle(
            {"AGENTS.md": b"archive-value"},
            manifest_files={"AGENTS.md": b"different-value"},
        )

        result, _, stderr = self._run("--archive", str(archive))

        self.assertEqual(result, 1)
        self.assertIn("内容与文件清单不匹配", stderr)

    def test_manifest_and_archive_member_sets_must_be_exact(self) -> None:
        archive = self._bundle(
            {"AGENTS.md": b"one", "extra.txt": b"two"},
            manifest_files={"AGENTS.md": b"one"},
        )

        result, _, stderr = self._run("--archive", str(archive))

        self.assertEqual(result, 1)
        self.assertIn("不完全一致", stderr)

    def test_unsafe_member_path_is_rejected_without_extraction(self) -> None:
        unsafe = f"{verify_backup.ARCHIVE_ROOT}/../escape.txt"
        archive = self._bundle(
            {"safe.txt": b"safe"},
            archive_members=[(unsafe, b"escape")],
            manifest_files={"safe.txt": b"safe"},
        )
        destination = self.root / "not-created"

        result, _, stderr = self._run(
            "--archive", str(archive), "--extract-to", str(destination)
        )

        self.assertEqual(result, 1)
        self.assertIn("不安全路径", stderr)
        self.assertFalse(destination.exists())
        self.assertFalse((self.root / "escape.txt").exists())

    def test_unsafe_manifest_path_is_rejected(self) -> None:
        archive = self._bundle(
            {"safe.txt": b"safe"},
            manifest_files={"../escape.txt": b"safe"},
        )

        result, _, stderr = self._run("--archive", str(archive))

        self.assertEqual(result, 1)
        self.assertIn("不安全路径", stderr)

    def test_symlink_member_is_rejected(self) -> None:
        link = zipfile.ZipInfo(f"{verify_backup.ARCHIVE_ROOT}/link")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive = self._bundle(
            {"link": b"target"},
            archive_members=[(link, b"target")],
        )

        result, _, stderr = self._run("--archive", str(archive))

        self.assertEqual(result, 1)
        self.assertIn("链接", stderr)

    def test_duplicate_member_is_rejected(self) -> None:
        name = f"{verify_backup.ARCHIVE_ROOT}/AGENTS.md"
        with self.assertWarns(UserWarning):
            archive = self._bundle(
                {"AGENTS.md": b"same"},
                archive_members=[(name, b"same"), (name, b"same")],
            )

        result, _, stderr = self._run("--archive", str(archive))

        self.assertEqual(result, 1)
        self.assertIn("重复成员", stderr)

    def test_file_and_child_path_conflict_is_rejected_before_extraction(self) -> None:
        archive = self._bundle({"a": b"file", "a/b.txt": b"child"})
        destination = self.root / "not-created"

        result, _, stderr = self._run(
            "--archive", str(archive), "--extract-to", str(destination)
        )

        self.assertEqual(result, 1)
        self.assertIn("子路径冲突", stderr)
        self.assertFalse(destination.exists())

    def test_sidecars_must_be_regular_files(self) -> None:
        archive = self._bundle()
        checksum = archive.with_name(f"{archive.name}.sha256")
        checksum.unlink()
        checksum.mkdir()

        result, _, stderr = self._run("--archive", str(archive))

        self.assertEqual(result, 1)
        self.assertIn("必须是普通文件", stderr)


if __name__ == "__main__":
    unittest.main()
