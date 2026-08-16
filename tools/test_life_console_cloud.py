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
            passphrase="synthetic-password",
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
                passphrase="synthetic-password",
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
            passphrase="synthetic-password",
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

    def test_journal_write_saves_raw_v2_first_and_returns_redacted_receipt(self):
        transport = FakeTransport([[{
            "id": 41,
            "revision": 1,
            "raw_revision": 1,
            "normalization_status": "pending",
        }]])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")

        receipt = client.create_journal({
            "record_key": "journal:synthetic-stable-001",
            "event_date": "2030-01-01",
            "content": "Synthetic body",
            "event_time": None,
            "time_precision": "unknown",
            "source": "agent",
            "privacy": "owner-only",
        })

        self.assertEqual(receipt, {
            "status": "saved",
            "normalization_status": "pending",
            "revision": 1,
        })
        method, path, body, _ = transport.calls[0]
        self.assertEqual((method, path), ("POST", "/rest/v1/rpc/create_journal_v2"))
        self.assertEqual(body["p_idempotency_key"], "journal:synthetic-stable-001")
        self.assertEqual(body["p_content"], "Synthetic body")
        self.assertNotIn("p_title", body)
        self.assertNotIn("Synthetic body", json.dumps(receipt))

    def test_agent_normalization_runs_after_raw_save_with_revision_guard(self):
        normalization = {
            "title": "Synthetic title",
            "summary": "Synthetic summary",
            "facts": [{
                "text": "A synthetic fact",
                "basis": "explicit_text",
                "evidence": "Synthetic body",
            }],
            "feelings": [],
            "people": [],
            "places": [],
            "themes": ["synthetic"],
            "planning_clues": [],
            "inferences": [],
            "tags": ["synthetic"],
        }
        transport = FakeTransport([
            [{"id": 41, "revision": 1, "raw_revision": 1}],
            [{
                "id": "00000000-0000-4000-8000-000000000240",
                "source_revision": 1,
                "status": "processing",
            }],
            [{
                "id": 41,
                "revision": 2,
                "raw_revision": 1,
                "normalization_status": "completed",
            }],
        ])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")

        receipt = client.create_journal({
            "record_key": "journal:synthetic-stable-003",
            "event_date": "2030-01-03",
            "content": "Synthetic body",
            "normalization": normalization,
            "context_revisions": {},
        })

        self.assertEqual(receipt, {
            "status": "saved",
            "normalization_status": "completed",
            "revision": 2,
        })
        self.assertEqual(
            [call[1] for call in transport.calls],
            [
                "/rest/v1/rpc/create_journal_v2",
                "/rest/v1/rpc/begin_journal_normalization",
                "/rest/v1/rpc/complete_journal_normalization",
            ],
        )
        self.assertEqual(transport.calls[1][2]["p_source_revision"], 1)
        self.assertEqual(transport.calls[2][2]["p_expected_source_revision"], 1)
        self.assertEqual(transport.calls[2][2]["p_metadata"], normalization)

    def test_invalid_agent_normalization_keeps_raw_saved_and_never_completes(self):
        transport = FakeTransport([[
            {"id": 41, "revision": 1, "raw_revision": 1},
        ]])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")

        receipt = client.create_journal({
            "record_key": "journal:synthetic-stable-004",
            "event_date": "2030-01-04",
            "content": "Synthetic body",
            "normalization": {
                "title": "Invalid incomplete normalization",
            },
        })

        self.assertEqual(receipt["status"], "saved")
        self.assertEqual(receipt["normalization_status"], "pending")
        self.assertEqual(len(transport.calls), 1)

    def test_agent_can_normalize_an_existing_raw_journal_without_recreating_it(self):
        normalization = {
            "title": "Synthetic title", "summary": "Synthetic summary",
            "facts": [], "feelings": [], "people": [], "places": [],
            "themes": [], "planning_clues": [], "inferences": [], "tags": [],
        }
        transport = FakeTransport([
            [{
                "id": "00000000-0000-4000-8000-000000000240",
                "source_revision": 2,
                "status": "processing",
            }],
            [{"id": 41, "revision": 3, "raw_revision": 2}],
        ])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")

        receipt = client.normalize_journal({
            "journal_id": 41,
            "raw_revision": 2,
            "record_key": "journal:synthetic-existing-001",
            "content": "Synthetic raw body",
            "normalization": normalization,
            "context_revisions": {},
        })

        self.assertEqual(receipt, {
            "status": "saved",
            "normalization_status": "completed",
            "revision": 3,
        })
        self.assertEqual(
            [call[1] for call in transport.calls],
            [
                "/rest/v1/rpc/begin_journal_normalization",
                "/rest/v1/rpc/complete_journal_normalization",
            ],
        )

    def test_completion_failure_is_recorded_without_losing_raw_save(self):
        normalization = {
            "title": "Synthetic title", "summary": "", "facts": [],
            "feelings": [], "people": [], "places": [], "themes": [],
            "planning_clues": [], "inferences": [], "tags": [],
        }
        transport = FakeTransport([
            [{"id": 41, "revision": 1, "raw_revision": 1}],
            [{
                "id": "00000000-0000-4000-8000-000000000240",
                "source_revision": 1,
            }],
            CloudWriteError("unavailable"),
            [{
                "id": "00000000-0000-4000-8000-000000000240",
                "status": "failed",
            }],
        ])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")

        receipt = client.create_journal({
            "record_key": "journal:synthetic-stable-005",
            "event_date": "2030-01-05",
            "content": "Synthetic body",
            "normalization": normalization,
        })

        self.assertEqual(receipt, {
            "status": "saved",
            "normalization_status": "failed",
            "revision": 1,
        })
        self.assertEqual(
            transport.calls[-1][1],
            "/rest/v1/rpc/fail_journal_normalization",
        )

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
        self.assertEqual(len(transport.calls), 1)


if __name__ == "__main__":
    unittest.main()
