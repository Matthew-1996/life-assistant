from __future__ import annotations

from io import BytesIO
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
import warnings
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from local_agent.backup_store import (
    BACKUP_FORMAT_VERSION,
    EXPECTED_RESOURCES,
    BackupAgentError,
    BackupStore,
    BackupStoreLimits,
    content_digest_for_resources,
)


def archive_bytes(
    *,
    record_text: str = "synthetic",
    empty_resources: bool = False,
    mutate_manifest=None,
    extra_writer=None,
) -> bytes:
    payloads = {
        name: b"" if empty_resources else (
            json.dumps({"id": f"{name}_synthetic", "value": record_text}, sort_keys=True)
            + "\n"
        ).encode("utf-8")
        for name in EXPECTED_RESOURCES
    }
    resources = {
        name: {
            "path": f"data/{name}.ndjson",
            "count": 0 if empty_resources else 1,
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
        for name, payload in payloads.items()
    }
    manifest = {
        "format_version": BACKUP_FORMAT_VERSION,
        "source_product_version": "2.1.0",
        "source_schema_version": "synthetic-v1",
        "export_id": "export_synthetic",
        "exported_at": "2026-01-12T00:00:00Z",
        "resources": resources,
        "archive_content_sha256": content_digest_for_resources(resources),
    }
    if mutate_manifest:
        mutate_manifest(manifest)
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, sort_keys=True))
        for name, payload in payloads.items():
            archive.writestr(f"data/{name}.ndjson", payload)
        if extra_writer:
            extra_writer(archive)
    return output.getvalue()


