import io
import json
import unittest

from life_console_cloud import CloudClient, CloudWriteError


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, path, *, body=None, token=None):
        self.calls.append((method, path, body, token))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class LifeConsoleCloudTest(unittest.TestCase):
    def test_journal_write_uses_stable_key_and_returns_redacted_receipt(self):
        transport = FakeTransport([[{"id": 41, "revision": 1}]])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")

        receipt = client.create_journal({
            "record_key": "journal:synthetic-stable-001",
            "event_date": "2030-01-01",
            "title": "Synthetic",
            "content": "Synthetic body",
            "tags": ["synthetic"],
        })

        self.assertEqual(receipt, {
            "status": "saved",
            "resource": "journal",
            "revision": 1,
        })
        method, path, body, _ = transport.calls[0]
        self.assertEqual((method, path), ("POST", "/rest/v1/rpc/create_journal"))
        self.assertEqual(body["p_idempotency_key"], "journal:synthetic-stable-001")
        self.assertNotIn("Synthetic body", json.dumps(receipt))

    def test_daily_checkin_preserves_sleep_fields_in_online_record(self):
        transport = FakeTransport([
            [{"id": 7, "revision": 1}],
            [{"id": 7, "revision": 2}],
        ])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")

        receipt = client.upsert_daily_checkin({
            "record_key": "daily:2030-01-01",
            "checkin_date": "2030-01-01",
            "sleep_quality": 4,
            "sleep_time": "00:30",
            "wake_time": "08:20",
            "out_of_bed_time": "08:40",
            "awake_in_bed": "yes",
        })

        self.assertEqual(receipt["status"], "saved")
        self.assertEqual(transport.calls[1][0:2], (
            "PATCH", "/rest/v1/daily_checkins?id=eq.7&revision=eq.1",
        ))
        self.assertEqual(transport.calls[1][2]["awake_in_bed"], "yes")

    def test_network_failure_is_reported_unsaved_without_local_fallback(self):
        transport = FakeTransport([OSError("synthetic unavailable")])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")

        with self.assertRaisesRegex(CloudWriteError, "^unavailable$"):
            client.create_journal({
                "record_key": "journal:synthetic-stable-002",
                "event_date": "2030-01-02",
                "content": "Synthetic unsaved body",
            })


if __name__ == "__main__":
    unittest.main()
