import io
import json
import traceback
import unittest
from pathlib import Path
from urllib.error import HTTPError
from unittest import mock

from apple_health_history import HealthHistoryError
from life_console_cloud import (
    CloudClient,
    CloudWriteError,
    HttpTransport,
    authenticate_owner,
    main,
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
                "id": 41,
                "record_key": "journal:synthetic-existing-001",
                "content": "Synthetic raw body",
                "raw_revision": 2,
                "revision": 2,
                "normalization_status": "pending",
            }],
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
                transport.calls[0][1],
                "/rest/v1/rpc/begin_journal_normalization",
                "/rest/v1/rpc/complete_journal_normalization",
            ],
        )
        self.assertTrue(transport.calls[0][1].startswith("/rest/v1/journals?"))

    def test_existing_normalization_rejects_content_that_does_not_match_source(self):
        transport = FakeTransport([[{
            "id": 41,
            "record_key": "journal:synthetic-existing-002",
            "content": "Authoritative synthetic raw",
            "raw_revision": 2,
            "revision": 2,
            "normalization_status": "pending",
        }]])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")
        with self.assertRaisesRegex(CloudWriteError, "conflict"):
            client.normalize_journal({
                "journal_id": 41,
                "raw_revision": 2,
                "record_key": "journal:synthetic-existing-002",
                "content": "Different synthetic raw",
                "normalization": {
                    "title": "Synthetic title", "summary": "", "facts": [],
                    "feelings": [], "people": [], "places": [], "themes": [],
                    "planning_clues": [], "inferences": [], "tags": [],
                },
                "context_revisions": {},
            })
        self.assertEqual(len(transport.calls), 1)

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

    def test_health_day_write_uses_owner_rpc_and_returns_redacted_receipt(self):
        transport = FakeTransport([[{
            "action": "created",
            "id": 17,
            "health_date": "2026-08-26",
            "revision": 1,
        }]])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")
        parsed = {
            "health_date": "2026-08-26",
            "generated_at": "2026-08-26T13:30:00+08:00",
            "summary": {
                "steps": 4321,
                "active_energy": 210.5,
                "exercise_minutes": 18,
                "sleep_start": None,
                "sleep_end": None,
            },
        }

        receipt = client.upsert_health_day(parsed)

        self.assertEqual(
            transport.calls,
            [("POST", "/rest/v1/rpc/upsert_health_day_v1", {
                "p_health_date": "2026-08-26",
                "p_generated_at": "2026-08-26T13:30:00+08:00",
                "p_summary": parsed["summary"],
            }, "synthetic-token")],
        )
        self.assertEqual(receipt, {
            "status": "saved",
            "resource": "health_day",
            "action": "created",
            "date": "2026-08-26",
            "revision": 1,
        })
        self.assertNotIn("4321", json.dumps(receipt))
        self.assertNotIn("synthetic-token", json.dumps(receipt))

    def test_health_day_write_rejects_unrecognized_action_and_malformed_response(self):
        parsed = {
            "health_date": "2026-08-26",
            "generated_at": "2026-08-26T13:30:00+08:00",
            "summary": {},
        }
        for response in (
            [{"action": "deleted", "health_date": "2026-08-26", "revision": 1}],
            [{"action": "created", "health_date": 1, "revision": 1}],
            [{"action": "created", "health_date": "2026-08-26", "revision": "1"}],
            {"action": "created"},
        ):
            with self.subTest(response=response):
                client = CloudClient(
                    FakeTransport([response]), token_provider=lambda: "synthetic-token"
                )
                with self.assertRaisesRegex(CloudWriteError, "^unavailable$"):
                    client.upsert_health_day(parsed)

    def test_http_transport_maps_only_known_health_rpc_error_messages(self):
        cases = {
            "health_day_stale_source": "stale_source",
            "health_day_invalid_source": "invalid_source",
            "health_day_conflict": "conflict",
            "health_day_unauthenticated": "unauthenticated",
            "unknown_error": "unavailable",
        }
        transport = HttpTransport("https://project.invalid", "synthetic-publishable-key")
        for message, expected in cases.items():
            with self.subTest(message=message):
                response = io.BytesIO(json.dumps({"message": message}).encode("utf-8"))
                exc = HTTPError("https://project.invalid", 400, "Bad Request", None, response)
                with mock.patch("life_console_cloud.request.urlopen", side_effect=exc):
                    with self.assertRaisesRegex(CloudWriteError, f"^{expected}$") as raised:
                        transport.request("POST", "/rest/v1/rpc/upsert_health_day_v1", body={})
                self.assertNotIn(message, str(raised.exception))

    def test_http_transport_discards_error_body_from_exception_chain_and_traceback(self):
        markers = (
            "marker-private-body",
            "marker-metric",
            "marker-token",
            "marker-project",
        )
        response = io.BytesIO(json.dumps({
            "message": "health_day_invalid_source",
            "detail": " ".join(markers),
        }).encode("utf-8"))
        exc = HTTPError("https://project.invalid", 400, "Bad Request", None, response)
        transport = HttpTransport("https://project.invalid", "synthetic-publishable-key")

        with mock.patch("life_console_cloud.request.urlopen", side_effect=exc):
            with self.assertRaisesRegex(CloudWriteError, "^invalid_source$") as raised:
                transport.request("POST", "/rest/v1/rpc/upsert_health_day_v1", body={})

        current = raised.exception
        chain = []
        while current is not None:
            chain.append(current)
            current = current.__cause__ or current.__context__
        self.assertEqual(chain, [raised.exception])
        rendered = "".join(traceback.format_exception(
            type(raised.exception), raised.exception, raised.exception.__traceback__
        ))
        for marker in markers:
            self.assertNotIn(marker, rendered)
            self.assertNotIn(marker, "\n".join(repr(item) for item in chain))

    def test_http_transport_fails_closed_for_malformed_health_error_bodies(self):
        class ReadFailure:
            def read(self):
                raise OSError("closed")

            def close(self):
                return None

        class CloseFailure:
            def read(self):
                return b"\xff"

            def close(self):
                raise RuntimeError("closed")

        bodies = (
            io.BytesIO(json.dumps({"message": []}).encode("utf-8")),
            io.BytesIO(json.dumps({"message": {}}).encode("utf-8")),
            io.BytesIO(b"\xff"),
            ReadFailure(),
            CloseFailure(),
        )
        transport = HttpTransport("https://project.invalid", "synthetic-publishable-key")
        for body in bodies:
            with self.subTest(body_type=type(body).__name__):
                exc = HTTPError("https://project.invalid", 400, "Bad Request", None, body)
                with mock.patch("life_console_cloud.request.urlopen", side_effect=exc):
                    with self.assertRaisesRegex(CloudWriteError, "^unavailable$"):
                        transport.request("POST", "/rest/v1/rpc/upsert_health_day_v1", body={})

    def test_http_transport_leaves_health_messages_unavailable_off_health_rpc(self):
        response = io.BytesIO(json.dumps({
            "message": "health_day_invalid_source",
        }).encode("utf-8"))
        exc = HTTPError("https://project.invalid", 400, "Bad Request", None, response)
        transport = HttpTransport("https://project.invalid", "synthetic-publishable-key")

        with mock.patch("life_console_cloud.request.urlopen", side_effect=exc):
            with self.assertRaisesRegex(CloudWriteError, "^unavailable$"):
                transport.request("POST", "/rest/v1/rpc/create_daily_checkin", body={})

    def test_health_day_write_rejects_malformed_dates_revisions_and_multiple_rows(self):
        parsed = {
            "health_date": "2026-08-26",
            "generated_at": "2026-08-26T13:30:00+08:00",
            "summary": {},
        }
        malformed_responses = (
            [{"action": "created", "health_date": "", "revision": 1}],
            [{"action": "created", "health_date": "not-a-date", "revision": 1}],
            [{"action": "created", "health_date": "2026-02-30", "revision": 1}],
            [{"action": "created", "health_date": "2026-08-25", "revision": 1}],
            [{"action": "created", "health_date": "2026-08-26", "revision": True}],
            [{"action": "created", "health_date": "2026-08-26", "revision": 0}],
            [{"action": "created", "health_date": "2026-08-26", "revision": -1}],
            [
                {"action": "created", "health_date": "2026-08-26", "revision": 1},
                {"action": "created", "health_date": "2026-08-26", "revision": 1},
            ],
        )
        for response in malformed_responses:
            with self.subTest(response=response):
                client = CloudClient(
                    FakeTransport([response]), token_provider=lambda: "synthetic-token"
                )
                with self.assertRaisesRegex(CloudWriteError, "^unavailable$"):
                    client.upsert_health_day(parsed)

    def test_health_day_cli_parses_before_loading_client_and_prints_only_receipt(self):
        parsed = {
            "health_date": "2030-01-02",
            "generated_at": "2030-01-02T13:30:00+08:00",
            "summary": {"steps": 4321},
        }
        client = mock.Mock()
        client.upsert_health_day.return_value = {
            "status": "saved",
            "resource": "health_day",
            "action": "created",
            "date": "2030-01-02",
            "revision": 1,
        }
        output = io.StringIO()
        clock = mock.Mock()
        clock.now.return_value.date.return_value.isoformat.return_value = "2030-01-02"

        with mock.patch("life_console_cloud.datetime", clock):
            with mock.patch("life_console_cloud._load_client", return_value=client) as load:
                def read_before_client(source, expected_date):
                    load.assert_not_called()
                    return parsed

                with mock.patch(
                    "life_console_cloud.read_health_summary", side_effect=read_before_client
                ) as read:
                    with mock.patch("sys.stdout", output):
                        self.assertEqual(main([
                            "health-day", "--source", "synthetic-health.txt", "--expect-today",
                        ]), 0)

        read.assert_called_once_with(Path("synthetic-health.txt"), "2030-01-02")
        load.assert_called_once()
        client.upsert_health_day.assert_called_once_with(parsed)
        self.assertEqual(json.loads(output.getvalue()), {
            "status": "saved",
            "resource": "health_day",
            "action": "created",
            "date": "2030-01-02",
            "revision": 1,
        })
        self.assertNotIn("4321", output.getvalue())

    def test_health_day_cli_invalid_source_never_loads_client_and_fails_closed(self):
        for source_kind in ("stale", "missing", "invalid"):
            with self.subTest(source_kind=source_kind):
                output = io.StringIO()
                error_output = io.StringIO()
                with mock.patch(
                    "life_console_cloud.read_health_summary",
                    side_effect=HealthHistoryError(source_kind),
                ):
                    with mock.patch("life_console_cloud._load_client") as load:
                        with mock.patch("sys.stdout", output), mock.patch("sys.stderr", error_output):
                            self.assertEqual(main([
                                "health-day", "--source", "synthetic-health.txt", "--expect-today",
                            ]), 2)
                load.assert_not_called()
                self.assertEqual(output.getvalue(), "")
                self.assertEqual(json.loads(error_output.getvalue()), {"status": "invalid_source"})

    def test_health_day_cli_cloud_failures_return_one_closed_status(self):
        parsed = {
            "health_date": "2030-01-02",
            "generated_at": "2030-01-02T13:30:00+08:00",
            "summary": {},
        }
        for status in ("stale_source", "invalid_source", "conflict", "unauthenticated", "unavailable"):
            with self.subTest(status=status):
                client = mock.Mock()
                client.upsert_health_day.side_effect = CloudWriteError(status)
                error_output = io.StringIO()
                with mock.patch("life_console_cloud.read_health_summary", return_value=parsed):
                    with mock.patch("life_console_cloud._load_client", return_value=client):
                        with mock.patch("sys.stderr", error_output):
                            self.assertEqual(main([
                                "health-day", "--source", "synthetic-health.txt", "--expect-today",
                            ]), 2)
                self.assertEqual(json.loads(error_output.getvalue()), {"status": status})

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

    def test_weekly_message_context_reads_only_the_approved_owner_projection(self):
        transport = FakeTransport([
            [{"title": "Synthetic goal", "domain": "life", "target_date": None}],
            [{
                "title": "Synthetic todo",
                "priority": "P0",
                "status": "in_progress",
                "due_at": "2030-01-08T04:00:00Z",
            }],
            [{"week_start": "2029-12-31", "structured_data": {"experiment": "Synthetic"}}],
            [{"revision": 3}],
        ])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")

        context = client.weekly_message_context("2030-01-07")

        self.assertEqual(context, {
            "week_start": "2030-01-07",
            "active_goals": [{
                "title": "Synthetic goal", "domain": "life", "target_date": None,
            }],
            "open_priority_todos": [{
                "title": "Synthetic todo",
                "priority": "P0",
                "status": "in_progress",
                "due_at": "2030-01-08T04:00:00Z",
            }],
            "latest_weekly_review": {
                "week_start": "2029-12-31",
                "structured_data": {"experiment": "Synthetic"},
            },
            "current_message_revision": 3,
        })
        paths = [call[1] for call in transport.calls]
        self.assertIn("status=eq.active", paths[0])
        self.assertIn("deleted_at=is.null", paths[0])
        self.assertIn("priority=in.%28P0%2CP1%29", paths[1])
        self.assertIn("status=neq.completed", paths[1])
        self.assertIn("select=week_start%2Cstructured_data", paths[2])
        self.assertNotIn("content", paths[2])
        self.assertIn("week_start=eq.2030-01-07", paths[3])

    def test_weekly_message_write_uses_revision_safe_rpc_and_redacted_receipt(self):
        transport = FakeTransport([[{
            "id": 8,
            "revision": 4,
            "message": "Synthetic private weekly message",
        }]])
        client = CloudClient(transport, token_provider=lambda: "synthetic-token")

        receipt = client.upsert_dashboard_message({
            "week_start": "2030-01-07",
            "expected_revision": 3,
            "message": "Synthetic private weekly message",
            "quote_source": None,
            "image_metadata": {},
            "fallback_theme": "twilight",
        })

        self.assertEqual(receipt, {
            "status": "saved",
            "resource": "dashboard_message",
            "revision": 4,
        })
        self.assertNotIn("Synthetic private weekly message", json.dumps(receipt))
        method, path, body, bearer_used = transport.calls[0]
        self.assertEqual((method, path, bearer_used), (
            "POST", "/rest/v1/rpc/upsert_dashboard_message", "synthetic-token",
        ))
        self.assertEqual(body["p_idempotency_key"], "weekly-message:2030-01-07")
        self.assertEqual(body["p_expected_revision"], 3)
        self.assertEqual(body["p_fallback_theme"], "twilight")

    def test_weekly_message_cli_exposes_context_and_redacted_write_receipt(self):
        client = mock.Mock()
        client.weekly_message_context.return_value = {
            "week_start": "2030-01-07",
            "active_goals": [],
            "open_priority_todos": [],
            "latest_weekly_review": None,
            "current_message_revision": None,
        }
        client.upsert_dashboard_message.return_value = {
            "status": "saved", "resource": "dashboard_message", "revision": 1,
        }

        with mock.patch("life_console_cloud._load_client", return_value=client):
            output = io.StringIO()
            with mock.patch("sys.stdout", output):
                self.assertEqual(main([
                    "weekly-message-context", "--week-start", "2030-01-07",
                ]), 0)
            self.assertEqual(json.loads(output.getvalue())["week_start"], "2030-01-07")

            output = io.StringIO()
            payload = json.dumps({
                "week_start": "2030-01-07",
                "expected_revision": None,
                "message": "Synthetic private weekly message",
            })
            with mock.patch("sys.stdin", io.StringIO(payload)):
                with mock.patch("sys.stdout", output):
                    self.assertEqual(main(["dashboard-message", "--input", "-"]), 0)
            self.assertEqual(json.loads(output.getvalue()), {
                "resource": "dashboard_message", "revision": 1, "status": "saved",
            })
        client.weekly_message_context.assert_called_once_with("2030-01-07")
        client.upsert_dashboard_message.assert_called_once()

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
