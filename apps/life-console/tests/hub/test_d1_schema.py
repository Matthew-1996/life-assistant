from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[2]
MIGRATION_PATH = APP_ROOT / "d1" / "migrations" / "0001_init.sql"
EXPECTED_TABLES = {
    "audit_events",
    "backup_exports",
    "daily_checkins",
    "goals",
    "health_days",
    "health_segments",
    "idempotency_keys",
    "journal_revisions",
    "journals",
    "migration_state",
    "phase_reviews",
    "weekly_reviews",
}


class D1SchemaTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.executescript(MIGRATION_PATH.read_text(encoding="utf-8"))

    def tearDown(self) -> None:
        self.connection.close()

    def table_columns(self, table: str) -> set[str]:
        rows = self.connection.execute(f"PRAGMA table_info({table})").fetchall()
        return {str(row[1]) for row in rows}

    def test_migration_creates_exactly_the_twelve_approved_tables(self) -> None:
        rows = self.connection.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            """
        ).fetchall()

        self.assertEqual({str(row[0]) for row in rows}, EXPECTED_TABLES)

    def test_sensitive_resources_require_encrypted_payload_columns(self) -> None:
        self.assertTrue(
            {"content_encrypted", "encryption_kid", "content_digest"}
            <= self.table_columns("journals")
        )
        self.assertTrue(
            {"raw_payload_encrypted", "source_device_encrypted", "encryption_kid"}
            <= self.table_columns("health_days")
        )
        self.assertTrue(
            {"value_1_encrypted", "value_2_encrypted", "source_encrypted"}
            <= self.table_columns("health_segments")
        )

    def test_audit_events_cannot_store_content_or_ciphertext(self) -> None:
        forbidden = {
            "body",
            "content",
            "content_encrypted",
            "payload",
            "request_body",
            "response_body",
        }

        self.assertTrue(forbidden.isdisjoint(self.table_columns("audit_events")))

    def test_initial_truth_source_is_icloud_before_switch(self) -> None:
        row = self.connection.execute(
            """
            SELECT singleton_id, phase, source_truth
            FROM migration_state
            """
        ).fetchone()

        self.assertEqual(row, (1, "NOT_STARTED", "ICLOUD_PRIMARY"))

    def test_health_segments_require_an_existing_health_day(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """
                INSERT INTO health_segments (
                  id, revision, created_at, updated_at, encryption_version,
                  health_day_id, segment_type, started_at, duration_min,
                  encryption_kid
                ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "segment-synthetic",
                    "2026-01-01T00:00:00Z",
                    "2026-01-01T00:00:00Z",
                    "health-v1",
                    "missing-day",
                    "sleep_core",
                    "2026-01-01T00:00:00Z",
                    30,
                    "health-v1",
                ),
            )

    def test_backup_queue_deduplicates_each_resource_revision(self) -> None:
        values = (
            "backup-synthetic-1",
            "2026-01-01T00:00:00Z",
            "journal",
            "journal-synthetic",
            1,
            "PENDING",
        )
        self.connection.execute(
            """
            INSERT INTO backup_exports (
              id, created_at, resource_type, resource_id, revision, status
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            values,
        )

        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """
                INSERT INTO backup_exports (
                  id, created_at, resource_type, resource_id, revision, status
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    "backup-synthetic-2",
                    *values[1:],
                ),
            )


if __name__ == "__main__":
    unittest.main()
