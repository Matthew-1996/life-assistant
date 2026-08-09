from __future__ import annotations

import http.client
import json
import sys
import tempfile
import threading
import unittest
from datetime import date
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP_ROOT))

from hub.read_model.dashboard import ReadModelError, build_dashboard
from hub.server import create_server


def daily(day: str) -> dict:
    return {
        "schema_version": 2, "key": f"daily-checkin:{day}", "date": day,
        "sleep_time": "23:30", "wake_time": "07:30", "out_of_bed_time": None,
        "ratings": {"sleep_quality": 4, "energy": 3, "mood": 4, "life_feeling": 3},
        "awake_in_bed": None,
        "anchors": {"wake": "complete", "body_light": None, "life_action": None, "wind_down": None},
        "note_summary": None, "revision": 2,
        "created_at": "2026-01-12T01:00:00Z", "updated_at": "2026-01-12T02:00:00Z",
    }


def journal() -> dict:
    record = {
        "id": "synthetic-entry", "date": "2026-01-12", "time": None,
        "time_precision": "unknown", "title": "合成散步", "summary": "一次虚构的散步记录",
        "source": "explicit", "privacy": "local-only", "file": "synthetic.md",
        "status": "active", "weekly_reviews": [], "monthly_reviews": [],
        "amendments": [], "invalidated_reviews": [], "recorded_at": "2026-01-12T02:00:00Z",
    }
    for field in ("facts", "feelings", "people", "places", "themes", "tags", "planning_clues", "inferences"):
        record[field] = []
    return record


class HubReadTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "records").mkdir()
        (self.root / "journal").mkdir()
        (self.root / "GOALS.md").write_text("## 当前重点\n- 保持合成节奏\n", encoding="utf-8")
        (self.root / "records/daily-checkins.jsonl").write_text(
            json.dumps(daily("2026-01-12"), ensure_ascii=False) + "\n", encoding="utf-8"
        )
        (self.root / "journal/index.jsonl").write_text(
            json.dumps(journal(), ensure_ascii=False) + "\n", encoding="utf-8"
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_dashboard_is_whitelisted(self) -> None:
        result = build_dashboard(self.root, today=date(2026, 1, 12))
        self.assertEqual(result["today"]["focus"]["title"], "保持合成节奏")
        self.assertEqual(result["today"]["daily_revision"], 2)
        self.assertEqual(
            [sample["date"] for sample in result["progress"]["ratings"]],
            [f"2026-01-{day:02d}" for day in range(6, 13)],
        )
        self.assertEqual(result["progress"]["sample_counts"], {"daily": 1, "missing": 6})
        self.assertIsNone(result["progress"]["ratings"][0]["energy"])
        self.assertEqual(result["progress"]["ratings"][-1]["energy"], 3)
        self.assertEqual(result["system"]["icloud"], "readable")
        self.assertNotIn("note_summary", json.dumps(result, ensure_ascii=False))
        self.assertNotIn("raw", json.dumps(result, ensure_ascii=False))

    def test_focus_prefers_goal_heading_over_status_metadata(self) -> None:
        (self.root / "GOALS.md").write_text(
            "## 当前重点\n"
            "- 状态：当前重点，但不是永久第一目标\n\n"
            "### 恢复可持续的生活节奏\n"
            "- 阶段：01\n",
            encoding="utf-8",
        )
        result = build_dashboard(self.root, today=date(2026, 1, 12))
        self.assertEqual(result["today"]["focus"]["title"], "恢复可持续的生活节奏")

    def test_dashboard_projects_only_confirmed_auxiliary_goals(self) -> None:
        (self.root / "GOALS.md").write_text(
            "## 当前重点\n"
            "### 保持合成节奏\n\n"
            "## 辅助目标\n"
            "### 误放的候选方向\n"
            "- 状态：候选\n"
            "- 试行时间：2026-01-12 至 2026-01-18\n"
            "- 说明：不应进入当前项目\n"
            "- 当前实验：[候选计划](plans/synthetic-candidate.md)\n\n"
            "### 已经过期的辅助目标\n"
            "- 状态：辅助目标；一周试行\n"
            "- 试行时间：2025-12-01 至 2025-12-07\n"
            "- 说明：不应占用当前项目名额\n"
            "- 当前实验：[过期计划](plans/synthetic-expired.md)\n\n"
            "### 路径不符合契约的目标\n"
            "- 状态：辅助目标；一周试行\n"
            "- 试行时间：2026-01-12 至 2026-01-18\n"
            "- 说明：连续双点路径必须拒绝\n"
            "- 当前实验：[错误路径](plans/synthetic..unsafe.md)\n\n"
            "### 合成室内训练\n"
            "- 状态：辅助目标；一周试行\n"
            "- 试行时间：2026-01-12 至 2026-01-18\n"
            "- 说明：在不影响恢复的前提下尝试基础抗阻动作\n"
            "- 当前实验：[合成训练计划](plans/synthetic-training.md)\n\n"
            "### 合成 Agent 实操\n"
            "- 状态：辅助目标；一周试行\n"
            "- 试行时间：2026-01-12 至 2026-01-18\n"
            "- 说明：使用合成数据完成一个最小工作流\n"
            "- 当前实验：[合成实操计划](plans/synthetic-agent.md)\n\n"
            "## 候选目标\n"
            "### 不应展示的候选方向\n"
            "- 状态：候选\n",
            encoding="utf-8",
        )

        result = build_dashboard(self.root, today=date(2026, 1, 12))

        self.assertEqual(
            result["today"]["active_projects"],
            [
                {
                    "title": "合成室内训练",
                    "status": "辅助目标；一周试行",
                    "period": "2026-01-12 至 2026-01-18",
                    "summary": "在不影响恢复的前提下尝试基础抗阻动作",
                    "plan_path": "plans/synthetic-training.md",
                },
                {
                    "title": "合成 Agent 实操",
                    "status": "辅助目标；一周试行",
                    "period": "2026-01-12 至 2026-01-18",
                    "summary": "使用合成数据完成一个最小工作流",
                    "plan_path": "plans/synthetic-agent.md",
                },
            ],
        )
        self.assertNotIn("不应展示", json.dumps(result, ensure_ascii=False))

    def test_bad_and_duplicate_sources_fail_closed(self) -> None:
        path = self.root / "records/daily-checkins.jsonl"
        path.write_text("{bad json}\n", encoding="utf-8")
        with self.assertRaises(ReadModelError):
            build_dashboard(self.root)
        path.write_text(
            "\n".join(json.dumps(daily("2026-01-12")) for _ in range(2)) + "\n",
            encoding="utf-8",
        )
        with self.assertRaises(ReadModelError):
            build_dashboard(self.root)

    def test_symlink_source_fails_closed(self) -> None:
        path = self.root / "journal/index.jsonl"
        target = self.root / "synthetic-index"
        target.write_text("", encoding="utf-8")
        path.unlink()
        path.symlink_to(target)
        with self.assertRaises(ReadModelError):
            build_dashboard(self.root)

    def test_non_loopback_bind_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            create_server(root=self.root, host="0.0.0.0", port=0)

    def test_health_session_dashboard_and_host_policy(self) -> None:
        server = create_server(
            root=self.root,
            port=0,
            icloud_status="writable",
            automation_status="ready",
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = http.client.HTTPConnection(*server.server_address)
            connection.request("GET", "/api/v1/health", headers={"Host": f"127.0.0.1:{server.server_port}"})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read())["status"], "ready")
            self.assertIn("default-src 'self'", response.getheader("Content-Security-Policy"))

            connection.request("GET", "/api/v1/session", headers={"Host": f"127.0.0.1:{server.server_port}"})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertIn("SameSite=Strict", response.getheader("Set-Cookie"))
            cookie = response.getheader("Set-Cookie").split(";", 1)[0]
            response.read()

            connection.request("GET", "/api/v1/dashboard", headers={"Host": f"127.0.0.1:{server.server_port}"})
            response = connection.getresponse()
            self.assertEqual(response.status, 403)
            response.read()

            connection.request(
                "GET",
                "/api/v1/dashboard",
                headers={"Host": f"127.0.0.1:{server.server_port}", "Cookie": cookie},
            )
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            dashboard = json.loads(response.read())
            self.assertEqual(dashboard["date"], date.today().isoformat())
            self.assertEqual(dashboard["system"]["icloud"], "writable")
            self.assertEqual(dashboard["system"]["automation"], "ready")

            connection.request("GET", "/api/v1/dashboard", headers={"Host": "malicious.example"})
            response = connection.getresponse()
            self.assertEqual(response.status, 400)
            self.assertNotIn("合成散步", response.read().decode())
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
