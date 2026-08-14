#!/usr/bin/env python3
"""life_assistant_status.py 的独立标准库测试。"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path


SCRIPT = Path(__file__).with_name("life_assistant_status.py")
STATUS_SPEC = importlib.util.spec_from_file_location("life_assistant_status", SCRIPT)
assert STATUS_SPEC and STATUS_SPEC.loader
STATUS_MODULE = importlib.util.module_from_spec(STATUS_SPEC)
STATUS_SPEC.loader.exec_module(STATUS_MODULE)
VALIDATE_SCRIPT = Path(__file__).with_name("validate_project.py")
VALIDATE_SPEC = importlib.util.spec_from_file_location("validate_project", VALIDATE_SCRIPT)
assert VALIDATE_SPEC and VALIDATE_SPEC.loader
VALIDATE_MODULE = importlib.util.module_from_spec(VALIDATE_SPEC)
sys.path.insert(0, str(SCRIPT.parent))
VALIDATE_SPEC.loader.exec_module(VALIDATE_MODULE)
TODAY = "2026-08-01"
PROJECT_ID_SENTINEL = "project-id-must-never-appear"
RAW_SENTINEL = "PRIVATE-JOURNAL-RAW-MUST-NEVER-APPEAR"
AUTOMATION_PROMPT_SENTINEL = "PRIVATE-CANONICAL-PROMPT-MUST-NEVER-APPEAR"
MISMATCHED_PROMPT_SENTINEL = "PRIVATE-RUNTIME-PROMPT-MUST-NEVER-APPEAR"
SITE_SOURCE_SENTINEL = "PRIVATE-SITE-SOURCE-MUST-NEVER-APPEAR"
CANONICAL_PROMPT = (
    "用户回答后运行 tools/daily_checkin.py upsert，再运行 "
    "tools/update_life_plan_journal.mjs。周回顾使用周一至周日自然周。\n"
    f"{AUTOMATION_PROMPT_SENTINEL}\n"
)
WORKBOOK = "outputs/019fb832-be4f-74f1-add5-58cb6fb6fc09/生活计划表.xlsx"


class LifeAssistantStatusTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="life-assistant-status-test-")
        self.root = Path(self.temporary.name) / "project"
        self.automation_dir = Path(self.temporary.name) / "automations"
        self.automation_db = Path(self.temporary.name) / "sqlite" / "codex-dev.db"
        self.root.mkdir(parents=True)
        self._create_core_files()
        self._create_runtime_automation()
        self._create_runtime_database()
        self._create_backup()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _write(self, relative: str, content: str | bytes = "placeholder\n") -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content, encoding="utf-8")
        return path

    def _create_core_files(self) -> None:
        for relative in STATUS_MODULE.CORE_FILES:
            self._write(relative)
        self._write(
            "GOALS.md",
            "\n".join(
                [
                    "# 目标",
                    "- 下次复盘：2026-08-14",
                    "- 准备度复盘：2026-08-14；后续由用户决定",
                    "- 节奏复盘：2026-08-31；后续由用户决定",
                    "",
                ]
            ),
        )
        self._write(
            "automations/生活状态回访.md",
            "# 回访\n\n- 生效范围：2026-08-02 至 2026-08-14；\n- 时间：每天 11:15，Asia/Shanghai；\n",
        )
        self._write_review_policy()
        prompt_path = self._write(
            "automations/生活状态回访.prompt.txt",
            CANONICAL_PROMPT,
        )
        self._write_registry(prompt_sha256=self._digest(prompt_path.read_bytes()))
        self._write(WORKBOOK, b"test workbook")
        self._write_product_surfaces()

    def _write_review_policy(self, **changes: object) -> Path:
        policy: dict[str, object] = {
            "schema_version": 1,
            "timezone": "Asia/Shanghai",
            "trial_weekly_start": "2026-08-02",
            "trial_weekly_end": "2026-08-14",
            "long_term_cadence": "pending_user_choice",
            "long_term_effective_from": None,
            "decided_on": None,
        }
        policy.update(changes)
        return self._write(
            STATUS_MODULE.JOURNAL_REVIEW_POLICY,
            json.dumps(policy, ensure_ascii=False, indent=2) + "\n",
        )

    def _write_registry(self, **changes: object) -> Path:
        contract: dict[str, object] = {
            "key": "life-checkin",
            "name": "生活状态回访与周复盘",
            "kind": "heartbeat",
            "desired_status": "ACTIVE",
            "timezone": "Asia/Shanghai",
            "local_time": "11:15",
            "start": "2026-08-02",
            "end": "2026-08-14",
            "runtime_time_basis": "utc",
            "max_scheduler_jitter_seconds": 300,
            "prompt_file": "automations/生活状态回访.prompt.txt",
            "prompt_sha256": "0" * 64,
        }
        contract.update(changes)
        return self._write(
            "automations/registry.json",
            json.dumps(
                {"schema_version": 1, "automations": [contract]},
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
        )

    def _create_runtime_automation(
        self,
        *,
        directory_name: str = "automation-2",
        status: str = "ACTIVE",
        rrule: str = "RRULE:FREQ=DAILY;BYHOUR=3;BYMINUTE=15;UNTIL=20260814T031500Z",
        prompt: str | None = None,
        name: str = "生活状态回访与周复盘",
    ) -> Path:
        target = self.automation_dir / directory_name / "automation.toml"
        target.parent.mkdir(parents=True, exist_ok=True)
        runtime_prompt = (
            (self.root / "automations/生活状态回访.prompt.txt")
            .read_text(encoding="utf-8")
            .rstrip("\r\n")
            if prompt is None
            else prompt
        )
        target.write_text(
            "\n".join(
                [
                    'version = 1',
                    'id = "automation-2"',
                    'kind = "heartbeat"',
                    f"name = {json.dumps(name, ensure_ascii=False)}",
                    f"prompt = {json.dumps(runtime_prompt, ensure_ascii=False)}",
                    f"status = {json.dumps(status)}",
                    f"rrule = {json.dumps(rrule)}",
                    'target_thread_id = "test-thread"',
                    "",
                ]
            ),
            encoding="utf-8",
        )
        return target

    def _create_runtime_database(
        self,
        *,
        next_utc: str = "2026-08-02T03:15:18+00:00",
        status: str = "ACTIVE",
    ) -> None:
        self.automation_db.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.automation_db)
        try:
            connection.execute("DROP TABLE IF EXISTS automations")
            connection.execute(
                "CREATE TABLE automations (id TEXT PRIMARY KEY, next_run_at INTEGER, status TEXT)"
            )
            timestamp_ms = int(datetime.fromisoformat(next_utc).astimezone(timezone.utc).timestamp() * 1000)
            connection.execute(
                "INSERT INTO automations (id, next_run_at, status) VALUES (?, ?, ?)",
                ("automation-2", timestamp_ms, status),
            )
            connection.commit()
        finally:
            connection.close()

    @staticmethod
    def _digest(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def _canonical_json_bytes(value: object) -> bytes:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")

    def _insight_history(
        self,
        *,
        candidate_hex: str,
        final_status: str,
        private_text: str,
    ) -> list[dict[str, object]]:
        order = ("pending", "awaiting_proposal", "proposed", "applied")
        final_index = order.index(final_status)
        candidate_id = "insight-" + candidate_hex * 64
        base: dict[str, object] = {
            "candidate_id": candidate_id,
            "kind": "candidate_memory",
            "review_file": "reviews/2026/2026-W31.md",
            "review_sha256": "f" * 64,
            "summary": f"private summary {candidate_hex}",
            "status": "pending",
            "decided_at": None,
            "proposal_target": None,
            "proposal_text": None,
            "proposal_sha256": None,
            "proposed_at": None,
            "applied_at": None,
            "recorded_at": "2026-08-01T04:00:00+00:00",
            "revision": 1,
        }
        history = [dict(base)]
        if final_index >= 1:
            decided_at = "2026-08-01T04:01:00+00:00"
            accepted = {
                **history[-1],
                "status": "awaiting_proposal",
                "decided_at": decided_at,
                "recorded_at": decided_at,
                "revision": 2,
            }
            history.append(accepted)
        if final_index >= 2:
            proposed_at = "2026-08-01T04:02:00+00:00"
            proposed = {
                **history[-1],
                "status": "proposed",
                "proposal_target": "USER.md",
                "proposal_text": private_text,
                "proposal_sha256": self._digest(private_text.encode("utf-8")),
                "proposed_at": proposed_at,
                "recorded_at": proposed_at,
                "revision": 3,
            }
            history.append(proposed)
        if final_index >= 3:
            applied_at = "2026-08-01T04:03:00+00:00"
            applied = {
                **history[-1],
                "status": "applied",
                "applied_at": applied_at,
                "recorded_at": applied_at,
                "revision": 4,
            }
            history.append(applied)
        return history

    def _phase_action_record(
        self,
        *,
        category: str,
        desired_value: object,
        state: str,
        source_hex: str,
    ) -> dict[str, object]:
        approval_by_category = {
            "goal_intent": "exact_change",
            "journal_cadence": "exact_change",
            "checkin_cadence": "schedule_details",
            "next_track": "exact_change",
            "career_timing": "schedule_details",
            "fitness_conversation": "none",
        }
        source_record_etag = source_hex * 64
        identity = {
            "review_date": "2026-08-14",
            "source_record_etag": source_record_etag,
            "category": category,
            "desired_value": desired_value,
        }
        record: dict[str, object] = {
            "schema_version": 1,
            "action_id": "phase-action-"
            + self._digest(self._canonical_json_bytes(identity)),
            "review_date": "2026-08-14",
            "source_record_etag": source_record_etag,
            "category": category,
            "desired_value": desired_value,
            "approval_requirement": approval_by_category[category],
            "state": state,
            "failure_code": "execution_failed" if state == "failed" else None,
            "revision": 1 if state == "pending" else 2,
            "created_at": "2026-08-14T04:00:00Z",
            "updated_at": "2026-08-14T04:01:00Z",
        }
        record["etag"] = self._digest(self._canonical_json_bytes(record))
        return record

    def _write_product_surfaces(self, **changes: object) -> Path:
        payload: dict[str, object] = {
            "schema_version": 1,
            "truth_source": "icloud-private-workspace",
            "surfaces": [
                {
                    "id": "life-console",
                    "lifecycle_state": "active",
                    "role": "primary",
                    "sync_cadence": "on_demand",
                    "writeback": "local-tools-only",
                },
                {
                    "id": "google-sheets",
                    "lifecycle_state": "derived",
                    "role": "secondary",
                    "sync_cadence": "on_demand",
                    "writeback": "none",
                },
                {
                    "id": "xlsx",
                    "lifecycle_state": "derived",
                    "role": "secondary",
                    "sync_cadence": "on_demand",
                    "writeback": "none",
                },
                {
                    "id": "life-dashboard",
                    "lifecycle_state": "archived",
                    "role": "retired",
                    "sync_cadence": "none",
                    "writeback": "none",
                    "deployment_policy": "no_new_deployments",
                    "live_instance_policy": "preserve_owner_only",
                },
            ],
        }
        payload.update(changes)
        return self._write(
            STATUS_MODULE.SURFACES_PATH,
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        )

    def _create_backup(
        self,
        *,
        corrupt: bool = False,
        revision: str | None = None,
        extra_file: bool = False,
    ) -> Path:
        backup_dir = self.root / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        stem = f"生活助手-完整备份-{TODAY}"
        if revision:
            stem += f"-{revision}"
        archive_path = backup_dir / f"{stem}.zip"
        manifest_path = backup_dir / f"{stem}.files.sha256"
        checksum_path = backup_dir / f"{stem}.zip.sha256"
        project_files = sorted(
            path
            for path in self.root.rglob("*")
            if path.is_file()
            and "backups" not in path.relative_to(self.root).parts
            and path.name != "STATUS.md"
            and path.relative_to(self.root) != STATUS_MODULE.LEGACY_GOVERNANCE_LINK
        )
        manifest_path.write_text(
            "".join(
                f"{self._digest(path.read_bytes())}  {path.relative_to(self.root).as_posix()}\n"
                for path in project_files
            ),
            encoding="utf-8",
        )
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in project_files:
                archive.write(
                    path,
                    arcname=f"codex-生活助手/{path.relative_to(self.root).as_posix()}",
                )
            if extra_file:
                archive.writestr("codex-生活助手/unlisted.txt", b"not in manifest")
        checksum = self._digest(archive_path.read_bytes())
        if corrupt:
            checksum = "0" * 64
        checksum_path.write_text(f"{checksum}  {archive_path.name}\n", encoding="utf-8")
        return archive_path

    def _run(
        self,
        *arguments: str,
        expected_code: int = 0,
        today: str = TODAY,
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--root",
                str(self.root),
                "--today",
                today,
                "--automation-dir",
                str(self.automation_dir),
                "--automation-db",
                str(self.automation_db),
                *arguments,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            result.returncode,
            expected_code,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )
        return result

    def _write_entry(self, *, entry_date: str, weekly: list[str] | None = None, monthly: list[str] | None = None) -> Path:
        identifier = "20260701-2200-0123456789ab"
        source = self._write(
            "journal/entries/2026/2026-07.md",
            f"# 日记\n\n## {entry_date} 22:00｜标题\n\n"
            f"<!-- journal-id: {identifier} -->\n\n{RAW_SENTINEL}\n",
        )
        record = {
            "id": identifier,
            "date": entry_date,
            "time": "22:00",
            "time_precision": "exact",
            "title": "这个标题不应出现在报告",
            "summary": "这个摘要不应出现在报告",
            "facts": [],
            "feelings": [],
            "people": [],
            "places": [],
            "themes": [],
            "tags": [],
            "planning_clues": [],
            "inferences": [],
            "source": "explicit",
            "privacy": "local-only",
            "file": "entries/2026/2026-07.md",
            "status": "active",
            "weekly_reviews": weekly or [],
            "monthly_reviews": monthly or [],
            "amendments": [],
            "invalidated_reviews": [],
            "recorded_at": "2026-07-01T22:05:00+08:00",
        }
        index = self._write("journal/index.jsonl", json.dumps(record, ensure_ascii=False) + "\n")
        self.assertTrue(source.exists())
        return index

    def _mark_workbook_synced_after(self, source: Path) -> None:
        self.assertTrue(source.exists())
        self._write_workbook_sync_receipt()

    def _write_workbook_sync_receipt(self, **changes: object) -> Path:
        sources: dict[str, dict[str, object]] = {}
        for key, (relative, path_category) in STATUS_MODULE.WORKBOOK_SYNC_SOURCES.items():
            source = self.root / relative
            present = source.is_file() and not source.is_symlink()
            sources[key] = {
                "path_category": path_category,
                "present": present,
                "sha256": self._digest(source.read_bytes()) if present else None,
            }
        receipt: dict[str, object] = {
            "schema_version": 1,
            "workbook_sha256": self._digest((self.root / WORKBOOK).read_bytes()),
            "sources": sources,
            "synced_at": "2026-08-01T04:00:00Z",
        }
        receipt.update(changes)
        return self._write(
            STATUS_MODULE.WORKBOOK_SYNC_STATE,
            json.dumps(receipt, ensure_ascii=False, indent=2) + "\n",
        )

    def _write_daily_checkin(self, note_summary: str = "private summary") -> Path:
        record = {
            "schema_version": 2,
            "key": "daily-checkin:2026-08-01",
            "date": "2026-08-01",
            "sleep_time": None,
            "wake_time": None,
            "out_of_bed_time": None,
            "ratings": {
                "sleep_quality": 3,
                "energy": None,
                "mood": None,
                "life_feeling": None,
            },
            "awake_in_bed": None,
            "anchors": {
                "wake": None,
                "body_light": None,
                "life_action": None,
                "wind_down": None,
            },
            "note_summary": note_summary,
            "revision": 1,
            "created_at": "2026-08-01T03:20:00Z",
            "updated_at": "2026-08-01T03:20:00Z",
        }
        return self._write(
            STATUS_MODULE.DAILY_CHECKINS,
            json.dumps(record, ensure_ascii=False) + "\n",
        )

    def test_healthy_empty_workspace_passes_and_writes_markdown_atomically(self) -> None:
        result = self._run("--json", "--write", "STATUS.md")
        report = json.loads(result.stdout)
        self.assertEqual(report["overall"], "PASS")
        self.assertEqual(report["sections"]["journal"]["metrics"]["active"], 0)
        self.assertTrue(
            report["sections"]["journal"]["metrics"]["insight_ledger_valid"]
        )
        self.assertEqual(
            report["sections"]["journal"]["metrics"]["insight_pending"], 0
        )
        self.assertEqual(
            report["sections"]["journal"]["metrics"]["insight_awaiting_proposal"],
            0,
        )
        self.assertTrue(
            report["sections"]["journal"]["metrics"]["phase_actions_valid"]
        )
        self.assertEqual(
            report["sections"]["journal"]["metrics"]["phase_actions"], 0
        )
        self.assertTrue(report["sections"]["journal"]["metrics"]["policy_valid"])
        self.assertEqual(
            report["sections"]["journal"]["metrics"]["effective_review_cadence"],
            "pending_user_choice",
        )
        status_text = (self.root / "STATUS.md").read_text(encoding="utf-8")
        self.assertIn("总体：**PASS**", status_text)
        self.assertNotIn(PROJECT_ID_SENTINEL, result.stdout + status_text)
        self.assertTrue(report["sections"]["automation"]["metrics"]["local_runtime_verified"])
        self.assertEqual(report["sections"]["automation"]["metrics"]["runtime_state"], "aligned")
        self.assertTrue(report["sections"]["automation"]["metrics"]["runtime_database_verified"])
        self.assertIn("2026-08-02T11:15:18+08:00", report["sections"]["automation"]["metrics"]["next_run_local"])
        self.assertTrue(report["sections"]["automation"]["metrics"]["contract_verified"])
        self.assertTrue(report["sections"]["automation"]["metrics"]["prompt_sha256_verified"])
        self.assertEqual(report["sections"]["site"]["status"], "PASS")
        self.assertTrue(report["sections"]["site"]["metrics"]["contract_verified"])
        self.assertEqual(report["sections"]["site"]["metrics"]["primary_surface"], "life-console")
        self.assertEqual(report["sections"]["site"]["metrics"]["life_dashboard_state"], "archived")
        self.assertEqual(report["sections"]["site"]["metrics"]["google_sync_cadence"], "on_demand")
        self.assertEqual(report["sections"]["site"]["metrics"]["xlsx_sync_cadence"], "on_demand")
        self.assertFalse(report["sections"]["site"]["metrics"]["new_deployments_allowed"])
        self.assertFalse(report["sections"]["site"]["metrics"]["online_verified"])
        self.assertNotIn(AUTOMATION_PROMPT_SENTINEL, result.stdout + status_text)
        self.assertNotIn("automation-2", result.stdout + status_text)
        self.assertNotIn("test-thread", result.stdout + status_text)

    def test_missing_product_surface_contract_fails(self) -> None:
        (self.root / STATUS_MODULE.SURFACES_PATH).unlink()

        result = self._run("--json", expected_code=2)
        site = json.loads(result.stdout)["sections"]["site"]
        self.assertEqual(site["status"], "FAIL")
        self.assertFalse(site["metrics"]["contract_verified"])
        self.assertNotIn(PROJECT_ID_SENTINEL, result.stdout + result.stderr)

    def test_product_surface_contract_rejects_reactivation_and_extra_fields(self) -> None:
        valid_path = self._write_product_surfaces()
        valid = json.loads(valid_path.read_text(encoding="utf-8"))
        reactivated = json.loads(json.dumps(valid))
        reactivated["surfaces"][-1]["lifecycle_state"] = "active"
        invalid_payloads = [
            {**valid, "schema_version": 2},
            {**valid, "unexpected": SITE_SOURCE_SENTINEL},
            {**valid, "truth_source": "browser"},
            reactivated,
        ]
        for position, payload in enumerate(invalid_payloads):
            with self.subTest(position=position):
                self._write(
                    STATUS_MODULE.SURFACES_PATH,
                    json.dumps(payload, ensure_ascii=False),
                )
                result = self._run("--json", expected_code=2)
                site = json.loads(result.stdout)["sections"]["site"]
                self.assertEqual(site["status"], "FAIL")
                self.assertFalse(site["metrics"]["contract_verified"])
                self.assertNotIn(SITE_SOURCE_SENTINEL, result.stdout + result.stderr)
                self.assertNotIn(PROJECT_ID_SENTINEL, result.stdout + result.stderr)

    def test_archived_surface_check_does_not_read_legacy_hosting_metadata(self) -> None:
        self._write("web/life-dashboard/.openai/hosting.json", PROJECT_ID_SENTINEL)
        result = self._run("--json")
        site = json.loads(result.stdout)["sections"]["site"]
        self.assertEqual(site["status"], "PASS")
        self.assertEqual(site["metrics"]["life_dashboard_state"], "archived")
        self.assertNotIn(PROJECT_ID_SENTINEL, result.stdout + result.stderr)

    def test_portable_contract_covers_daily_upsert_and_natural_week(self) -> None:
        project_root = SCRIPT.parent.parent
        registry_path = project_root / "automations/registry.json"
        if not registry_path.is_file():
            # automations/ 是 iCloud-only 私有契约，不在 git 中；CI 仓库没有该文件时优雅跳过
            self.skipTest("本机 automations/ 私有契约不在 git 中，CI 跳过本地契约测试")
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        contract = registry["automations"][0]
        prompt_bytes = (project_root / contract["prompt_file"]).read_bytes()
        prompt = prompt_bytes.decode("utf-8")
        self.assertEqual(self._digest(prompt_bytes), contract["prompt_sha256"])
        self.assertIn("tools/daily_checkin.py week-summary --week-start", prompt)
        self.assertIn("source_set_etag", prompt)
        self.assertIn("journal_manager.py review-plan --type weekly", prompt)
        self.assertIn("weekly_review.py upsert --week-start", prompt)
        self.assertIn("周一至周日", prompt)
        self.assertIn("同一自然周只主动询问一次", prompt)
        self.assertIn("不想答、这周跳过", prompt)
        self.assertIn("日记原文、健康数据和敏感摘要不得发布", prompt)

    def test_missing_runtime_automation_needs_attention(self) -> None:
        shutil.rmtree(self.automation_dir)
        result = self._run("--json")
        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "ATTENTION")
        self.assertEqual(automation["metrics"]["runtime_state"], "missing")
        self.assertFalse(automation["metrics"]["local_runtime_verified"])

    def test_duplicate_runtime_automation_needs_attention(self) -> None:
        self._create_runtime_automation(directory_name="duplicate")
        result = self._run("--json")
        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "ATTENTION")
        self.assertEqual(automation["metrics"]["runtime_state"], "duplicate")
        self.assertEqual(automation["metrics"]["runtime_matches"], 2)

    def test_misaligned_runtime_automation_needs_attention(self) -> None:
        self._create_runtime_automation(prompt=MISMATCHED_PROMPT_SENTINEL)
        result = self._run("--json")
        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "ATTENTION")
        self.assertEqual(automation["metrics"]["runtime_state"], "misaligned")
        self.assertNotIn(AUTOMATION_PROMPT_SENTINEL, result.stdout)
        self.assertNotIn(MISMATCHED_PROMPT_SENTINEL, result.stdout)
        self.assertNotIn("test-thread", result.stdout)

    def test_only_trailing_prompt_newlines_are_normalized(self) -> None:
        self._create_runtime_automation(prompt=CANONICAL_PROMPT + "\r\n")
        result = self._run("--json")
        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "PASS")
        self.assertEqual(automation["metrics"]["runtime_state"], "aligned")

    def test_non_newline_prompt_difference_is_misaligned(self) -> None:
        self._create_runtime_automation(prompt=CANONICAL_PROMPT.rstrip("\r\n") + " ")
        result = self._run("--json")
        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "ATTENTION")
        self.assertEqual(automation["metrics"]["runtime_state"], "misaligned")

    def test_registry_name_is_runtime_source_of_truth(self) -> None:
        prompt_hash = self._digest(
            (self.root / "automations/生活状态回访.prompt.txt").read_bytes()
        )
        self._write_registry(name="迁移后的生活回访", prompt_sha256=prompt_hash)
        self._create_runtime_automation(name="迁移后的生活回访")
        result = self._run("--json")
        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "PASS")
        self.assertEqual(automation["metrics"]["runtime_state"], "aligned")

    def test_weekly_monday_contract_aligns_runtime_and_scheduler(self) -> None:
        prompt_hash = self._digest(
            (self.root / "automations/生活状态回访.prompt.txt").read_bytes()
        )
        self._write_registry(
            name="每周生活回顾",
            start="2026-08-17",
            end="2099-12-31",
            frequency="weekly",
            weekday="MO",
            prompt_sha256=prompt_hash,
        )
        self._create_runtime_automation(
            name="每周生活回顾",
            rrule="RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=3;BYMINUTE=15",
        )
        self._create_runtime_database(next_utc="2026-08-17T03:15:00+00:00")

        result = self._run("--json", today="2026-08-14")

        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "PASS")
        self.assertEqual(automation["metrics"]["runtime_state"], "aligned")
        self.assertTrue(automation["metrics"]["runtime_database_verified"])

    def test_weekly_contract_rejects_wrong_runtime_weekday(self) -> None:
        prompt_hash = self._digest(
            (self.root / "automations/生活状态回访.prompt.txt").read_bytes()
        )
        self._write_registry(
            name="每周生活回顾",
            start="2026-08-17",
            end="2099-12-31",
            frequency="weekly",
            weekday="MO",
            prompt_sha256=prompt_hash,
        )
        self._create_runtime_automation(
            name="每周生活回顾",
            rrule="RRULE:FREQ=WEEKLY;BYDAY=TU;BYHOUR=3;BYMINUTE=15",
        )

        result = self._run("--json", today="2026-08-14")

        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "ATTENTION")
        self.assertEqual(automation["metrics"]["runtime_state"], "misaligned")

    def test_project_validator_accepts_weekly_prompt_profile(self) -> None:
        prompt = "\n".join(
            [
                "上一完整自然周固定为周一至周日。",
                "运行 journal_manager.py review-plan --type weekly 并原样使用 source_set_etag。",
                "运行 daily_checkin.py week-summary 和 tools/weekly_review.py upsert。",
                "周复盘不得写入每日状态或 --note-summary。",
                "Google 表格和 XLSX 不自动同步。",
            ]
        )
        prompt_path = self._write("automations/生活状态回访.prompt.txt", prompt)
        self._write_registry(
            start="2026-08-17",
            end="2099-12-31",
            frequency="weekly",
            weekday="MO",
            prompt_sha256=self._digest(prompt_path.read_bytes()),
        )
        previous_root = VALIDATE_MODULE.ROOT
        VALIDATE_MODULE.ROOT = self.root
        try:
            errors: list[str] = []
            VALIDATE_MODULE.validate_automation_registry(errors)
        finally:
            VALIDATE_MODULE.ROOT = previous_root

        self.assertEqual(errors, [])

    def test_weekly_policy_accepts_first_matching_weekday_after_effective_date(self) -> None:
        prompt_hash = self._digest(
            (self.root / "automations/生活状态回访.prompt.txt").read_bytes()
        )
        self._write_registry(
            start="2026-08-17",
            end="2099-12-31",
            frequency="weekly",
            weekday="MO",
            prompt_sha256=prompt_hash,
        )
        self._write_review_policy(
            long_term_cadence="weekly",
            long_term_effective_from="2026-08-15",
            decided_on="2026-08-14",
        )
        previous_root = VALIDATE_MODULE.ROOT
        VALIDATE_MODULE.ROOT = self.root
        try:
            errors: list[str] = []
            VALIDATE_MODULE.validate_journal_review_policy(errors)
        finally:
            VALIDATE_MODULE.ROOT = previous_root

        self.assertEqual(errors, [])

    def test_tampered_canonical_prompt_fails_hash_without_leak(self) -> None:
        self._write(
            "automations/生活状态回访.prompt.txt",
            CANONICAL_PROMPT + MISMATCHED_PROMPT_SENTINEL,
        )
        result = self._run("--json", expected_code=2)
        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "FAIL")
        self.assertEqual(automation["metrics"]["state"], "contract_invalid")
        self.assertFalse(automation["metrics"]["prompt_sha256_verified"])
        self.assertNotIn(AUTOMATION_PROMPT_SENTINEL, result.stdout)
        self.assertNotIn(MISMATCHED_PROMPT_SENTINEL, result.stdout)

    def test_registry_rejects_unknown_schema_field(self) -> None:
        registry = json.loads(
            (self.root / "automations/registry.json").read_text(encoding="utf-8")
        )
        registry["automations"][0]["unexpected"] = True
        self._write("automations/registry.json", json.dumps(registry, ensure_ascii=False))
        result = self._run("--json", expected_code=2)
        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "FAIL")
        self.assertFalse(automation["metrics"]["contract_verified"])

    def test_registry_rejects_duplicate_contract_keys(self) -> None:
        registry_path = self.root / "automations/registry.json"
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        registry["automations"].append(dict(registry["automations"][0]))
        self._write("automations/registry.json", json.dumps(registry, ensure_ascii=False))
        result = self._run("--json", expected_code=2)
        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "FAIL")

    def test_registry_allows_additional_unique_automation_contracts(self) -> None:
        registry_path = self.root / "automations/registry.json"
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        additional = dict(registry["automations"][0])
        additional["key"] = "career-planner-week-one"
        additional["name"] = "职业规划首周咨询"
        registry["automations"].append(additional)
        self._write("automations/registry.json", json.dumps(registry, ensure_ascii=False))

        result = self._run("--json")

        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "PASS")
        self.assertEqual(automation["metrics"]["runtime_state"], "aligned")

    def test_registry_rejects_prompt_path_escape_without_reading_it(self) -> None:
        outside = self.root.parent / "outside-prompt.txt"
        outside.write_text(MISMATCHED_PROMPT_SENTINEL, encoding="utf-8")
        self._write_registry(
            prompt_file="automations/../../outside-prompt.txt",
            prompt_sha256=self._digest(outside.read_bytes()),
        )
        result = self._run("--json", expected_code=2)
        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "FAIL")
        self.assertNotIn(MISMATCHED_PROMPT_SENTINEL, result.stdout)

    def test_registry_jitter_limit_controls_scheduler_verification(self) -> None:
        prompt_hash = self._digest(
            (self.root / "automations/生活状态回访.prompt.txt").read_bytes()
        )
        self._write_registry(
            max_scheduler_jitter_seconds=10,
            prompt_sha256=prompt_hash,
        )
        result = self._run("--json")
        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "ATTENTION")
        self.assertEqual(automation["metrics"]["runtime_state"], "scheduler_misaligned")

    def test_scheduler_next_run_in_wrong_timezone_needs_attention(self) -> None:
        self._create_runtime_database(next_utc="2026-08-02T11:15:18+00:00")
        result = self._run("--json")
        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "ATTENTION")
        self.assertEqual(automation["metrics"]["runtime_state"], "scheduler_misaligned")
        self.assertFalse(automation["metrics"]["runtime_database_verified"])

    def test_runtime_rrule_with_uncontracted_constraint_is_misaligned(self) -> None:
        self._create_runtime_automation(
            rrule=(
                "RRULE:FREQ=DAILY;BYHOUR=3;BYMINUTE=15;"
                "UNTIL=20260814T031500Z;INTERVAL=2"
            )
        )
        result = self._run("--json")
        automation = json.loads(result.stdout)["sections"]["automation"]
        self.assertEqual(automation["status"], "ATTENTION")
        self.assertEqual(automation["metrics"]["runtime_state"], "misaligned")

    def test_malformed_journal_index_is_fail(self) -> None:
        self._write("journal/index.jsonl", "{not-json\n")
        result = self._run("--json", expected_code=2)
        report = json.loads(result.stdout)
        self.assertEqual(report["overall"], "FAIL")
        self.assertEqual(report["sections"]["journal"]["status"], "FAIL")
        self.assertIn("第 1 行", result.stdout)

    def test_trial_window_makes_only_weekly_due_actionable(self) -> None:
        index = self._write_entry(entry_date="2026-07-01")
        self._mark_workbook_synced_after(index)

        result = self._run("--json", today="2026-08-10")
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertTrue(journal["metrics"]["policy_valid"])
        self.assertEqual(journal["metrics"]["effective_review_cadence"], "trial_weekly")
        self.assertEqual(journal["metrics"]["weekly_due"], 1)
        self.assertEqual(journal["metrics"]["monthly_due"], 1)
        self.assertEqual(journal["metrics"]["actionable_weekly_due"], 1)
        self.assertEqual(journal["metrics"]["actionable_monthly_due"], 0)
        self.assertEqual(journal["status"], "ATTENTION")
        self.assertNotIn("月回顾", "".join(journal["messages"]))

    def test_pending_choice_after_trial_keeps_raw_due_without_attention(self) -> None:
        index = self._write_entry(entry_date="2026-07-01")
        self._mark_workbook_synced_after(index)

        result = self._run("--json", today="2026-09-01")
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertEqual(journal["metrics"]["effective_review_cadence"], "pending_user_choice")
        self.assertEqual(journal["metrics"]["weekly_due"], 1)
        self.assertEqual(journal["metrics"]["monthly_due"], 1)
        self.assertEqual(journal["metrics"]["actionable_weekly_due"], 0)
        self.assertEqual(journal["metrics"]["actionable_monthly_due"], 0)
        self.assertEqual(journal["status"], "PASS")
        self.assertNotIn("尚未纳入", "".join(journal["messages"]))

    def test_weekly_and_monthly_policies_are_mutually_exclusive(self) -> None:
        index = self._write_entry(entry_date="2026-07-01")
        self._mark_workbook_synced_after(index)
        cases = {
            "weekly": (1, 0),
            "monthly": (0, 1),
        }
        for cadence, expected in cases.items():
            with self.subTest(cadence=cadence):
                self._write_review_policy(
                    long_term_cadence=cadence,
                    long_term_effective_from="2026-08-15",
                    decided_on="2026-08-14",
                )
                result = self._run("--json", today="2026-09-01")
                journal = json.loads(result.stdout)["sections"]["journal"]
                self.assertEqual(journal["metrics"]["effective_review_cadence"], cadence)
                self.assertEqual(
                    journal["metrics"]["actionable_weekly_due"], expected[0]
                )
                self.assertEqual(
                    journal["metrics"]["actionable_monthly_due"], expected[1]
                )
                self.assertEqual(journal["status"], "ATTENTION")

    def test_on_demand_paused_and_not_yet_effective_do_not_create_due_attention(self) -> None:
        index = self._write_entry(entry_date="2026-07-01")
        self._mark_workbook_synced_after(index)
        cases = (
            ("on_demand", "2026-08-15", "on_demand"),
            ("paused", "2026-08-15", "paused"),
            ("weekly", "2026-09-02", "not_yet_effective"),
            ("monthly", "2026-09-02", "not_yet_effective"),
        )
        for cadence, effective_from, expected_effective in cases:
            with self.subTest(cadence=cadence, effective_from=effective_from):
                self._write_review_policy(
                    long_term_cadence=cadence,
                    long_term_effective_from=effective_from,
                    decided_on="2026-08-14",
                )
                result = self._run("--json", today="2026-09-01")
                journal = json.loads(result.stdout)["sections"]["journal"]
                self.assertEqual(
                    journal["metrics"]["effective_review_cadence"], expected_effective
                )
                self.assertEqual(journal["metrics"]["actionable_weekly_due"], 0)
                self.assertEqual(journal["metrics"]["actionable_monthly_due"], 0)
                self.assertEqual(journal["status"], "PASS")

    def test_review_policy_rejects_extra_invalid_and_inconsistent_dates(self) -> None:
        valid_path = self._write_review_policy()
        valid = json.loads(valid_path.read_text(encoding="utf-8"))
        invalid_payloads = [
            {**valid, "unexpected": RAW_SENTINEL},
            {**valid, "schema_version": True},
            {**valid, "timezone": "UTC"},
            {**valid, "trial_weekly_start": "2026-08-03"},
            {**valid, "long_term_cadence": "daily"},
            {
                **valid,
                "long_term_effective_from": "2026-08-15",
                "decided_on": "2026-08-14",
            },
            {
                **valid,
                "long_term_cadence": "weekly",
                "long_term_effective_from": None,
                "decided_on": None,
            },
            {
                **valid,
                "long_term_cadence": "monthly",
                "long_term_effective_from": "2026-02-30",
                "decided_on": "2026-08-14",
            },
            {
                **valid,
                "long_term_cadence": "on_demand",
                "long_term_effective_from": "2026-08-15",
                "decided_on": "not-a-date",
            },
            {
                **valid,
                "long_term_cadence": "weekly",
                "long_term_effective_from": "2026-08-15",
                "decided_on": "2026-08-16",
            },
        ]
        for position, payload in enumerate(invalid_payloads):
            with self.subTest(position=position):
                self._write(
                    STATUS_MODULE.JOURNAL_REVIEW_POLICY,
                    json.dumps(payload, ensure_ascii=False) + "\n",
                )
                result = self._run("--json", expected_code=2)
                journal = json.loads(result.stdout)["sections"]["journal"]
                self.assertEqual(journal["status"], "FAIL")
                self.assertFalse(journal["metrics"]["policy_valid"])
                self.assertEqual(
                    journal["metrics"]["effective_review_cadence"], "invalid"
                )
                self.assertEqual(journal["metrics"]["actionable_weekly_due"], 0)
                self.assertEqual(journal["metrics"]["actionable_monthly_due"], 0)
                self.assertNotIn(RAW_SENTINEL, result.stdout + result.stderr)

    def test_review_policy_rejects_duplicate_keys_and_symlinks(self) -> None:
        policy_path = self.root / STATUS_MODULE.JOURNAL_REVIEW_POLICY
        policy_path.write_text(
            "{\"schema_version\":1,\"schema_version\":1}",
            encoding="utf-8",
        )
        duplicate_result = self._run("--json", expected_code=2)
        duplicate_journal = json.loads(duplicate_result.stdout)["sections"]["journal"]
        self.assertFalse(duplicate_journal["metrics"]["policy_valid"])

        policy_path.unlink()
        outside = self.root.parent / "outside-review-policy.json"
        outside.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "timezone": "Asia/Shanghai",
                    "trial_weekly_start": "2026-08-02",
                    "trial_weekly_end": "2026-08-14",
                    "long_term_cadence": "pending_user_choice",
                    "long_term_effective_from": None,
                    "decided_on": None,
                }
            ),
            encoding="utf-8",
        )
        policy_path.symlink_to(outside)
        symlink_result = self._run("--json", expected_code=2)
        symlink_journal = json.loads(symlink_result.stdout)["sections"]["journal"]
        self.assertFalse(symlink_journal["metrics"]["policy_valid"])

    def test_orphan_monthly_source_fails_closed_without_leaking_content_or_id(self) -> None:
        identifier = "20260801-unknown-fedcba987654"
        self._write(
            "journal/entries/2026/2026-08.md",
            "# 日记\n\n"
            f"<!-- journal-id: {identifier} -->\n\n{RAW_SENTINEL}\n",
        )

        result = self._run("--json", expected_code=2)
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertEqual(journal["status"], "FAIL")
        self.assertFalse(journal["metrics"]["source_graph_valid"])
        self.assertNotIn(identifier, result.stdout + result.stderr)
        self.assertNotIn(RAW_SENTINEL, result.stdout + result.stderr)

    def test_matching_index_and_monthly_source_report_valid_graph(self) -> None:
        self._write_entry(entry_date=TODAY)

        result = self._run("--json")
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertTrue(journal["metrics"]["source_graph_valid"])
        self.assertEqual(journal["metrics"]["source_indexed_entries"], 1)
        self.assertEqual(journal["metrics"]["source_entries"], 1)
        self.assertNotIn(RAW_SENTINEL, result.stdout + result.stderr)

    def test_pending_purge_operation_needs_attention(self) -> None:
        identifier = "20260801-2200-0123456789ab"
        operation_name = (
            "purge-" + hashlib.sha256(identifier.encode("utf-8")).hexdigest()[:20] + ".json"
        )
        self._write(
            f"journal/.operations/{operation_name}",
            json.dumps(
                {
                    "schema_version": 2,
                    "operation": "purge",
                    "id": identifier,
                    "source_file": "entries/2026/2026-08.md",
                    "source_block_sha256": "a" * 64,
                    "reviews": [
                        {"path": "reviews/2026/2026-W31.md", "sha256": "b" * 64}
                    ],
                    "index_references": ["reviews/2026/2026-W31.md"],
                    "created_at": "2026-08-01T22:00:00+08:00",
                }
            ),
        )
        result = self._run("--json")
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertEqual(journal["status"], "ATTENTION")
        self.assertEqual(journal["metrics"]["pending_purges"], 1)

    def test_invalid_pending_purge_v2_fails_closed_without_leaking_payload(self) -> None:
        identifier = "20260801-2200-abcdef012345"
        operation_name = (
            "purge-" + hashlib.sha256(identifier.encode("utf-8")).hexdigest()[:20] + ".json"
        )
        base = {
            "schema_version": 2,
            "operation": "purge",
            "id": identifier,
            "source_file": "entries/2026/2026-08.md",
            "source_block_sha256": "a" * 64,
            "reviews": [],
            "index_references": [],
            "created_at": "2026-08-01T22:00:00+08:00",
        }
        invalid_payloads = [
            {**base, "schema_version": 1},
            {**base, "raw": "never-echo-this-payload"},
            {**base, "source_block_sha256": "not-a-hash"},
            {**base, "source_file": "../outside.md"},
            {**base, "created_at": "2026-08-01T22:00:00"},
        ]
        for position, payload in enumerate(invalid_payloads):
            with self.subTest(position=position):
                operation_path = self.root / "journal/.operations" / operation_name
                operation_path.parent.mkdir(parents=True, exist_ok=True)
                operation_path.write_text(json.dumps(payload), encoding="utf-8")
                result = self._run("--json", expected_code=2)
                self.assertIn("恢复记录结构无效", result.stdout)
                self.assertNotIn(identifier, result.stdout)
                self.assertNotIn("never-echo-this-payload", result.stdout)
                operation_path.unlink()

    def test_withdrawn_index_without_source_marker_is_fail_without_pending_purge(self) -> None:
        index = self._write_entry(entry_date=TODAY)
        record = json.loads(index.read_text(encoding="utf-8"))
        record["status"] = "withdrawn"
        record["withdrawn_at"] = "2026-08-01T22:01:00+08:00"
        index.write_text(json.dumps(record, ensure_ascii=False) + "\n", encoding="utf-8")
        result = self._run("--json", expected_code=2)
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertEqual(journal["status"], "FAIL")
        self.assertEqual(journal["metrics"]["invalid"], 1)

    def test_withdrawal_state_is_checked_only_in_each_target_entry_block(self) -> None:
        index = self._write_entry(entry_date=TODAY)
        active_record = json.loads(index.read_text(encoding="utf-8"))
        withdrawn_record = dict(active_record)
        withdrawn_record["id"] = "20260801-2100-111111111111"
        withdrawn_record["time"] = "21:00"
        withdrawn_record["status"] = "withdrawn"
        withdrawn_record["withdrawn_at"] = "2026-08-01T22:01:00+08:00"
        active_record["id"] = "20260801-2200-222222222222"
        index.write_text(
            json.dumps(withdrawn_record, ensure_ascii=False)
            + "\n"
            + json.dumps(active_record, ensure_ascii=False)
            + "\n",
            encoding="utf-8",
        )
        self._write(
            "journal/entries/2026/2026-07.md",
            "\n".join(
                [
                    "# 日记",
                    "",
                    f"## {TODAY} 21:00｜A",
                    "",
                    f"<!-- journal-id: {withdrawn_record['id']} -->",
                    STATUS_MODULE.WITHDRAWN_SOURCE_MARKERS[0],
                    "",
                    RAW_SENTINEL,
                    "",
                    f"## {TODAY} 22:00｜B",
                    "",
                    f"<!-- journal-id: {active_record['id']} -->",
                    "",
                    RAW_SENTINEL,
                    "",
                ]
            ),
        )

        result = self._run("--json")
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertNotEqual(journal["status"], "FAIL")
        self.assertEqual(journal["metrics"]["invalid"], 0)
        self.assertEqual(journal["metrics"]["active"], 1)
        self.assertEqual(journal["metrics"]["withdrawn"], 1)
        self.assertNotIn(RAW_SENTINEL, result.stdout + result.stderr)

    def test_unknown_journal_index_field_fails_closed_without_leaking_value(self) -> None:
        sentinel = "UNKNOWN-JOURNAL-INDEX-RAW-PRIVATE-9f47"
        index = self._write_entry(entry_date=TODAY)
        record = json.loads(index.read_text(encoding="utf-8"))
        record["raw"] = sentinel
        index.write_text(json.dumps(record, ensure_ascii=False) + "\n", encoding="utf-8")

        result = self._run("--json", expected_code=2)
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertEqual(journal["status"], "FAIL")
        self.assertEqual(journal["metrics"]["invalid"], 1)
        self.assertNotIn(sentinel, result.stdout + result.stderr)

    def test_invalidated_review_cannot_remain_an_effective_reference(self) -> None:
        review = "reviews/2026/2026-W31.md"
        index = self._write_entry(entry_date=TODAY, weekly=[review])
        record = json.loads(index.read_text(encoding="utf-8"))
        record["invalidated_reviews"] = [review]
        index.write_text(json.dumps(record, ensure_ascii=False) + "\n", encoding="utf-8")
        self._write(review, "# 已重新生成但索引仍冲突的回顾\n")
        result = self._run("--json", expected_code=2)
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertEqual(journal["status"], "FAIL")
        self.assertEqual(journal["metrics"]["conflicting_reviews"], 1)

    def test_old_entry_stale_review_and_workbook_drift_need_attention_without_leak(self) -> None:
        index = self._write_entry(entry_date="2026-07-01")
        self._write(
            "journal/reviews/2026/2026-W27.md",
            f"# 回顾\n\n⚠️ {RAW_SENTINEL}\n\n{'来源日记已撤回，本回顾需刷新'}\n",
        )
        workbook = self.root / WORKBOOK
        os.utime(workbook, (index.stat().st_mtime - 10, index.stat().st_mtime - 10))

        result = self._run("--json")
        report = json.loads(result.stdout)
        journal = report["sections"]["journal"]
        self.assertEqual(report["overall"], "ATTENTION")
        self.assertEqual(journal["metrics"]["weekly_due"], 1)
        self.assertEqual(journal["metrics"]["monthly_due"], 1)
        self.assertEqual(journal["metrics"]["stale_reviews"], 1)
        self.assertTrue(journal["metrics"]["workbook_sync_due"])
        self.assertNotIn(RAW_SENTINEL, result.stdout)
        self.assertNotIn("这个标题", result.stdout)
        self.assertNotIn("这个摘要", result.stdout)
        self.assertNotIn(PROJECT_ID_SENTINEL, result.stdout)

    def test_unknown_journal_event_time_is_valid_and_not_replaced_with_recorded_time(self) -> None:
        index = self._write_entry(entry_date="2026-07-31")
        record = json.loads(index.read_text(encoding="utf-8"))
        record["time"] = None
        record["time_precision"] = "unknown"
        record["recorded_at"] = "2026-08-01T12:34:56+08:00"
        index.write_text(json.dumps(record, ensure_ascii=False) + "\n", encoding="utf-8")
        result = self._run("--json")
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertNotEqual(journal["status"], "FAIL")
        self.assertEqual(journal["metrics"]["invalid"], 0)
        self.assertNotIn("12:34", result.stdout)

    def test_daily_checkin_newer_than_workbook_marks_sync_due_without_reading_summary(self) -> None:
        checkin = {
            "schema_version": 2,
            "key": "daily-checkin:2026-08-01",
            "date": "2026-08-01",
            "sleep_time": None,
            "wake_time": None,
            "out_of_bed_time": None,
            "ratings": {
                "sleep_quality": 3,
                "energy": None,
                "mood": None,
                "life_feeling": None,
            },
            "awake_in_bed": None,
            "anchors": {
                "wake": None,
                "body_light": None,
                "life_action": None,
                "wind_down": None,
            },
            "note_summary": "private sentinel",
            "revision": 1,
            "created_at": "2026-08-01T03:20:00Z",
            "updated_at": "2026-08-01T03:20:00Z",
        }
        checkins = self._write(
            "records/daily-checkins.jsonl",
            json.dumps(checkin, ensure_ascii=False) + "\n",
        )
        workbook = self.root / WORKBOOK
        os.utime(
            workbook,
            (checkins.stat().st_mtime - 10, checkins.stat().st_mtime - 10),
        )
        command = self._run("--json")
        result = json.loads(command.stdout)
        journal = result["sections"]["journal"]
        self.assertTrue(journal["metrics"]["workbook_sync_due"])
        self.assertTrue(journal["metrics"]["daily_checkins_valid"])
        self.assertEqual(journal["metrics"]["daily_checkins"], 1)
        rendered = json.dumps(result, ensure_ascii=False)
        self.assertNotIn("private sentinel", rendered)

    def test_empty_daily_source_deletion_after_receipt_marks_sync_due(self) -> None:
        checkins = self._write("records/daily-checkins.jsonl", "")
        self._write_workbook_sync_receipt()
        checkins.unlink()

        command = self._run("--json")
        journal = json.loads(command.stdout)["sections"]["journal"]
        self.assertTrue(journal["metrics"]["daily_checkins_valid"])
        self.assertEqual(journal["metrics"]["daily_checkins"], 0)
        self.assertTrue(journal["metrics"]["workbook_sync_due"])
        self.assertEqual(
            journal["metrics"]["workbook_sync_receipt_state"], "stale"
        )

    def test_current_workbook_sync_receipt_is_exact_and_not_due(self) -> None:
        self._write_daily_checkin("current-receipt-private-summary")
        self._write_workbook_sync_receipt()

        result = self._run("--json")
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertFalse(journal["metrics"]["workbook_sync_due"])
        self.assertTrue(journal["metrics"]["workbook_sync_receipt_present"])
        self.assertTrue(journal["metrics"]["workbook_sync_receipt_valid"])
        self.assertTrue(journal["metrics"]["workbook_sync_receipt_matches"])
        self.assertEqual(journal["metrics"]["workbook_sync_receipt_state"], "current")
        self.assertEqual(journal["status"], "PASS")
        self.assertNotIn("current-receipt-private-summary", result.stdout + result.stderr)

    def test_source_content_drift_with_identical_mtime_is_detected_without_leak(self) -> None:
        source = self._write_daily_checkin("same-mtime-private-before")
        self._write_workbook_sync_receipt()
        original_times = (source.stat().st_atime_ns, source.stat().st_mtime_ns)
        self._write_daily_checkin("same-mtime-private-after")
        os.utime(source, ns=original_times)

        result = self._run("--json")
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertTrue(journal["metrics"]["workbook_sync_due"])
        self.assertTrue(journal["metrics"]["workbook_sync_receipt_valid"])
        self.assertEqual(journal["metrics"]["workbook_sync_receipt_state"], "stale")
        self.assertNotIn("same-mtime-private-before", result.stdout + result.stderr)
        self.assertNotIn("same-mtime-private-after", result.stdout + result.stderr)

    def test_source_addition_after_receipt_is_detected_even_when_empty(self) -> None:
        self._write_workbook_sync_receipt()
        self._write(STATUS_MODULE.DAILY_CHECKINS, "")

        result = self._run("--json")
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertTrue(journal["metrics"]["workbook_sync_due"])
        self.assertEqual(journal["metrics"]["workbook_sync_receipt_state"], "stale")

    def test_workbook_byte_drift_after_receipt_is_detected_without_leak(self) -> None:
        sentinel = "PRIVATE-WORKBOOK-BYTES-MUST-NOT-LEAK"
        self._write_workbook_sync_receipt()
        workbook = self.root / WORKBOOK
        old_times = (workbook.stat().st_atime_ns, workbook.stat().st_mtime_ns)
        workbook.write_bytes(workbook.read_bytes() + sentinel.encode("utf-8"))
        os.utime(workbook, ns=old_times)

        result = self._run("--json")
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertTrue(journal["metrics"]["workbook_sync_due"])
        self.assertEqual(journal["metrics"]["workbook_sync_receipt_state"], "stale")
        self.assertNotIn(sentinel, result.stdout + result.stderr)

    def test_missing_receipt_with_empty_sources_is_low_noise(self) -> None:
        self._write(STATUS_MODULE.DAILY_CHECKINS, "")
        result = self._run("--json")
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertFalse(journal["metrics"]["workbook_sync_due"])
        self.assertFalse(journal["metrics"]["workbook_sync_receipt_present"])
        self.assertEqual(
            journal["metrics"]["workbook_sync_receipt_state"], "not_required_empty"
        )

    def test_invalid_sync_receipts_fail_closed_without_content_leak(self) -> None:
        sentinel = "PRIVATE-SYNC-RECEIPT-CONTENT-MUST-NOT-LEAK"
        valid_path = self._write_workbook_sync_receipt()
        valid = json.loads(valid_path.read_text(encoding="utf-8"))
        invalid_payloads: list[str] = [
            json.dumps({**valid, "unexpected": sentinel}, ensure_ascii=False),
            (
                '{"schema_version":1,"schema_version":1,'
                f'"private":"{sentinel}"}}'
            ),
            '{"schema_version":NaN}',
            json.dumps(
                {
                    **valid,
                    "sources": {
                        **valid["sources"],
                        "daily": {
                            **valid["sources"]["daily"],
                            "present": 1,
                            "sha256": sentinel,
                        },
                    },
                },
                ensure_ascii=False,
            ),
            json.dumps(
                {
                    **valid,
                    "sources": {
                        **valid["sources"],
                        "journal": {
                            **valid["sources"]["journal"],
                            "path_category": f"/absolute/{sentinel}",
                        },
                    },
                },
                ensure_ascii=False,
            ),
            json.dumps({**valid, "synced_at": "2026-08-01T04:00:00+08:00"}),
        ]
        for position, payload in enumerate(invalid_payloads):
            with self.subTest(position=position):
                valid_path.write_text(payload + "\n", encoding="utf-8")
                result = self._run("--json", expected_code=2)
                journal = json.loads(result.stdout)["sections"]["journal"]
                self.assertTrue(journal["metrics"]["workbook_sync_due"])
                self.assertFalse(journal["metrics"]["workbook_sync_receipt_valid"])
                self.assertEqual(
                    journal["metrics"]["workbook_sync_receipt_state"], "invalid"
                )
                self.assertNotIn(sentinel, result.stdout + result.stderr)

    def test_symlink_sync_receipt_fails_closed(self) -> None:
        receipt = self._write_workbook_sync_receipt()
        outside = self.root.parent / "outside-workbook-sync-state.json"
        receipt.replace(outside)
        receipt.symlink_to(outside)

        result = self._run("--json", expected_code=2)
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertTrue(journal["metrics"]["workbook_sync_due"])
        self.assertFalse(journal["metrics"]["workbook_sync_receipt_valid"])
        self.assertEqual(journal["metrics"]["workbook_sync_receipt_state"], "invalid")

    def test_invalid_daily_checkin_fails_without_leaking_content(self) -> None:
        sentinel = "daily-private-content-must-not-leak"
        self._write(
            "records/daily-checkins.jsonl",
            json.dumps({"raw_transcript": sentinel}, ensure_ascii=False) + "\n",
        )
        result = self._run("--json", expected_code=2)
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertEqual(journal["status"], "FAIL")
        self.assertFalse(journal["metrics"]["daily_checkins_valid"])
        self.assertNotIn(sentinel, result.stdout + result.stderr)

    def test_weekly_review_newer_than_workbook_marks_sync_due_without_leaking_answers(self) -> None:
        sentinel = "weekly-private-content-must-not-leak"
        weekly = {
            "schema_version": 1,
            "key": "weekly-review:2026-W32",
            "iso_week": "2026-W32",
            "week_start": "2026-08-03",
            "week_end": "2026-08-09",
            "answers": {
                "better_summary": sentinel,
                "friction_summary": None,
                "experiment_summary": None,
                "stop_summary": None,
                "goal_intent": None,
            },
            "revision": 1,
            "created_at": "2026-08-09T04:00:00Z",
            "updated_at": "2026-08-09T04:00:00Z",
        }
        source = self._write(
            "records/weekly-reviews.jsonl",
            json.dumps(weekly, ensure_ascii=False) + "\n",
        )
        workbook = self.root / WORKBOOK
        os.utime(workbook, ns=(source.stat().st_mtime_ns - 1_000_000,) * 2)

        result = self._run("--json")
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertTrue(journal["metrics"]["weekly_reviews_valid"])
        self.assertEqual(journal["metrics"]["weekly_reviews"], 1)
        self.assertTrue(journal["metrics"]["workbook_sync_due"])
        self.assertNotIn(sentinel, result.stdout + result.stderr)

    def test_invalid_weekly_review_fails_without_leaking_content(self) -> None:
        sentinel = "invalid-weekly-private-content-must-not-leak"
        self._write(
            "records/weekly-reviews.jsonl",
            json.dumps({"raw_transcript": sentinel}, ensure_ascii=False) + "\n",
        )
        result = self._run("--json", expected_code=2)
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertEqual(journal["status"], "FAIL")
        self.assertFalse(journal["metrics"]["weekly_reviews_valid"])
        self.assertNotIn(sentinel, result.stdout + result.stderr)

    def test_phase_review_ledger_is_counted_and_invalid_content_never_leaks(self) -> None:
        answers = {
            "recovery_change": "稍微稳定",
            "main_friction": None,
            "life_experience_signal": None,
            "goal_intent": "continue",
            "journal_cadence": "undecided",
            "checkin_experience": None,
            "checkin_cadence": None,
            "next_track": None,
            "career_timing": None,
            "fitness_conversation": None,
        }
        record = {
            "schema_version": 1,
            "key": "phase-review:2026-08-14",
            "review_date": "2026-08-14",
            "answers": answers,
            "revision": 1,
            "created_at": "2026-08-14T04:00:00Z",
            "updated_at": "2026-08-14T04:00:00Z",
        }
        path = self._write(
            "records/phase-reviews.jsonl",
            json.dumps(record, ensure_ascii=False) + "\n",
        )
        valid = self._run("--json")
        journal = json.loads(valid.stdout)["sections"]["journal"]
        self.assertTrue(journal["metrics"]["phase_reviews_valid"])
        self.assertEqual(journal["metrics"]["phase_reviews"], 1)
        self.assertNotIn("稍微稳定", valid.stdout + valid.stderr)

        record["raw_transcript"] = RAW_SENTINEL
        path.write_text(json.dumps(record, ensure_ascii=False) + "\n", encoding="utf-8")
        invalid = self._run("--json", expected_code=2)
        journal = json.loads(invalid.stdout)["sections"]["journal"]
        self.assertFalse(journal["metrics"]["phase_reviews_valid"])
        self.assertNotIn(RAW_SENTINEL, invalid.stdout + invalid.stderr)

    def test_empty_optional_workflow_ledgers_are_normal(self) -> None:
        insight_path = self._write("journal/insight-decisions.jsonl", "")
        action_path = self._write(STATUS_MODULE.PHASE_ACTIONS, "")
        insight_path.chmod(0o600)
        action_path.chmod(0o600)

        result = self._run("--json")
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertEqual(journal["status"], "PASS")
        self.assertTrue(journal["metrics"]["insight_ledger_present"])
        self.assertTrue(journal["metrics"]["insight_ledger_valid"])
        self.assertEqual(journal["metrics"]["insight_candidates"], 0)
        self.assertTrue(journal["metrics"]["phase_action_ledger_present"])
        self.assertTrue(journal["metrics"]["phase_actions_valid"])
        self.assertEqual(journal["metrics"]["phase_actions"], 0)

    def test_insight_states_are_counted_and_only_recoverable_states_need_attention(self) -> None:
        private_text = "PRIVATE-EXACT-INSIGHT-CHANGE-MUST-NEVER-LEAK"
        expected_metric = {
            "pending": "insight_pending",
            "awaiting_proposal": "insight_awaiting_proposal",
            "proposed": "insight_proposed",
            "applied": "insight_applied",
        }
        for position, status in enumerate(expected_metric, start=1):
            with self.subTest(status=status):
                history = self._insight_history(
                    candidate_hex=f"{position:x}",
                    final_status=status,
                    private_text=private_text,
                )
                path = self._write(
                    "journal/insight-decisions.jsonl",
                    "".join(
                        json.dumps(record, ensure_ascii=False) + "\n"
                        for record in history
                    ),
                )
                path.chmod(0o600)

                result = self._run("--json")
                journal = json.loads(result.stdout)["sections"]["journal"]
                self.assertTrue(journal["metrics"]["insight_ledger_valid"])
                self.assertEqual(journal["metrics"]["insight_candidates"], 1)
                for metric in expected_metric.values():
                    self.assertEqual(
                        journal["metrics"][metric],
                        1 if metric == expected_metric[status] else 0,
                    )
                expected_status = (
                    "ATTENTION"
                    if status in {"awaiting_proposal", "proposed"}
                    else "PASS"
                )
                self.assertEqual(journal["status"], expected_status)
                combined = result.stdout + result.stderr
                self.assertNotIn(private_text, combined)
                self.assertNotIn(history[0]["candidate_id"], combined)
                self.assertNotIn(history[0]["review_sha256"], combined)
                self.assertNotIn("USER.md", combined)

    def test_invalid_insight_content_fails_closed_without_leak(self) -> None:
        private_text = "PRIVATE-INVALID-INSIGHT-MUST-NEVER-LEAK"
        record = self._insight_history(
            candidate_hex="a",
            final_status="pending",
            private_text=private_text,
        )[0]
        record["raw"] = RAW_SENTINEL
        path = self._write(
            "journal/insight-decisions.jsonl",
            json.dumps(record, ensure_ascii=False) + "\n",
        )
        path.chmod(0o600)

        invalid = self._run("--json", expected_code=2)
        journal = json.loads(invalid.stdout)["sections"]["journal"]
        self.assertFalse(journal["metrics"]["insight_ledger_valid"])
        self.assertNotIn(private_text, invalid.stdout + invalid.stderr)
        self.assertNotIn(RAW_SENTINEL, invalid.stdout + invalid.stderr)
        self.assertNotIn(record["candidate_id"], invalid.stdout + invalid.stderr)

    def test_phase_action_states_are_counted_without_leaking_values(self) -> None:
        records = [
            self._phase_action_record(
                category="goal_intent",
                desired_value="continue",
                state="pending",
                source_hex="a",
            ),
            self._phase_action_record(
                category="journal_cadence",
                desired_value="weekly",
                state="failed",
                source_hex="b",
            ),
            self._phase_action_record(
                category="checkin_cadence",
                desired_value="weekly",
                state="applied",
                source_hex="c",
            ),
            self._phase_action_record(
                category="next_track",
                desired_value="fitness",
                state="dismissed",
                source_hex="d",
            ),
            self._phase_action_record(
                category="career_timing",
                desired_value="later",
                state="superseded",
                source_hex="e",
            ),
        ]
        path = self._write(
            STATUS_MODULE.PHASE_ACTIONS,
            "".join(
                json.dumps(record, ensure_ascii=False) + "\n" for record in records
            ),
        )
        path.chmod(0o600)

        result = self._run("--json")
        journal = json.loads(result.stdout)["sections"]["journal"]
        self.assertEqual(journal["status"], "ATTENTION")
        self.assertTrue(journal["metrics"]["phase_actions_valid"])
        self.assertEqual(journal["metrics"]["phase_actions"], 5)
        for state in ("pending", "failed", "applied", "dismissed", "superseded"):
            self.assertEqual(journal["metrics"][f"phase_action_{state}"], 1)
        combined = result.stdout + result.stderr
        for record in records:
            self.assertNotIn(record["action_id"], combined)
            self.assertNotIn(record["source_record_etag"], combined)
            self.assertNotIn(json.dumps(record["desired_value"]), combined)

        settled = records[2:]
        path.write_text(
            "".join(
                json.dumps(record, ensure_ascii=False) + "\n" for record in settled
            ),
            encoding="utf-8",
        )
        path.chmod(0o600)
        settled_result = self._run("--json")
        settled_journal = json.loads(settled_result.stdout)["sections"]["journal"]
        self.assertEqual(settled_journal["status"], "PASS")
        self.assertEqual(settled_journal["metrics"]["phase_action_pending"], 0)
        self.assertEqual(settled_journal["metrics"]["phase_action_failed"], 0)

    def test_invalid_phase_action_content_fails_closed_without_leak(self) -> None:
        sentinel = "PRIVATE-PHASE-ACTION-MUST-NEVER-LEAK"
        record = self._phase_action_record(
            category="goal_intent",
            desired_value="continue",
            state="pending",
            source_hex="a",
        )
        record["private"] = sentinel
        path = self._write(
            STATUS_MODULE.PHASE_ACTIONS,
            json.dumps(record, ensure_ascii=False) + "\n",
        )
        path.chmod(0o600)

        invalid = self._run("--json", expected_code=2)
        journal = json.loads(invalid.stdout)["sections"]["journal"]
        self.assertFalse(journal["metrics"]["phase_actions_valid"])
        combined = invalid.stdout + invalid.stderr
        self.assertNotIn(sentinel, combined)
        self.assertNotIn(record["action_id"], combined)
        self.assertNotIn(record["source_record_etag"], combined)

    def test_recent_entry_raw_content_never_leaks(self) -> None:
        index = self._write_entry(entry_date=TODAY)
        self._mark_workbook_synced_after(index)
        self._create_backup()
        result = self._run("--json", "--write", "reports/status.md")
        status_text = (self.root / "reports/status.md").read_text(encoding="utf-8")
        self.assertEqual(json.loads(result.stdout)["overall"], "PASS")
        self.assertNotIn(RAW_SENTINEL, result.stdout + status_text)
        self.assertNotIn(PROJECT_ID_SENTINEL, result.stdout + status_text)

    def test_amended_review_marker_needs_attention(self) -> None:
        self._write(
            "journal/reviews/2026/2026-W31.md",
            "# 回顾\n\n⚠️ 来源日记已更正，本回顾需刷新后再用于规划。\n",
        )
        result = self._run("--json")
        report = json.loads(result.stdout)
        self.assertEqual(report["overall"], "ATTENTION")
        self.assertEqual(report["sections"]["journal"]["metrics"]["stale_reviews"], 1)

    def test_valid_old_snapshot_is_attention_when_current_project_changed(self) -> None:
        self._write("AGENTS.md", "changed after backup\n")
        result = self._run("--json")
        backup = json.loads(result.stdout)["sections"]["backup"]
        self.assertEqual(backup["status"], "ATTENTION")
        self.assertTrue(backup["metrics"]["verified"])
        self.assertFalse(backup["metrics"]["current_project_matches"])

    def test_phase_lock_file_does_not_make_backup_look_stale(self) -> None:
        self._write("records/.phase-reviews.lock", "")
        result = self._run("--json")
        backup = json.loads(result.stdout)["sections"]["backup"]
        self.assertTrue(backup["metrics"]["current_project_matches"])

    def test_phase_action_lock_file_does_not_make_backup_look_stale(self) -> None:
        lock = self._write("records/.phase-actions.lock", "")
        lock.chmod(0o600)
        result = self._run("--json")
        backup = json.loads(result.stdout)["sections"]["backup"]
        self.assertTrue(backup["metrics"]["current_project_matches"])

    def test_valid_legacy_governance_link_does_not_make_backup_look_stale(self) -> None:
        legacy = self.root / STATUS_MODULE.LEGACY_GOVERNANCE_LINK
        legacy.parent.mkdir(parents=True, exist_ok=True)
        legacy.symlink_to(STATUS_MODULE.LEGACY_GOVERNANCE_TARGET)
        self._create_backup(revision="legacy-link")

        result = self._run("--json")

        backup = json.loads(result.stdout)["sections"]["backup"]
        self.assertTrue(backup["metrics"]["verified"])
        self.assertTrue(backup["metrics"]["current_project_matches"])

    def test_bad_backup_checksum_is_fail(self) -> None:
        self._create_backup(corrupt=True)
        result = self._run("--json", expected_code=2)
        report = json.loads(result.stdout)
        self.assertEqual(report["overall"], "FAIL")
        self.assertEqual(report["sections"]["backup"]["status"], "FAIL")
        self.assertFalse(report["sections"]["backup"]["metrics"]["verified"])

    def test_corrupt_zip_with_matching_checksum_is_fail(self) -> None:
        backup_dir = self.root / "backups"
        stem = f"生活助手-完整备份-{TODAY}"
        archive_path = backup_dir / f"{stem}.zip"
        checksum_path = backup_dir / f"{stem}.zip.sha256"
        archive_path.write_bytes(b"this is not a zip archive")
        checksum_path.write_text(
            f"{self._digest(archive_path.read_bytes())}  {archive_path.name}\n",
            encoding="utf-8",
        )

        result = self._run("--json", expected_code=2)
        backup = json.loads(result.stdout)["sections"]["backup"]
        self.assertTrue(backup["metrics"]["checksum_ok"])
        self.assertFalse(backup["metrics"]["archive_ok"])
        self.assertEqual(backup["status"], "FAIL")

    def test_missing_backup_is_attention_not_failure(self) -> None:
        shutil.rmtree(self.root / "backups")
        result = self._run("--json")
        backup = json.loads(result.stdout)["sections"]["backup"]
        self.assertEqual(backup["status"], "ATTENTION")
        self.assertFalse(backup["metrics"]["available"])

    def test_newest_same_day_revision_is_selected(self) -> None:
        original = self.root / "backups" / f"生活助手-完整备份-{TODAY}.zip"
        revision = self._create_backup(revision="r2", corrupt=True)
        newer = original.stat().st_mtime + 10
        os.utime(revision, (newer, newer))
        result = self._run("--json", expected_code=2)
        backup = json.loads(result.stdout)["sections"]["backup"]
        self.assertEqual(backup["status"], "FAIL")
        self.assertFalse(backup["metrics"]["checksum_ok"])

    def test_archive_file_missing_from_manifest_is_fail(self) -> None:
        self._create_backup(revision="r2", extra_file=True)
        result = self._run("--json", expected_code=2)
        backup = json.loads(result.stdout)["sections"]["backup"]
        self.assertEqual(backup["status"], "FAIL")
        self.assertFalse(backup["metrics"]["manifest_ok"])

    def test_overdue_goal_and_expired_automation_need_attention(self) -> None:
        self._write(
            "GOALS.md",
            "# 目标\n\n- 下次复盘：2026-07-15\n- 节奏复盘：2026-07-31\n",
        )
        prompt_hash = self._digest(
            (self.root / "automations/生活状态回访.prompt.txt").read_bytes()
        )
        self._write_registry(
            start="2026-07-01",
            end="2026-07-31",
            prompt_sha256=prompt_hash,
        )
        self._create_runtime_automation(
            rrule="RRULE:FREQ=DAILY;BYHOUR=3;BYMINUTE=15;UNTIL=20260731T031500Z"
        )
        self._create_runtime_database(next_utc="2026-07-31T03:15:18+00:00")
        result = self._run("--json")
        report = json.loads(result.stdout)
        self.assertEqual(report["overall"], "ATTENTION")
        self.assertEqual(report["sections"]["goals"]["metrics"]["overdue"], 2)
        self.assertEqual(report["sections"]["automation"]["metrics"]["state"], "expired")

    def test_write_cannot_escape_project_root(self) -> None:
        result = self._run("--write", "../outside.md", expected_code=2)
        self.assertIn("--write 必须位于 --root", result.stderr)
        self.assertFalse((self.root.parent / "outside.md").exists())


if __name__ == "__main__":
    unittest.main()
