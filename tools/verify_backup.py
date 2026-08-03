#!/usr/bin/env python3
"""Verify and safely extract a portable life-assistant backup.

The verifier uses only the Python standard library.  It validates the archive
checksum sidecar, the per-file manifest, ZIP CRCs, member paths and member
types before an optional extraction into a brand-new directory.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import stat
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Iterator, Mapping, Sequence


ARCHIVE_ROOT = "codex-生活助手"
CHUNK_SIZE = 1024 * 1024
MAX_SIDECAR_BYTES = 16 * 1024 * 1024


class BackupVerificationError(RuntimeError):
    """Raised when a backup is incomplete, unsafe or internally inconsistent."""


@dataclass(frozen=True)
class VerificationResult:
    archive: Path
    checksum_file: Path
    manifest_file: Path
    file_count: int
    total_uncompressed_bytes: int


def _regular_file_stat(path: Path, label: str) -> os.stat_result:
    try:
        result = path.lstat()
    except OSError as exc:
        raise BackupVerificationError(f"{label}缺失或无法读取。") from exc
    if not stat.S_ISREG(result.st_mode):
        raise BackupVerificationError(f"{label}必须是普通文件，不能是链接或目录。")
    return result


def _read_sidecar(path: Path, label: str) -> str:
    metadata = _regular_file_stat(path, label)
    if metadata.st_size > MAX_SIDECAR_BYTES:
        raise BackupVerificationError(f"{label}大小异常。")
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise BackupVerificationError(f"{label}无法以 UTF-8 安全读取。") from exc


def _safe_relative_parts(value: str, label: str) -> tuple[str, ...]:
    if (
        not value
        or value != value.strip()
        or "\x00" in value
        or "\\" in value
        or value.startswith("/")
        or re.match(r"^[A-Za-z]:/", value)
    ):
        raise BackupVerificationError(f"{label}包含不安全路径。")
    parts = tuple(value.split("/"))
    if any(part in {"", ".", ".."} for part in parts):
        raise BackupVerificationError(f"{label}包含不安全路径。")
    return parts


def _parse_archive_checksum(text: str, expected_name: str) -> str:
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) != 1:
        raise BackupVerificationError("ZIP SHA-256 文件格式无效。")
    match = re.fullmatch(r"([0-9a-fA-F]{64})  ([^/\\]+)", lines[0])
    if not match or match.group(2) != expected_name:
        raise BackupVerificationError("ZIP SHA-256 文件与当前 ZIP 不匹配。")
    return match.group(1).lower()


def _parse_manifest(text: str) -> dict[str, str]:
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        raise BackupVerificationError("文件清单为空或格式无效。")
    manifest: dict[str, str] = {}
    for line in lines:
        match = re.fullmatch(r"([0-9a-fA-F]{64})  (.+)", line)
        if not match:
            raise BackupVerificationError("文件清单格式无效。")
        expected_hash, relative = match.group(1).lower(), match.group(2)
        _safe_relative_parts(relative, "文件清单")
        if relative in manifest:
            raise BackupVerificationError("文件清单包含重复路径。")
        manifest[relative] = expected_hash
    return manifest


def _sha256_file_object(handle: BinaryIO) -> str:
    digest = hashlib.sha256()
    for chunk in iter(lambda: handle.read(CHUNK_SIZE), b""):
        digest.update(chunk)
    return digest.hexdigest()


def _archive_identity(metadata: os.stat_result) -> tuple[int, int, int, int]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_size,
        metadata.st_mtime_ns,
    )


def _member_relative_path(info: zipfile.ZipInfo) -> str:
    if info.is_dir():
        raise BackupVerificationError("ZIP 包含未在文件清单中表达的目录成员。")
    parts = _safe_relative_parts(info.filename, "ZIP 成员")
    if len(parts) < 2 or parts[0] != ARCHIVE_ROOT:
        raise BackupVerificationError("ZIP 成员不在预期的项目根目录中。")

    mode = (info.external_attr >> 16) & 0xFFFF
    file_type = stat.S_IFMT(mode)
    if stat.S_ISLNK(mode) or file_type not in {0, stat.S_IFREG}:
        raise BackupVerificationError("ZIP 包含链接或其他非普通文件。")
    if info.flag_bits & 0x1:
        raise BackupVerificationError("ZIP 包含不受支持的加密成员。")
    return "/".join(parts[1:])


def _reject_path_prefix_conflicts(relative_paths: Sequence[str]) -> None:
    part_sets = {_safe_relative_parts(path, "文件清单") for path in relative_paths}
    for parts in part_sets:
        for length in range(1, len(parts)):
            if parts[:length] in part_sets:
                raise BackupVerificationError("文件清单包含文件与子路径冲突。")


def _verified_archive(
    archive_path: Path,
) -> Iterator[
    tuple[
        zipfile.ZipFile,
        Mapping[str, zipfile.ZipInfo],
        Mapping[str, str],
        VerificationResult,
        BinaryIO,
        tuple[int, int, int, int],
    ]
]:
    """Yield a fully verified, still-open archive for optional extraction."""

    archive_path = archive_path.expanduser().absolute()
    if archive_path.suffix != ".zip" or not archive_path.stem:
        raise BackupVerificationError("备份路径必须指向 .zip 文件。")
    initial_path_stat = _regular_file_stat(archive_path, "ZIP 备份")
    checksum_path = archive_path.with_name(f"{archive_path.name}.sha256")
    manifest_path = archive_path.with_name(f"{archive_path.stem}.files.sha256")
    expected_archive_hash = _parse_archive_checksum(
        _read_sidecar(checksum_path, "ZIP SHA-256 文件"),
        archive_path.name,
    )
    manifest = _parse_manifest(_read_sidecar(manifest_path, "文件清单"))
    _reject_path_prefix_conflicts(list(manifest))

    try:
        raw_archive = archive_path.open("rb")
    except OSError as exc:
        raise BackupVerificationError("ZIP 备份无法读取。") from exc

    try:
        opened_stat = os.fstat(raw_archive.fileno())
        identity = _archive_identity(opened_stat)
        if identity != _archive_identity(initial_path_stat):
            raise BackupVerificationError("ZIP 备份在校验开始前已发生变化。")
        actual_archive_hash = _sha256_file_object(raw_archive)
        if actual_archive_hash != expected_archive_hash:
            raise BackupVerificationError("ZIP SHA-256 校验失败。")
        raw_archive.seek(0)

        try:
            archive = zipfile.ZipFile(raw_archive)
        except (OSError, RuntimeError, zipfile.BadZipFile) as exc:
            raise BackupVerificationError("ZIP 结构无效。") from exc
        try:
            infos = archive.infolist()
            by_relative: dict[str, zipfile.ZipInfo] = {}
            seen_archive_names: set[str] = set()
            for info in infos:
                if info.filename in seen_archive_names:
                    raise BackupVerificationError("ZIP 包含重复成员路径。")
                seen_archive_names.add(info.filename)
                relative = _member_relative_path(info)
                if relative in by_relative:
                    raise BackupVerificationError("ZIP 包含重复项目路径。")
                by_relative[relative] = info

            if set(by_relative) != set(manifest):
                raise BackupVerificationError("ZIP 成员与文件清单不完全一致。")

            try:
                bad_member = archive.testzip()
            except (OSError, EOFError, RuntimeError, NotImplementedError, zipfile.BadZipFile) as exc:
                raise BackupVerificationError("ZIP CRC 校验无法完成。") from exc
            if bad_member is not None:
                raise BackupVerificationError("ZIP CRC 校验失败。")

            for relative, expected_hash in manifest.items():
                try:
                    with archive.open(by_relative[relative], "r") as member:
                        actual_hash = _sha256_file_object(member)
                except (OSError, EOFError, RuntimeError, NotImplementedError, zipfile.BadZipFile) as exc:
                    raise BackupVerificationError("ZIP 成员无法安全读取。") from exc
                if actual_hash != expected_hash:
                    raise BackupVerificationError("ZIP 成员内容与文件清单不匹配。")

            if _archive_identity(os.fstat(raw_archive.fileno())) != identity:
                raise BackupVerificationError("ZIP 备份在校验期间发生了变化。")

            result = VerificationResult(
                archive=archive_path,
                checksum_file=checksum_path,
                manifest_file=manifest_path,
                file_count=len(manifest),
                total_uncompressed_bytes=sum(info.file_size for info in infos),
            )
            yield archive, by_relative, manifest, result, raw_archive, identity
        finally:
            archive.close()
    finally:
        raw_archive.close()


def verify_backup(archive_path: Path) -> VerificationResult:
    iterator = _verified_archive(archive_path)
    try:
        _, _, _, result, _, _ = next(iterator)
    except StopIteration as exc:  # pragma: no cover - defensive guard
        raise BackupVerificationError("ZIP 校验未完成。") from exc
    finally:
        iterator.close()
    return result


def _create_private_directories(root: Path, parts: Sequence[str]) -> Path:
    current = root
    for part in parts:
        current = current / part
        try:
            current.mkdir(mode=0o700)
        except FileExistsError:
            try:
                metadata = current.lstat()
            except OSError as exc:
                raise BackupVerificationError("恢复目录无法安全检查。") from exc
            if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
                raise BackupVerificationError("恢复路径与已写入的文件冲突。")
    return current


def _directory_identity(path: Path) -> tuple[int, int] | None:
    try:
        metadata = path.lstat()
    except OSError:
        return None
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        return None
    return metadata.st_dev, metadata.st_ino


def _remove_owned_directory(path: Path, identity: tuple[int, int]) -> None:
    """Remove only the exact directory created by this extraction attempt."""

    if _directory_identity(path) == identity:
        shutil.rmtree(path)


def _extract_verified(
    archive: zipfile.ZipFile,
    by_relative: Mapping[str, zipfile.ZipInfo],
    manifest: Mapping[str, str],
    destination: Path,
) -> tuple[int, int]:
    destination = destination.expanduser().absolute()
    if os.path.lexists(str(destination)):
        raise BackupVerificationError("--extract-to 目标必须是不存在的新目录。")
    if not destination.parent.is_dir():
        raise BackupVerificationError("--extract-to 的父目录必须已存在。")

    created_identity: tuple[int, int] | None = None
    try:
        destination.mkdir(mode=0o700, exist_ok=False)
        created_identity = _directory_identity(destination)
        if created_identity is None:  # pragma: no cover - defensive filesystem guard
            raise BackupVerificationError("新恢复目录无法安全检查。")
        for relative in sorted(manifest):
            relative_parts = _safe_relative_parts(relative, "文件清单")
            project_root = _create_private_directories(destination, (ARCHIVE_ROOT,))
            parent = _create_private_directories(project_root, relative_parts[:-1])
            output_path = parent / relative_parts[-1]
            digest = hashlib.sha256()
            try:
                with archive.open(by_relative[relative], "r") as source, output_path.open(
                    "xb"
                ) as output:
                    for chunk in iter(lambda: source.read(CHUNK_SIZE), b""):
                        output.write(chunk)
                        digest.update(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                output_path.chmod(0o600)
            except (OSError, EOFError, RuntimeError, NotImplementedError, zipfile.BadZipFile) as exc:
                raise BackupVerificationError("安全解压失败，未保留部分恢复目录。") from exc
            if digest.hexdigest() != manifest[relative]:
                raise BackupVerificationError("ZIP 在解压期间发生变化。")
        return created_identity
    except BaseException:
        if created_identity is not None:
            _remove_owned_directory(destination, created_identity)
        raise


def verify_and_extract(archive_path: Path, destination: Path) -> VerificationResult:
    iterator = _verified_archive(archive_path)
    try:
        archive, by_relative, manifest, result, raw_archive, identity = next(iterator)
        destination_identity = _extract_verified(
            archive, by_relative, manifest, destination
        )
        if _archive_identity(os.fstat(raw_archive.fileno())) != identity:
            destination = destination.expanduser().absolute()
            _remove_owned_directory(destination, destination_identity)
            raise BackupVerificationError("ZIP 备份在解压期间发生了变化。")
        return result
    except StopIteration as exc:  # pragma: no cover - defensive guard
        raise BackupVerificationError("ZIP 校验未完成。") from exc
    finally:
        iterator.close()


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="校验并可选安全解压生活助手备份")
    parser.add_argument("--archive", required=True, type=Path, help="待校验的 .zip 备份")
    parser.add_argument(
        "--extract-to",
        type=Path,
        help="可选：完整校验后解压到不存在的新目录",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.extract_to is None:
            result = verify_backup(args.archive)
        else:
            result = verify_and_extract(args.archive, args.extract_to)
    except BackupVerificationError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1

    print(f"PASS: 备份已完整校验（{result.file_count} 个项目文件）。")
    if args.extract_to is not None:
        print(f"- 已安全解压到：{args.extract_to.expanduser().absolute()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
