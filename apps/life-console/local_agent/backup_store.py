"""Validate and atomically install one Life Console backup archive.

This module deliberately has no HTTP client, Sites credential, or default iCloud
path. A caller must supply explicit local paths and an already-open binary
stream. Errors expose fixed codes only so payloads and machine paths do not leak
into UI or logs.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
from typing import BinaryIO, Mapping
from zipfile import BadZipFile, ZipFile


BACKUP_FORMAT_VERSION = "life-console-backup/2"
RECEIPT_FORMAT_VERSION = "life-console-local-receipts/1"
EXPECTED_RESOURCES = (
    "goals",
    "journals",
    "journal_revisions",
    "daily_checkins",
    "weekly_reviews",
    "phase_reviews",
    "health_days",
    "health_segments",
)
RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
HEX_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class BackupAgentError(Exception):
    """A fail-closed error containing only a stable public code."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class BackupStoreLimits:
    max_archive_bytes: int = 64 * 1024 * 1024
    max_files: int = 32
    max_single_file_bytes: int = 32 * 1024 * 1024
    max_total_uncompressed_bytes: int = 128 * 1024 * 1024
    max_compression_ratio: float = 100.0


@dataclass(frozen=True)
class BackupReceipt:
    run_id: str
    archive_sha256: str
    format_version: str
    completed_at: str
    counts: dict[str, int]
    idempotent: bool = False

    def to_public_dict(self) -> dict[str, object]:
        return {
            "run_id": self.run_id,
            "archive_sha256": self.archive_sha256,
            "format_version": self.format_version,
            "completed_at": self.completed_at,
            "counts": dict(self.counts),
            "idempotent": self.idempotent,
        }


