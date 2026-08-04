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


class SyntheticWorkflowTests(unittest.TestCase):
    def test_read_write_conflict_and_delete_workflow(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "records").mkdir()
            (root / "journal").mkdir()
            (root / "GOALS.md").write_text("## 当前重点\n- 合成验收重点\n", encoding="utf-8")
            server = create_server(root=root, port=0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            connection = http.client.HTTPConnection(*server.server_address)
            host = f"127.0.0.1:{server.server_port}"
            try:
                def request(method: str, path: str, body: dict | None = None, auth: dict | None = None):
                    headers = {"Host": host}
                    if body is not None:
                        headers.update({"Content-Type": "application/json", **(auth or {})})
                    connection.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
                    response = connection.getresponse()
                    return response.status, json.loads(response.read())

                self.assertEqual(request("GET", "/api/v1/dashboard")[0], 200)
                _, session = request("GET", "/api/v1/session")
                cookie = next(iter(server.sessions))
                auth = {
                    "Origin": f"http://{host}",
                    "Cookie": f"life_console_session={cookie}",
                    "X-Life-CSRF": session["csrf_token"],
                }
                journal = {
                    "schema_version": 1, "idempotency_key": "e2e_journal_key_01",
                    "event_date": "2026-01-12", "time_precision": "unknown",
                    "text": "合成全链路日记正文",
                }
                first = request("POST", "/api/v1/journals", journal, auth)
                replay = request("POST", "/api/v1/journals", journal, auth)
                self.assertEqual(first, replay)

                checkin = {
                    "schema_version": 1, "idempotency_key": "e2e_checkin_key_01",
                    "expect_revision": None, "fields": {"energy": 3},
                }
                self.assertEqual(request("POST", "/api/v1/checkins/2026-01-12", checkin, auth)[0], 200)
                stale = {**checkin, "idempotency_key": "e2e_checkin_key_02", "expect_revision": 99}
                self.assertEqual(request("POST", "/api/v1/checkins/2026-01-12", stale, auth)[0], 409)

                _, plan = request("POST", "/api/v1/purge-plans", {
                    "schema_version": 1, "target_type": "daily_checkin", "target_key": "2026-01-12",
                }, auth)
                confirm = {
                    "schema_version": 1, "idempotency_key": "e2e_purge_key_001",
                    "plan_id": plan["plan_id"], "confirmation_text": plan["confirmation_text"],
                    "expect_revision": plan["expect_revision"], "plan_etag": plan["plan_etag"],
                    "acknowledge_historical_copies": True,
                }
                self.assertEqual(request("POST", "/api/v1/purge-confirmations", confirm, auth)[0], 200)
                self.assertEqual((root / "records/daily-checkins.jsonl").read_text(), "")
                self.assertNotIn("合成全链路日记正文", (root / "journal/index.jsonl").read_text())
            finally:
                connection.close()
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == "__main__":
    unittest.main()
