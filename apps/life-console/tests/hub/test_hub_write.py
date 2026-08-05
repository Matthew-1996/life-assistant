from __future__ import annotations

import http.client
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP_ROOT))

from hub.server import create_server


class HubWriteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "records").mkdir()
        (self.root / "journal").mkdir()
        self.server = create_server(root=self.root, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.connection = http.client.HTTPConnection(*self.server.server_address)
        self.host = f"127.0.0.1:{self.server.server_port}"
        self.connection.request("GET", "/api/v1/session", headers={"Host": self.host})
        response = self.connection.getresponse()
        session = json.loads(response.read())
        self.cookie = response.getheader("Set-Cookie").split(";", 1)[0]
        self.csrf = session["csrf_token"]

    def tearDown(self) -> None:
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def post(self, path: str, body: dict, *, csrf: bool = True) -> tuple[int, dict]:
        headers = {
            "Host": self.host,
            "Origin": f"http://{self.host}",
            "Content-Type": "application/json",
            "Cookie": self.cookie,
        }
        if csrf:
            headers["X-Life-CSRF"] = self.csrf
        self.connection.request("POST", path, body=json.dumps(body), headers=headers)
        response = self.connection.getresponse()
        return response.status, json.loads(response.read())

    def test_journal_uses_stdin_and_idempotency(self) -> None:
        text = "合成正文，只用于临时项目测试"
        body = {
            "schema_version": 1,
            "idempotency_key": "synthetic_key_0001",
            "event_date": "2026-01-12",
            "time_precision": "unknown",
            "text": text,
        }
        status, first = self.post("/api/v1/journals", body)
        status_again, second = self.post("/api/v1/journals", body)
        self.assertEqual((status, status_again), (200, 200))
        self.assertEqual(first, second)
        index = (self.root / "journal/index.jsonl").read_text(encoding="utf-8")
        self.assertEqual(index.count('"id":'), 1)
        self.assertNotIn(text, index)

    def test_idempotency_key_rejects_changed_body(self) -> None:
        body = {
            "schema_version": 1,
            "idempotency_key": "synthetic_key_0002",
            "event_date": "2026-01-12",
            "time_precision": "unknown",
            "text": "第一条合成正文",
        }
        self.assertEqual(self.post("/api/v1/journals", body)[0], 200)
        changed = {**body, "text": "不同的合成正文"}
        status, result = self.post("/api/v1/journals", changed)
        self.assertEqual(status, 409)
        self.assertEqual(result["error"]["code"], "INVALID_REQUEST")

    def test_checkin_partial_update_and_revision_conflict(self) -> None:
        first = {
            "schema_version": 1,
            "idempotency_key": "synthetic_key_0003",
            "expect_revision": None,
            "fields": {"energy": 3},
        }
        status, result = self.post("/api/v1/checkins/2026-01-12", first)
        self.assertEqual(status, 200)
        self.assertEqual(result["source"]["revision"], 1)
        record = json.loads((self.root / "records/daily-checkins.jsonl").read_text())
        self.assertEqual(record["ratings"]["energy"], 3)
        self.assertIsNone(record["ratings"]["mood"])

        stale = {
            "schema_version": 1,
            "idempotency_key": "synthetic_key_0004",
            "expect_revision": 99,
            "fields": {"mood": 4},
        }
        status, result = self.post("/api/v1/checkins/2026-01-12", stale)
        self.assertEqual(status, 409)
        self.assertEqual(result["error"]["code"], "REVISION_CONFLICT")

    def test_write_requires_csrf(self) -> None:
        body = {
            "schema_version": 1,
            "idempotency_key": "synthetic_key_0005",
            "expect_revision": None,
            "fields": {"energy": 3},
        }
        status, result = self.post("/api/v1/checkins/2026-01-12", body, csrf=False)
        self.assertEqual(status, 403)
        self.assertEqual(result["error"]["code"], "INVALID_REQUEST")

    def test_source_success_survives_snapshot_refresh_failure(self) -> None:
        (self.root / "GOALS.md").write_bytes(b"\xff")
        body = {
            "schema_version": 1,
            "idempotency_key": "synthetic_key_0006",
            "event_date": "2026-01-12",
            "time_precision": "unknown",
            "text": "刷新失败场景的合成正文",
        }
        status, result = self.post("/api/v1/journals", body)
        self.assertEqual(status, 200)
        self.assertEqual(result["source"]["state"], "saved")
        self.assertEqual(result["read_model"], "pending_refresh")
        self.assertTrue((self.root / "journal/index.jsonl").exists())

    def test_daily_purge_requires_exact_plan_and_confirmation(self) -> None:
        create = {
            "schema_version": 1,
            "idempotency_key": "synthetic_key_0007",
            "expect_revision": None,
            "fields": {"energy": 3},
        }
        self.assertEqual(self.post("/api/v1/checkins/2026-01-12", create)[0], 200)
        status, plan = self.post("/api/v1/purge-plans", {
            "schema_version": 1,
            "target_type": "daily_checkin",
            "target_key": "2026-01-12",
        })
        self.assertEqual(status, 200)
        wrong = {
            "schema_version": 1,
            "idempotency_key": "synthetic_key_0008",
            "plan_id": plan["plan_id"],
            "confirmation_text": "错误确认",
            "expect_revision": plan["expect_revision"],
            "plan_etag": plan["plan_etag"],
            "acknowledge_historical_copies": True,
        }
        self.assertEqual(self.post("/api/v1/purge-confirmations", wrong)[0], 409)
        exact = {**wrong, "idempotency_key": "synthetic_key_0009", "confirmation_text": plan["confirmation_text"]}
        status, result = self.post("/api/v1/purge-confirmations", exact)
        self.assertEqual(status, 200)
        self.assertEqual(result["source"]["state"], "saved")
        self.assertEqual((self.root / "records/daily-checkins.jsonl").read_text(), "")

    def test_purge_plan_rejects_source_drift(self) -> None:
        create = {
            "schema_version": 1,
            "idempotency_key": "synthetic_key_0010",
            "expect_revision": None,
            "fields": {"energy": 3},
        }
        self.post("/api/v1/checkins/2026-01-12", create)
        _, plan = self.post("/api/v1/purge-plans", {
            "schema_version": 1,
            "target_type": "daily_checkin",
            "target_key": "2026-01-12",
        })
        update = {
            "schema_version": 1,
            "idempotency_key": "synthetic_key_0011",
            "expect_revision": 1,
            "fields": {"mood": 4},
        }
        self.assertEqual(self.post("/api/v1/checkins/2026-01-12", update)[0], 200)
        confirm = {
            "schema_version": 1,
            "idempotency_key": "synthetic_key_0012",
            "plan_id": plan["plan_id"],
            "confirmation_text": plan["confirmation_text"],
            "expect_revision": plan["expect_revision"],
            "plan_etag": plan["plan_etag"],
            "acknowledge_historical_copies": True,
        }
        status, result = self.post("/api/v1/purge-confirmations", confirm)
        self.assertEqual(status, 409)
        self.assertEqual(result["error"]["code"], "REVISION_CONFLICT")


if __name__ == "__main__":
    unittest.main()
