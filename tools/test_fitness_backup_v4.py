import io
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
from life_console_backup_agent import build_archive, LEGACY_RESOURCE_NAMES
from life_console_cloud import CloudWriteError
from backup_store import BackupStore
from verify_life_console_cloud_backup import verify_isolated_restore

class FitnessBackupTest(unittest.TestCase):
    def snapshot(self, version=4):
        return dict(schema_version=version, exported_at="2030-05-01T00:00:00Z", **{name: [] for name in LEGACY_RESOURCE_NAMES}, todo_items=[], todo_status_events=[], dashboard_messages=[])

    def test_v4_install_and_isolated_verification_preserve_appointments(self):
        snapshot = self.snapshot()
        snapshot['fitness_appointments'] = [{'id': 'synthetic', 'revision': 3, 'deleted_at': '2030-05-01T00:00:00Z', 'notes': '合成备注'}]
        snapshot['fitness_calendar_subscription'] = [{'token_hash': 'synthetic-access-material'}]
        data, counts, _ = build_archive(snapshot, 'synthetic-v4')
        with ZipFile(io.BytesIO(data)) as archive:
            manifest = json.loads(archive.read('manifest.json'))
            self.assertEqual(manifest['format_version'], 'life-console-backup/4')
            self.assertEqual(manifest['source_product_version'], 'unknown')
            self.assertEqual(manifest['source_schema_version'], 'supabase/4')
            self.assertNotIn('data/fitness_calendar_subscription.ndjson', archive.namelist())
            self.assertEqual(json.loads(archive.read('data/fitness_appointments.ndjson')), snapshot['fitness_appointments'][0])
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'backup.zip'
            BackupStore(target_path=target, receipt_path=Path(directory) / 'receipt.json').install(io.BytesIO(data), run_id='synthetic-v4')
            self.assertEqual(verify_isolated_restore(target)['counts']['fitness_appointments'], 1)
        self.assertEqual(counts['fitness_appointments'], 1)

    def test_source_metadata_follows_snapshot_schema(self):
        for version in (2, 3, 4):
            with self.subTest(version=version):
                snapshot = self.snapshot(version)
                if version == 4:
                    snapshot['fitness_appointments'] = []
                data, _, _ = build_archive(snapshot, 'synthetic-version')
                with ZipFile(io.BytesIO(data)) as archive:
                    manifest = json.loads(archive.read('manifest.json'))
                    self.assertEqual(manifest['source_schema_version'], f'supabase/{version}')
                    self.assertEqual(manifest['source_product_version'], 'unknown')
                    self.assertEqual(manifest['exporter_product_version'], '2.10.0')

    def test_missing_v4_resource_fails_closed(self):
        with self.assertRaises(CloudWriteError):
            build_archive(self.snapshot(), 'synthetic-v4')

    def test_legacy_snapshot_does_not_claim_fitness_coverage(self):
        data, counts, _ = build_archive(self.snapshot(3), 'synthetic-v3')
        with ZipFile(io.BytesIO(data)) as archive:
            self.assertEqual(json.loads(archive.read('manifest.json'))['format_version'], 'life-console-backup/3')
        self.assertNotIn('fitness_appointments', counts)
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'legacy.zip'
            receipt = BackupStore(target_path=target, receipt_path=Path(directory) / 'receipt.json').install(io.BytesIO(data), run_id='legacy-v3')
            self.assertEqual(receipt.format_version, 'life-console-backup/3')
            self.assertNotIn('fitness_appointments', verify_isolated_restore(target)['counts'])
