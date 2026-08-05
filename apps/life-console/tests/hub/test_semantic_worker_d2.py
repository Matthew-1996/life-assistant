from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = APP_ROOT.parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from hub.semantic import (  # noqa: E402
    ALLOWED_ENDPOINT,
    ProviderError,
    ProviderRequest,
    ProviderResponse,
    SingleConcurrencyWorker,
    jobs,
    request_enrichment,
    run_with_retry,
    source_fingerprint,
)
from hub.semantic.source import read_source  # noqa: E402

RAW_TEXT = "今天和同伴甲去公园散步，聊了很久，回来路上买了咖啡，感觉很放松。"


def _model_reply(payload: dict) -> ProviderResponse:
    content = json.dumps(payload, ensure_ascii=False)
    return ProviderResponse(200, {"choices": [{"message": {"content": content}}]})


class SemanticWorkerD2Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.journal_root = Path(self.temp.name) / "journal"
        self.journal_root.mkdir(parents=True)
        self.journal_id = self._add_entry()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _add_entry(self) -> str:
        payload = {
            "date": "2026-01-12",
            "time": None,
            "time_precision": "unknown",
            "title": "2026-01-12 日记",
            "summary": "",
            "raw": RAW_TEXT,
            "source": "explicit",
            "privacy": "local-only",
            "facts": [],
            "feelings": [],
            "people": [],
            "places": [],
            "themes": [],
            "tags": [],
        }
        result = subprocess.run(
            [
                sys.executable,
                str(REPO_ROOT / "tools/journal_manager.py"),
                "add",
                "--input",
                "-",
                "--root",
                str(self.journal_root),
            ],
            input=json.dumps(payload, ensure_ascii=False),
            text=True,
            capture_output=True,
            check=True,
        )
        return json.loads(result.stdout)["id"]

    def _record(self) -> dict:
        return read_source(self.journal_root, self.journal_id)["record"]

    def _create_job(self, job_id: str = "job_synthetic_0001") -> dict:
        return jobs.create_job(
            self.journal_root,
            job_id=job_id,
            journal_id=self.journal_id,
            source_fingerprint=source_fingerprint(self._record()),
            model="deepseek-v4-flash",
            prompt_version="journal-enrichment-2026-08-05.1",
            authorization_version="auth-1",
        )

    def _month_text(self) -> str:
        return (self.journal_root / "entries/2026/2026-01.md").read_text(encoding="utf-8")

    # --- source reading -------------------------------------------------
    def test_read_source_recovers_raw_from_month_markdown(self) -> None:
        source = read_source(self.journal_root, self.journal_id)
        self.assertEqual(source["raw"], RAW_TEXT)
        self.assertEqual(len(source["fingerprint"]), 64)

    # --- happy path -----------------------------------------------------
    def test_success_amends_index_without_touching_raw_or_date(self) -> None:
        job = self._create_job()

        def transport(_request: ProviderRequest) -> ProviderResponse:
            return _model_reply({
                "title": "公园散步",
                "summary": "和同伴甲散步聊天，买了咖啡，感到放松。",
                "facts": ["和同伴甲去公园散步", "买了咖啡"],
                "feelings": ["放松"],
                "people": ["同伴甲"],
                "places": ["公园"],
                "themes": ["关系连接"],
                "tags": ["散步"],
            })

        updated = run_with_retry(
            code_root=REPO_ROOT, journal_root=self.journal_root, job=job, transport=transport,
        )
        self.assertEqual(updated["status"], "succeeded")

        record = self._record()
        self.assertEqual(record["title"], "公园散步")
        self.assertEqual(record["people"], ["同伴甲"])
        self.assertEqual(record["planning_clues"], [])
        self.assertEqual(record["inferences"], [])
        # 原文与日期不变，审计历史保留。
        self.assertEqual(read_source(self.journal_root, self.journal_id)["raw"], RAW_TEXT)
        self.assertEqual(record["date"], "2026-01-12")
        self.assertEqual(len(record["amendments"]), 1)

    def test_audit_and_job_never_store_raw_or_bodies(self) -> None:
        job = self._create_job()
        run_with_retry(
            code_root=REPO_ROOT, journal_root=self.journal_root, job=job,
            transport=lambda _r: _model_reply({"summary": "机密摘要正文示例"}),
        )
        audit = (self.journal_root / "enrichment-audit.jsonl").read_text(encoding="utf-8")
        job_file = (
            self.journal_root / ".operations/semantic-jobs" / f"{job['job_id']}.json"
        ).read_text(encoding="utf-8")
        for blob in (audit, job_file):
            self.assertNotIn(RAW_TEXT, blob)
            self.assertNotIn("机密摘要正文示例", blob)
            self.assertNotIn("公园", blob)

    # --- source drift ---------------------------------------------------
    def test_source_change_between_commit_and_send_is_rejected(self) -> None:
        job = self._create_job()
        # 用户在作业创建后又更正了这篇日记，使指纹漂移。
        subprocess.run(
            [
                sys.executable, str(REPO_ROOT / "tools/journal_manager.py"), "amend",
                "--input", "-", "--root", str(self.journal_root),
            ],
            input=json.dumps({
                "id": self.journal_id, "note": "手动更正", "privacy": "local-only",
                "title": "手动标题", "summary": "手动摘要",
                "facts": ["手动事实"], "feelings": [], "people": [], "places": [],
                "themes": [], "tags": [], "planning_clues": [], "inferences": [],
            }, ensure_ascii=False),
            text=True, capture_output=True, check=True,
        )
        sent = {"called": False}

        def transport(_request: ProviderRequest) -> ProviderResponse:
            sent["called"] = True
            return _model_reply({"summary": "不应发生"})

        updated = run_with_retry(
            code_root=REPO_ROOT, journal_root=self.journal_root, job=job, transport=transport,
        )
        self.assertEqual(updated["status"], "failed")
        self.assertEqual(updated["failure_code"], "SOURCE_CHANGED")
        self.assertFalse(sent["called"])  # 漂移后绝不发送旧原文
        # 用户手动更正未被覆盖。
        self.assertEqual(self._record()["title"], "手动标题")

    # --- provider failures ---------------------------------------------
    def test_provider_5xx_becomes_generic_failure_after_retries(self) -> None:
        job = self._create_job()

        def transport(_request: ProviderRequest) -> ProviderResponse:
            return ProviderResponse(503, {})

        updated = run_with_retry(
            code_root=REPO_ROOT, journal_root=self.journal_root, job=job,
            transport=transport, sleep=lambda _s: None,
        )
        self.assertEqual(updated["status"], "failed")
        self.assertEqual(updated["failure_code"], "PROVIDER_UNAVAILABLE")
        self.assertEqual(updated["attempts"], job["max_retries"] + 1)

    def test_empty_content_is_retryable_and_never_empty_overwrites(self) -> None:
        job = self._create_job()
        updated = run_with_retry(
            code_root=REPO_ROOT, journal_root=self.journal_root, job=job,
            transport=lambda _r: ProviderResponse(200, {"choices": [{"message": {"content": ""}}]}),
            sleep=lambda _s: None,
        )
        self.assertEqual(updated["status"], "failed")
        # 空内容归 provider 层可重试失败；索引不被空覆盖。
        self.assertEqual(self._record()["title"], "2026-01-12 日记")

    def test_invalid_model_json_is_generic_failure(self) -> None:
        job = self._create_job()
        updated = run_with_retry(
            code_root=REPO_ROOT, journal_root=self.journal_root, job=job,
            transport=lambda _r: ProviderResponse(200, {"choices": [{"message": {"content": "不是JSON"}}]}),
            sleep=lambda _s: None,
        )
        self.assertEqual(updated["status"], "failed")
        self.assertEqual(updated["failure_code"], "MODEL_OUTPUT_INVALID")

    def test_field_overreach_is_rejected_without_amend(self) -> None:
        job = self._create_job()
        updated = run_with_retry(
            code_root=REPO_ROOT, journal_root=self.journal_root, job=job,
            transport=lambda _r: _model_reply({"raw": "覆盖原文", "title": "x"}),
            sleep=lambda _s: None,
        )
        self.assertEqual(updated["status"], "failed")
        self.assertEqual(updated["failure_code"], "MODEL_OUTPUT_INVALID")
        self.assertEqual(self._record()["title"], "2026-01-12 日记")

    # --- allowlist & recovery ------------------------------------------
    def test_client_rejects_non_allowlisted_endpoint(self) -> None:
        with self.assertRaises(ProviderError):
            request_enrichment(
                raw_text=RAW_TEXT, model="deepseek-v4-flash",
                transport=lambda _r: _model_reply({"title": "x"}),
                url="https://evil.example.com/v1/chat",
            )

    def test_allowlisted_endpoint_constant_is_https_deepseek(self) -> None:
        self.assertTrue(ALLOWED_ENDPOINT.startswith("https://api.deepseek.com"))

    def test_worker_recovers_pending_jobs_after_restart(self) -> None:
        self._create_job("job_recover_0001")
        worker = SingleConcurrencyWorker(
            code_root=REPO_ROOT,
            journal_root=self.journal_root,
            transport=lambda _r: _model_reply({"title": "恢复后的标题", "summary": "恢复摘要"}),
        )
        results = worker.recover()
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["status"], "succeeded")
        self.assertEqual(self._record()["title"], "恢复后的标题")
        # 完成的作业不再列为可恢复。
        self.assertEqual(list(jobs.iter_recoverable(self.journal_root)), [])

    def test_idempotent_job_creation(self) -> None:
        first = self._create_job("job_idem_0001")
        again = jobs.create_job(
            self.journal_root,
            job_id="job_idem_0001",
            journal_id=self.journal_id,
            source_fingerprint="different-would-be-ignored",
            model="deepseek-v4-pro",
            prompt_version="journal-enrichment-2026-08-05.1",
            authorization_version="auth-1",
        )
        self.assertEqual(first["created_at"], again["created_at"])
        self.assertEqual(again["model"], "deepseek-v4-flash")


if __name__ == "__main__":
    unittest.main()
