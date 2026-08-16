import io
import json
import unittest

from life_console_cloud import (
    CloudClient,
    CloudWriteError,
    authenticate_owner,
    session_token_provider,
)


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
    def test_owner_auth_stores_session_without_returning_credentials(self):
        transport = FakeTransport([{
            "access_token": "synthetic-access",
            "refresh_token": "synthetic-refresh",
            "expires_in": 3600,
        }])
        stored = []

        receipt = authenticate_owner(
            transport,
            email="owner@example.invalid",
            password="synthetic-password",
            store=lambda session: stored.append(session),
        )

        self.assertEqual(receipt, {"status": "authenticated"})
        self.assertEqual(stored[0]["access_token"], "synthetic-access")
        self.assertNotIn("synthetic-access", json.dumps(receipt))

    def test_owner_auth_accepts_access_only_session_for_immediate_backup(self):
        transport = FakeTransport([{"access_token": "synthetic-access"}])
        stored = []
        self.assertEqual(
            authenticate_owner(
                transport,
                email="owner@example.invalid",
                password="synthetic-password",
                store=lambda session: stored.append(session),
            ),
            {"status": "authenticated"},
        )
        self.assertEqual(len(stored), 1)

    def test_owner_auth_accepts_wrapped_session_response(self):
        transport = FakeTransport([{
            "user": {"id": "synthetic-owner"},
            "session": {
                "access_token": "synthetic-access",
                "refresh_token": "synthetic-refresh",
            },
        }])
        stored = []

        receipt = authenticate_owner(
            transport,
            email="owner@example.invalid",
            password="synthetic-password",
            store=lambda session: stored.append(session),
        )

        self.assertEqual(receipt, {"status": "authenticated"})
        self.assertEqual(stored[0]["refresh_token"], "synthetic-refresh")

    def test_session_provider_refreshes_expiring_keychain_session(self):
        transport = FakeTransport([{
            "access_token": "synthetic-access-new",
            "refresh_token": "synthetic-refresh-new",
            "expires_at": 7200,
        }])
        stored = []
        provider = session_token_provider(
            transport,
            load=lambda: {
                "access_token": "synthetic-access-old",
                "refresh_token": "synthetic-refresh-old",
                "expires_at": 1020,
            },
            store=lambda session: stored.append(session),
            now=lambda: 1000,
        )

        self.assertEqual(provider(), "synthetic-access-new")
        self.assertEqual(
            transport.calls[0][0:3],
            (
                "POST",
                "/auth/v1/token?grant_type=refresh_token",
                {"refresh_token": "synthetic-refresh-old"},
            ),
        )
        self.assertEqual(stored[0]["refresh_token"], "synthetic-refresh-new")

    def test_session_provider_reuses_unexpired_access_token(self):
        transport = FakeTransport([])
        provider = session_token_provider(
            transport,
            load=lambda: {
                "access_token": "synthetic-access-current",
                "refresh_token": "synthetic-refresh-current",
                "expires_at": 5000,
            },
            store=lambda session: self.fail("unexpired session must not be rewritten"),
            now=lambda: 1000,
        )

        self.assertEqual(provider(), "synthetic-access-current")
        self.assertEqual(transport.calls, [])

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

    def test_backup_request_uses_owner_scoped_rpc(self):
        transport = FakeTransport([[
            {"id": 9, "status": "pending", "manifest_version": 2},
        ]])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")
        self.assertEqual(client.request_backup()["status"], "pending")
        self.assertEqual(
            transport.calls[0][0:3],
            ("POST", "/rest/v1/rpc/request_life_console_backup", {}),
        )

    def test_cutover_uses_single_rpc_and_returns_only_redacted_result(self):
        transport = FakeTransport([{
            "status": "completed",
            "removed_journals": 20,
            "inserted_journals": 3,
        }])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")
        result = client.cutover_online_primary(
            run_id="00000000-0000-4000-8000-000000000230",
            manifest_digest="a" * 64,
            journals=[{"content": "synthetic-private-body"}],
            daily_checkins=[],
        )

        self.assertEqual(result["status"], "completed")
        self.assertNotIn("synthetic-private-body", json.dumps(result))
        self.assertEqual(
            transport.calls[0][0:2],
            ("POST", "/rest/v1/rpc/cutover_life_console_230"),
        )

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
