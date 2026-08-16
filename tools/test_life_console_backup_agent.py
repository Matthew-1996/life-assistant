import io
import tempfile
from pathlib import Path
import unittest

from life_console_backup_agent import CloudBackupAgent
from life_console_cloud import CloudClient
from verify_life_console_cloud_backup import verify_isolated_restore


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, path, *, body=None, token=None):
        self.calls.append((method, path, body, token))
        return self.responses.pop(0)


def snapshot():
    return {
        "schema_version": 2,
        "exported_at": "2030-01-02T03:04:05Z",
        "goals": [],
        "journals": [{"id": 1, "content": "synthetic"}],
        "journal_revisions": [],
        "daily_checkins": [],
        "weekly_reviews": [],
        "phase_reviews": [],
        "health_days": [],
        "health_segments": [],
    }


class CloudBackupAgentTest(unittest.TestCase):
    def test_pending_request_is_exported_validated_and_marked_success(self):
        transport = FakeTransport([
            [{"id": 9, "status": "pending", "created_at": "2030-01-02T03:04:05Z"}],
            snapshot(),
            [{"id": 9, "status": "success"}],
        ])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            agent = CloudBackupAgent(
                client,
                latest_path=root / "life-console-latest.zip",
                receipt_path=root / "receipts.json",
            )

            result = agent.run_pending()

            self.assertEqual(result["status"], "success")
            self.assertEqual(result["counts"]["journals"], 1)
            self.assertTrue((root / "life-console-latest.zip").is_file())
            self.assertNotIn("synthetic", str(result))
            self.assertEqual(transport.calls[1][0:2], (
                "POST", "/rest/v1/rpc/export_life_console_snapshot",
            ))
            self.assertEqual(
                verify_isolated_restore(root / "life-console-latest.zip")["counts"]["journals"],
                1,
            )

    def test_no_pending_request_is_a_noop(self):
        transport = FakeTransport([[]])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            agent = CloudBackupAgent(
                client,
                latest_path=root / "latest.zip",
                receipt_path=root / "receipts.json",
            )
            self.assertEqual(agent.run_pending(), {"status": "idle"})


if __name__ == "__main__":
    unittest.main()
