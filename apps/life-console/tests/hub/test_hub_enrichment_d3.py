from __future__ import annotations

import http.client
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = APP_ROOT.parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from hub.server import create_server  # noqa: E402
from hub.semantic.deepseek_client import ProviderResponse  # noqa: E402

RAW_TEXT = "今天和同伴甲去公园散步，聊了很久，感觉放松。"


def _reply(payload: dict) -> ProviderResponse:
    return ProviderResponse(200, {"choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}]})


class HubEnrichmentD3Tests(unittest.TestCase):
    def _start(self, *, authorization: str | None, transport=None) -> None:
        self.server = create_server(
            root=self.root,
            port=0,
            enrichment_authorization=authorization,
            enrichment_transport=transport,
            enrichment_synchronous=True,
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.connection = http.client.HTTPConnection(*self.server.server_address)
        self.host = f"127.0.0.1:{self.server.server_port}"
        self.connection.request("GET", "/api/v1/session", headers={"Host": self.host})
        response = self.connection.getresponse()
        session = json.loads(response.read())
        self.cookie = response.getheader("Set-Cookie").split(";", 1)[0]
        self.csrf = session["csrf_token"]

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "records").mkdir()
        (self.root / "journal").mkdir()
        self.journal_id = self._add_entry()
        self.server = None

    def tearDown(self) -> None:
        if self.server is not None:
            self.connection.close()
            self.server.shutdown()
            self.server.server_close()
            self.thread.join()
        self.temp.cleanup()

    def _add_entry(self) -> str:
        payload = {
            "date": "2026-01-12", "time": None, "time_precision": "unknown",
            "title": "2026-01-12 日记", "summary": "", "raw": RAW_TEXT,
            "source": "explicit", "privacy": "local-only",
            "facts": [], "feelings": [], "people": [], "places": [], "themes": [], "tags": [],
        }
        result = subprocess.run(
            [sys.executable, str(REPO_ROOT / "tools/journal_manager.py"), "add",
             "--input", "-", "--root", str(self.root / "journal")],
            input=json.dumps(payload, ensure_ascii=False), text=True, capture_output=True, check=True,
        )
        return json.loads(result.stdout)["id"]

    def post(self, path: str, body: dict, *, csrf: bool = True) -> tuple[int, dict]:
        headers = {
            "Host": self.host, "Origin": f"http://{self.host}",
            "Content-Type": "application/json", "Cookie": self.cookie,
        }
        if csrf:
            headers["X-Life-CSRF"] = self.csrf
        self.connection.request("POST", path, body=json.dumps(body), headers=headers)
        response = self.connection.getresponse()
        return response.status, json.loads(response.read())

    def get(self, path: str) -> tuple[int, dict]:
        self.connection.request("GET", path, headers={"Host": self.host, "Cookie": self.cookie})
        response = self.connection.getresponse()
        return response.status, json.loads(response.read())

    def _title(self) -> str:
        record = json.loads((self.root / "journal/index.jsonl").read_text(encoding="utf-8"))
        return record["title"]

    # --- preview is offline & does not require authorization ------------
    def test_preview_is_offline_and_lists_scope(self) -> None:
        self._start(authorization=None)
        status, preview = self.post("/api/v1/journal-enrichments/preview", {
            "schema_version": 1, "journal_id": self.journal_id,
        })
        self.assertEqual(status, 200)
        self.assertEqual(preview["provider"], "deepseek")
        self.assertEqual(preview["journal_id"], self.journal_id)
        self.assertIn("preview_token", preview)
        # 预览不含原文。
        self.assertNotIn(RAW_TEXT, json.dumps(preview, ensure_ascii=False))

    def test_commit_without_authorization_is_rejected(self) -> None:
        self._start(authorization=None)
        _, preview = self.post("/api/v1/journal-enrichments/preview", {
            "schema_version": 1, "journal_id": self.journal_id,
        })
        status, result = self.post("/api/v1/journal-enrichments/commit", {
            "schema_version": 1, "idempotency_key": "synthetic_commit_0001",
            "preview_token": preview["preview_token"],
        })
        self.assertEqual(status, 400)
        self.assertEqual(result["error"]["code"], "INVALID_REQUEST")
        # 未授权则原文从未离开本机；标题不变。
        self.assertEqual(self._title(), "2026-01-12 日记")

    # --- authorized happy path -----------------------------------------
    def test_authorized_commit_amends_entry_and_status_reports_success(self) -> None:
        self._start(
            authorization="auth-1",
            transport=lambda _r: _reply({
                "title": "公园散步", "summary": "和同伴甲散步聊天，感到放松。",
                "facts": ["和同伴甲去公园散步"], "feelings": ["放松"],
                "people": ["同伴甲"], "places": ["公园"], "themes": [], "tags": ["散步"],
            }),
        )
        _, preview = self.post("/api/v1/journal-enrichments/preview", {
            "schema_version": 1, "journal_id": self.journal_id, "model": "deepseek-v4-flash",
        })
        status, job = self.post("/api/v1/journal-enrichments/commit", {
            "schema_version": 1, "idempotency_key": "synthetic_commit_0002",
            "preview_token": preview["preview_token"],
        })
        self.assertEqual(status, 202)
        self.assertEqual(job["journal_id"], self.journal_id)
        # 同步 worker 已完成；查询状态为 succeeded。
        code, view = self.get(f"/api/v1/journal-enrichments/{job['job_id']}")
        self.assertEqual(code, 200)
        self.assertEqual(view["status"], "succeeded")
        self.assertEqual(self._title(), "公园散步")

    def test_commit_is_idempotent_by_key(self) -> None:
        self._start(authorization="auth-1", transport=lambda _r: _reply({"title": "整理后的标题"}))
        _, preview = self.post("/api/v1/journal-enrichments/preview", {
            "schema_version": 1, "journal_id": self.journal_id,
        })
        first = self.post("/api/v1/journal-enrichments/commit", {
            "schema_version": 1, "idempotency_key": "synthetic_commit_0003",
            "preview_token": preview["preview_token"],
        })
        self.assertEqual(first[0], 202)
        # 相同 idempotency_key + 新预览 → 同一个 job_id（幂等，不重复创建）。
        _, preview2 = self.post("/api/v1/journal-enrichments/preview", {
            "schema_version": 1, "journal_id": self.journal_id,
        })
        second = self.post("/api/v1/journal-enrichments/commit", {
            "schema_version": 1, "idempotency_key": "synthetic_commit_0003",
            "preview_token": preview2["preview_token"],
        })
        self.assertEqual(second[1]["job_id"], first[1]["job_id"])

    # --- failure + retry ------------------------------------------------
    def test_failed_job_can_be_retried_by_user(self) -> None:
        state = {"fail": True}

        def transport(_request):
            if state["fail"]:
                return ProviderResponse(503, {})
            return _reply({"title": "重试后的标题"})

        self._start(authorization="auth-1", transport=transport)
        _, preview = self.post("/api/v1/journal-enrichments/preview", {
            "schema_version": 1, "journal_id": self.journal_id,
        })
        _, job = self.post("/api/v1/journal-enrichments/commit", {
            "schema_version": 1, "idempotency_key": "synthetic_commit_0004",
            "preview_token": preview["preview_token"],
        })
        _, view = self.get(f"/api/v1/journal-enrichments/{job['job_id']}")
        self.assertEqual(view["status"], "failed")
        self.assertEqual(view["failure_code"], "PROVIDER_UNAVAILABLE")

        state["fail"] = False
        status, _retried = self.post(
            f"/api/v1/journal-enrichments/{job['job_id']}/retry",
            {"schema_version": 1, "idempotency_key": "synthetic_retry_0001"},
        )
        self.assertEqual(status, 202)
        _, view2 = self.get(f"/api/v1/journal-enrichments/{job['job_id']}")
        self.assertEqual(view2["status"], "succeeded")
        self.assertEqual(self._title(), "重试后的标题")

    def test_unknown_job_status_is_404(self) -> None:
        self._start(authorization="auth-1")
        status, result = self.get("/api/v1/journal-enrichments/job_does_not_exist_000000")
        self.assertEqual(status, 404)
        self.assertEqual(result["error"]["code"], "NOT_FOUND")

    def test_enrichment_requires_csrf(self) -> None:
        self._start(authorization="auth-1")
        status, result = self.post("/api/v1/journal-enrichments/preview", {
            "schema_version": 1, "journal_id": self.journal_id,
        }, csrf=False)
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