def content_digest_for_resources(resources: Mapping[str, Mapping[str, object]]) -> str:
    """Return the deterministic digest covered by manifest resource metadata."""

    canonical = {
        name: {
            "count": value["count"],
            "path": value["path"],
            "sha256": value["sha256"],
        }
        for name, value in sorted(resources.items())
    }
    payload = json.dumps(
        canonical,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


class BackupStore:
    """Install a validated archive while preserving the previous valid backup."""

    def __init__(
        self,
        *,
        target_path: Path,
        receipt_path: Path,
        previous_path: Path | None = None,
        limits: BackupStoreLimits | None = None,
    ) -> None:
        self.target_path = Path(target_path)
        self.previous_path = Path(previous_path) if previous_path else self._default_previous_path()
        self.receipt_path = Path(receipt_path)
        self.limits = limits or BackupStoreLimits()
        self.lock_path = self.receipt_path.with_suffix(self.receipt_path.suffix + ".lock")

    def _default_previous_path(self) -> Path:
        if "latest" in self.target_path.name:
            return self.target_path.with_name(
                self.target_path.name.replace("latest", "previous", 1)
            )
        return self.target_path.with_name(self.target_path.name + ".previous")

    def install(
        self,
        stream: BinaryIO,
        *,
        run_id: str,
        expected_archive_sha256: str | None = None,
    ) -> BackupReceipt:
        self._validate_run_id(run_id)
        if expected_archive_sha256 is not None and not HEX_SHA256_PATTERN.fullmatch(
            expected_archive_sha256
        ):
            raise BackupAgentError("archive_digest_rejected")

        try:
            self.target_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.receipt_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            lock_fd = os.open(self.lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        except OSError as error:
            raise BackupAgentError("storage_unavailable") from error
        try:
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise BackupAgentError("agent_busy") from error
            return self._install_locked(
                stream,
                run_id=run_id,
                expected_archive_sha256=expected_archive_sha256,
            )
        finally:
            os.close(lock_fd)

    def pending_receipts(self) -> list[BackupReceipt]:
        return [self._receipt_from_dict(item) for item in self._read_receipt_items()]

    def remove_receipt(self, run_id: str) -> bool:
        self._validate_run_id(run_id)
        items = self._read_receipt_items()
        remaining = [item for item in items if item.get("run_id") != run_id]
        if len(remaining) == len(items):
            return False
        self._write_receipt_items(remaining)
        return True

    def _install_locked(
        self,
        stream: BinaryIO,
        *,
        run_id: str,
        expected_archive_sha256: str | None,
    ) -> BackupReceipt:
        temporary_path: Path | None = None
        try:
            temporary_path, archive_sha256 = self._write_temporary(stream)
            if expected_archive_sha256 and archive_sha256 != expected_archive_sha256:
                raise BackupAgentError("archive_digest_mismatch")

            existing = self._receipt_by_run_id(run_id)
            if existing:
                if existing.archive_sha256 != archive_sha256:
                    raise BackupAgentError("run_id_conflict")
                return BackupReceipt(**{
                    **existing.__dict__,
                    "idempotent": True,
                })

            counts = self._validate_archive(temporary_path)
            reread_digest = self._sha256_file(temporary_path)
            if reread_digest != archive_sha256:
                raise BackupAgentError("archive_readback_mismatch")
            self._validate_archive(temporary_path)

            if self.target_path.exists():
                self._validate_archive(self.target_path)
                previous_fd, previous_name = tempfile.mkstemp(
                    dir=self.previous_path.parent,
                    prefix=".life-console-previous-",
                    suffix=".tmp",
                )
                previous_temp = Path(previous_name)
                try:
                    with os.fdopen(previous_fd, "wb", closefd=True) as destination:
                        with self.target_path.open("rb") as source:
                            shutil.copyfileobj(source, destination, 64 * 1024)
                        destination.flush()
                        os.fsync(destination.fileno())
                    self._validate_archive(previous_temp)
                    os.replace(previous_temp, self.previous_path)
                    os.chmod(self.previous_path, 0o600)
                finally:
                    previous_temp.unlink(missing_ok=True)

            os.replace(temporary_path, self.target_path)
            temporary_path = None
            os.chmod(self.target_path, 0o600)
            self._fsync_directory(self.target_path.parent)

            receipt = BackupReceipt(
                run_id=run_id,
                archive_sha256=archive_sha256,
                format_version=BACKUP_FORMAT_VERSION,
                completed_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                counts=counts,
            )
            items = self._read_receipt_items()
            items.append(receipt.to_public_dict())
            self._write_receipt_items(items)
            return receipt
        except BackupAgentError:
            raise
        except OSError as error:
            code = "storage_unavailable" if error.errno in {
                errno.ENOSPC,
                errno.EDQUOT,
                errno.EACCES,
                errno.EROFS,
            } else "archive_write_failed"
            raise BackupAgentError(code) from error
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    def _write_temporary(self, stream: BinaryIO) -> tuple[Path, str]:
        fd, name = tempfile.mkstemp(
            dir=self.target_path.parent,
            prefix=".life-console-backup-",
            suffix=".tmp",
        )
        path = Path(name)
        digest = hashlib.sha256()
        total = 0
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "wb", closefd=True) as destination:
                while True:
                    chunk = stream.read(64 * 1024)
                    if not chunk:
                        break
                    if not isinstance(chunk, bytes):
                        raise BackupAgentError("archive_stream_rejected")
                    total += len(chunk)
                    if total > self.limits.max_archive_bytes:
                        raise BackupAgentError("archive_size_rejected")
                    destination.write(chunk)
                    digest.update(chunk)
                destination.flush()
                os.fsync(destination.fileno())
            if total == 0:
                raise BackupAgentError("archive_empty")
            return path, digest.hexdigest()
        except Exception:
            try:
                os.close(fd)
            except OSError:
                pass
            path.unlink(missing_ok=True)
            raise

    def _validate_archive(self, path: Path) -> dict[str, int]:
        try:
            with ZipFile(path) as archive:
                infos = archive.infolist()
                if len(infos) > self.limits.max_files:
                    raise BackupAgentError("archive_file_count_rejected")
                names: set[str] = set()
                total_uncompressed = 0
                for info in infos:
                    self._validate_member(info.filename, info.external_attr)
                    if info.filename in names:
                        raise BackupAgentError("archive_duplicate_path")
                    names.add(info.filename)
                    if info.file_size > self.limits.max_single_file_bytes:
                        raise BackupAgentError("archive_file_size_rejected")
                    total_uncompressed += info.file_size
                    if total_uncompressed > self.limits.max_total_uncompressed_bytes:
                        raise BackupAgentError("archive_total_size_rejected")
                    if info.file_size and (
                        info.compress_size == 0
                        or info.file_size / info.compress_size
                        > self.limits.max_compression_ratio
                    ):
                        raise BackupAgentError("archive_compression_ratio_rejected")

                if "manifest.json" not in names:
                    raise BackupAgentError("manifest_missing")
                manifest = json.loads(archive.read("manifest.json"))
                resources = self._validate_manifest(manifest)
                declared_paths = {"manifest.json"}
                counts: dict[str, int] = {}
                for resource_name in EXPECTED_RESOURCES:
                    metadata = resources[resource_name]
                    resource_path = metadata["path"]
                    declared_paths.add(resource_path)
                    if resource_path not in names:
                        raise BackupAgentError("resource_missing")
                    payload = archive.read(resource_path)
                    if hashlib.sha256(payload).hexdigest() != metadata["sha256"]:
                        raise BackupAgentError("resource_digest_mismatch")
                    count = self._validate_ndjson(payload)
                    if count != metadata["count"]:
                        raise BackupAgentError("resource_count_mismatch")
                    counts[resource_name] = count
                if names != declared_paths:
                    raise BackupAgentError("archive_layout_rejected")
                if manifest["archive_content_sha256"] != content_digest_for_resources(
                    resources
                ):
                    raise BackupAgentError("content_digest_mismatch")
                return counts
        except BackupAgentError:
            raise
        except (BadZipFile, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise BackupAgentError("archive_invalid") from error

    @staticmethod
    def _validate_member(name: str, external_attr: int) -> None:
        if not name or "\\" in name or "\x00" in name or ":" in name:
            raise BackupAgentError("archive_path_rejected")
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or "." in path.parts:
            raise BackupAgentError("archive_path_rejected")
        mode = external_attr >> 16
        if mode and stat.S_ISLNK(mode):
            raise BackupAgentError("archive_symlink_rejected")

    @staticmethod
    def _validate_manifest(manifest: object) -> dict[str, dict[str, object]]:
        if not isinstance(manifest, dict):
            raise BackupAgentError("manifest_invalid")
        required_strings = (
            "source_product_version",
            "source_schema_version",
            "export_id",
            "exported_at",
        )
        if manifest.get("format_version") != BACKUP_FORMAT_VERSION:
            raise BackupAgentError("format_version_rejected")
        if any(not isinstance(manifest.get(field), str) or not manifest[field] for field in required_strings):
            raise BackupAgentError("manifest_invalid")
        digest = manifest.get("archive_content_sha256")
        if not isinstance(digest, str) or not HEX_SHA256_PATTERN.fullmatch(digest):
            raise BackupAgentError("manifest_invalid")
        resources = manifest.get("resources")
        if not isinstance(resources, dict) or set(resources) != set(EXPECTED_RESOURCES):
            raise BackupAgentError("resource_set_rejected")
        validated: dict[str, dict[str, object]] = {}
        for name, metadata in resources.items():
            if not isinstance(metadata, dict):
                raise BackupAgentError("resource_metadata_invalid")
            path = metadata.get("path")
            count = metadata.get("count")
            sha256 = metadata.get("sha256")
            if (
                not isinstance(path, str)
                or path != f"data/{name}.ndjson"
                or not isinstance(count, int)
                or isinstance(count, bool)
                or count < 0
                or not isinstance(sha256, str)
                or not HEX_SHA256_PATTERN.fullmatch(sha256)
            ):
                raise BackupAgentError("resource_metadata_invalid")
            validated[name] = {"path": path, "count": count, "sha256": sha256}
        return validated

    @staticmethod
    def _validate_ndjson(payload: bytes) -> int:
        try:
            text = payload.decode("utf-8")
        except UnicodeDecodeError as error:
            raise BackupAgentError("resource_encoding_invalid") from error
        if text and not text.endswith("\n"):
            raise BackupAgentError("resource_ndjson_invalid")
        count = 0
        for line in text.splitlines():
            if not line:
                raise BackupAgentError("resource_ndjson_invalid")
            value = json.loads(line)
            if not isinstance(value, dict):
                raise BackupAgentError("resource_ndjson_invalid")
            count += 1
        return count

    def _receipt_by_run_id(self, run_id: str) -> BackupReceipt | None:
        for item in self._read_receipt_items():
            if item.get("run_id") == run_id:
                return self._receipt_from_dict(item)
        return None

    def _read_receipt_items(self) -> list[dict[str, object]]:
        if not self.receipt_path.exists():
            return []
        try:
            value = json.loads(self.receipt_path.read_text(encoding="utf-8"))
            if value.get("format_version") != RECEIPT_FORMAT_VERSION:
                raise ValueError
            items = value.get("pending")
            if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
                raise ValueError
            return items
        except (OSError, AttributeError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise BackupAgentError("receipt_store_invalid") from error

    def _write_receipt_items(self, items: list[dict[str, object]]) -> None:
        payload = json.dumps(
            {"format_version": RECEIPT_FORMAT_VERSION, "pending": items},
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8") + b"\n"
        fd, name = tempfile.mkstemp(
            dir=self.receipt_path.parent,
            prefix=".life-console-receipts-",
            suffix=".tmp",
        )
        temporary = Path(name)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "wb", closefd=True) as destination:
                destination.write(payload)
                destination.flush()
                os.fsync(destination.fileno())
            os.replace(temporary, self.receipt_path)
            os.chmod(self.receipt_path, 0o600)
            self._fsync_directory(self.receipt_path.parent)
        except OSError as error:
            temporary.unlink(missing_ok=True)
            raise BackupAgentError("receipt_store_unavailable") from error

    @staticmethod
    def _receipt_from_dict(value: Mapping[str, object]) -> BackupReceipt:
        try:
            run_id = value["run_id"]
            archive_sha256 = value["archive_sha256"]
            format_version = value["format_version"]
            completed_at = value["completed_at"]
            counts = value["counts"]
            if (
                not isinstance(run_id, str)
                or not RUN_ID_PATTERN.fullmatch(run_id)
                or not isinstance(archive_sha256, str)
                or not HEX_SHA256_PATTERN.fullmatch(archive_sha256)
                or format_version != BACKUP_FORMAT_VERSION
                or not isinstance(completed_at, str)
                or not isinstance(counts, dict)
                or set(counts) != set(EXPECTED_RESOURCES)
                or any(not isinstance(item, int) or isinstance(item, bool) or item < 0 for item in counts.values())
            ):
                raise ValueError
            return BackupReceipt(
                run_id=run_id,
                archive_sha256=archive_sha256,
                format_version=format_version,
                completed_at=completed_at,
                counts=dict(counts),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise BackupAgentError("receipt_store_invalid") from error

    @staticmethod
    def _validate_run_id(run_id: str) -> None:
        if not isinstance(run_id, str) or not RUN_ID_PATTERN.fullmatch(run_id):
            raise BackupAgentError("run_id_rejected")

    @staticmethod
    def _sha256_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            while chunk := source.read(64 * 1024):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _fsync_directory(path: Path) -> None:
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        directory_fd = os.open(path, flags)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