class InterruptedStream:
    def __init__(self, payload: bytes):
        self.payload = payload
        self.reads = 0

    def read(self, _size: int) -> bytes:
        self.reads += 1
        if self.reads == 1:
            return self.payload[: len(self.payload) // 2]
        raise OSError("synthetic interruption")


class BackupStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.target = self.root / "backups" / "life-console-latest.zip"
        self.previous = self.root / "backups" / "life-console-previous.zip"
        self.receipts = self.root / "state" / "pending-receipts.json"
        self.store = BackupStore(target_path=self.target, receipt_path=self.receipts)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_first_install_is_private_validated_and_records_redacted_receipt(self) -> None:
        payload = archive_bytes()
        digest = hashlib.sha256(payload).hexdigest()

        receipt = self.store.install(
            BytesIO(payload),
            run_id="run_synthetic_1",
            expected_archive_sha256=digest,
        )

        self.assertEqual(self.target.read_bytes(), payload)
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.receipts.stat().st_mode & 0o777, 0o600)
        self.assertEqual(receipt.counts, {name: 1 for name in EXPECTED_RESOURCES})
        persisted = self.receipts.read_text(encoding="utf-8")
        self.assertNotIn("synthetic interruption", persisted)
        self.assertNotIn(str(self.root), persisted)

    def test_successful_install_replaces_the_previous_archive_and_is_idempotent(self) -> None:
        previous = archive_bytes(record_text="previous")
        current = archive_bytes(record_text="current")
        self.store.install(BytesIO(previous), run_id="run_previous")

        receipt = self.store.install(BytesIO(current), run_id="run_current")
        repeated = self.store.install(BytesIO(current), run_id="run_current")

        self.assertEqual(self.target.read_bytes(), current)
        self.assertEqual(self.previous.read_bytes(), previous)
        self.assertFalse(receipt.idempotent)
        self.assertTrue(repeated.idempotent)
        self.assertEqual(len(self.store.pending_receipts()), 2)

    def test_interrupted_write_and_digest_mismatch_preserve_previous_archive(self) -> None:
        previous = archive_bytes(record_text="previous")
        self.store.install(BytesIO(previous), run_id="run_previous")
        candidate = archive_bytes(record_text="candidate")

        with self.assertRaisesRegex(BackupAgentError, "archive_write_failed"):
            self.store.install(InterruptedStream(candidate), run_id="run_interrupted")
        self.assertEqual(self.target.read_bytes(), previous)

        with self.assertRaisesRegex(BackupAgentError, "archive_digest_mismatch"):
            self.store.install(
                BytesIO(candidate),
                run_id="run_digest",
                expected_archive_sha256="0" * 64,
            )
        self.assertEqual(self.target.read_bytes(), previous)
        self.assertEqual(list(self.target.parent.glob(".life-console-backup-*.tmp")), [])

    def test_truncated_and_malformed_archives_preserve_previous_archive(self) -> None:
        previous = archive_bytes(record_text="previous")
        self.store.install(BytesIO(previous), run_id="run_previous")

        invalid_payloads = [
            archive_bytes(record_text="truncated")[:-20],
            archive_bytes(
                mutate_manifest=lambda manifest: manifest["resources"]["journals"].update(
                    {"count": 2}
                )
            ),
            archive_bytes(
                mutate_manifest=lambda manifest: manifest["resources"]["journals"].update(
                    {"sha256": "0" * 64}
                )
            ),
        ]
        for index, payload in enumerate(invalid_payloads):
            with self.subTest(index=index), self.assertRaises(BackupAgentError):
                self.store.install(
                    BytesIO(payload),
                    run_id=f"run_malformed_{index}",
                )
            self.assertEqual(self.target.read_bytes(), previous)

    def test_accepts_empty_resource_files_with_zero_counts(self) -> None:
        payload = archive_bytes(empty_resources=True)

        receipt = self.store.install(BytesIO(payload), run_id="run_empty")

        self.assertEqual(receipt.counts, {name: 0 for name in EXPECTED_RESOURCES})
        self.assertEqual(self.target.read_bytes(), payload)

    def test_rejects_path_traversal_duplicate_and_symlink_members(self) -> None:
        invalid_writers = [
            lambda archive: archive.writestr("../escape", b"no"),
            lambda archive: archive.writestr("data/goals.ndjson", b"duplicate"),
        ]
        for index, writer in enumerate(invalid_writers):
            with self.subTest(index=index), warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with self.assertRaises(BackupAgentError):
                    self.store.install(
                        BytesIO(archive_bytes(extra_writer=writer)),
                        run_id=f"run_invalid_{index}",
                    )

        def symlink_writer(archive: ZipFile) -> None:
            info = ZipInfo("data/link.ndjson")
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, "data/goals.ndjson")

        with self.assertRaisesRegex(BackupAgentError, "archive_symlink_rejected"):
            self.store.install(
                BytesIO(archive_bytes(extra_writer=symlink_writer)),
                run_id="run_symlink",
            )
        self.assertFalse(self.target.exists())

    def test_rejects_zip_bomb_limits_and_conflicting_run_id(self) -> None:
        tight_store = BackupStore(
            target_path=self.target,
            receipt_path=self.receipts,
            limits=BackupStoreLimits(max_compression_ratio=2.0),
        )
        with self.assertRaisesRegex(BackupAgentError, "archive_compression_ratio_rejected"):
            tight_store.install(
                BytesIO(archive_bytes(record_text="x" * 20000)),
                run_id="run_ratio",
            )

        original = archive_bytes(record_text="original")
        changed = archive_bytes(record_text="changed")
        self.store.install(BytesIO(original), run_id="run_conflict")
        with self.assertRaisesRegex(BackupAgentError, "run_id_conflict"):
            self.store.install(BytesIO(changed), run_id="run_conflict")
        self.assertEqual(self.target.read_bytes(), original)

    def test_concurrent_lock_fails_closed_and_receipt_can_be_acknowledged(self) -> None:
        self.store.receipt_path.parent.mkdir(parents=True)
        lock_fd = os.open(self.store.lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            with self.assertRaisesRegex(BackupAgentError, "agent_busy"):
                self.store.install(BytesIO(archive_bytes()), run_id="run_busy")
        finally:
            os.close(lock_fd)

        self.store.install(BytesIO(archive_bytes()), run_id="run_receipt")
        self.assertTrue(self.store.remove_receipt("run_receipt"))
        self.assertFalse(self.store.remove_receipt("run_receipt"))
        self.assertEqual(self.store.pending_receipts(), [])

    def test_storage_and_input_failures_expose_fixed_codes_only(self) -> None:
        blocked_parent = self.root / "blocked"
        blocked_parent.write_text("synthetic", encoding="utf-8")
        unavailable = BackupStore(
            target_path=blocked_parent / "latest.zip",
            receipt_path=self.receipts,
        )
        with self.assertRaisesRegex(BackupAgentError, "^storage_unavailable$"):
            unavailable.install(BytesIO(archive_bytes()), run_id="run_storage")
        with self.assertRaisesRegex(BackupAgentError, "^run_id_rejected$"):
            self.store.install(BytesIO(archive_bytes()), run_id="../private/path")


if __name__ == "__main__":
    unittest.main()
