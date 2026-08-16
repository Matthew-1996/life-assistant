#!/usr/bin/env python3
"""Tests for the read-only portability environment doctor."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("portability_doctor.py")
SPEC = importlib.util.spec_from_file_location("portability_doctor", MODULE_PATH)
assert SPEC and SPEC.loader
doctor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(doctor)


class PortabilityDoctorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write(self, relative: str, content: str = "ok\n") -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def _write_required(self) -> None:
        for relative in doctor.REQUIRED_PROJECT_FILES:
            self._write(relative)
        self._write(
            "apps/life-console/package.json",
            json.dumps({"engines": {"node": ">=22.13.0"}}),
        )
        self._write("apps/life-console/package-lock.json", "{}\n")
        self._write(
            "docs/operations/product-surfaces.json",
            json.dumps(
                {
                    "schema_version": 1,
                    "truth_source": "supabase-owner-scoped",
                    "surfaces": [
                        {
                            "id": "life-console",
                            "lifecycle_state": "active",
                            "role": "primary",
                            "sync_cadence": "online",
                            "writeback": "supabase-owner-session",
                        },
                        {
                            "id": "icloud-backup",
                            "lifecycle_state": "active",
                            "role": "recovery-only",
                            "sync_cadence": "six_hourly_and_on_demand",
                            "writeback": "none",
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
            ),
        )

    def test_version_parser(self) -> None:
        self.assertEqual(doctor._version_tuple("v22.13.1"), (22, 13, 1))
        self.assertIsNone(doctor._version_tuple("unknown"))

    def test_missing_core_files_is_failure(self) -> None:
        with mock.patch.object(doctor.shutil, "which", return_value=None):
            report = doctor.build_report(self.root)

        self.assertEqual(report["overall"], "FAIL")
        project = next(item for item in report["checks"] if item["name"] == "project_files")
        self.assertEqual(project["status"], "FAIL")

    def test_new_portable_truth_sources_are_required(self) -> None:
        expected = {
            "automations/registry.json",
            "automations/生活状态回访.prompt.txt",
            "docs/governance/agent-user-project-development-standard.md",
            "docs/knowledge-base/README.md",
            "docs/knowledge-base/生活助手-LifeConsole-1.0.0/生活助手-LifeConsole-1.0.0.md",
            "docs/knowledge-base/生活助手-LifeConsole-1.0.0/项目管理-生活助手-LifeConsole-1.0.0.md",
            "docs/knowledge-base/生活助手-LifeConsole-1.0.0/需求评审报告-生活助手-LifeConsole-1.0.0.md",
            "docs/knowledge-base/生活助手-LifeConsole-1.0.0/设计方案-生活助手-LifeConsole-1.0.0.md",
            "docs/knowledge-base/生活助手-LifeConsole-1.0.0/技术方案-生活助手-LifeConsole-1.0.0.md",
            "docs/knowledge-base/生活助手-LifeConsole-1.0.0/工程评审与验收-生活助手-LifeConsole-1.0.0.md",
            "docs/operations/product-surfaces.json",
            "apps/life-console/package-lock.json",
            "journal/PRIVACY.md",
            "outputs/019fb832-be4f-74f1-add5-58cb6fb6fc09/生活计划表.xlsx",
            "outputs/019fb832-be4f-74f1-add5-58cb6fb6fc09/生活计划表.sync-state.json",
            "records/README.md",
            "tools/daily_checkin.py",
            "tools/check_project_governance.py",
            "tools/test_project_governance.py",
            "tools/weekly_review.py",
            "tools/test_weekly_review.py",
            "tools/phase_review.py",
            "tools/test_phase_review.py",
            "tools/phase_actions.py",
            "tools/test_phase_actions.py",
            "tools/journal_insights.py",
            "tools/test_journal_insights.py",
            "tools/life_plan_records.mjs",
            "tools/update_life_plan_journal.mjs",
            "tools/verify_backup.py",
            "tools/product_surfaces.py",
        }
        self.assertTrue(expected.issubset(set(doctor.REQUIRED_PROJECT_FILES)))
        self.assertNotIn("records/weekly-reviews.jsonl", doctor.REQUIRED_PROJECT_FILES)
        self.assertNotIn("records/phase-reviews.jsonl", doctor.REQUIRED_PROJECT_FILES)
        self.assertNotIn("records/phase-actions.jsonl", doctor.REQUIRED_PROJECT_FILES)
        self.assertNotIn("journal/insight-decisions.jsonl", doctor.REQUIRED_PROJECT_FILES)

    def test_missing_optional_runtimes_is_attention_not_failure(self) -> None:
        self._write_required()

        def fake_spec(name: str):
            return object() if name == "fcntl" else None

        with mock.patch.object(doctor.shutil, "which", return_value=None), mock.patch.object(
            doctor.importlib.util, "find_spec", side_effect=fake_spec
        ), mock.patch.object(doctor.sys, "version_info", (3, 11, 0)):
            report = doctor.build_report(self.root)

        self.assertEqual(report["overall"], "ATTENTION")
        statuses = {item["name"]: item["status"] for item in report["checks"]}
        self.assertEqual(statuses["project_files"], "PASS")
        self.assertEqual(statuses["product_surfaces"], "PASS")
        self.assertEqual(statuses["weekly_review_data"], "INFO")
        self.assertEqual(statuses["phase_review_data"], "INFO")
        self.assertEqual(statuses["phase_action_data"], "INFO")
        self.assertEqual(statuses["journal_insight_data"], "INFO")
        self.assertEqual(statuses["python"], "PASS")
        self.assertEqual(statuses["journal_lock"], "PASS")
        self.assertEqual(statuses["pyyaml"], "INFO")
        self.assertEqual(statuses["node"], "ATTENTION")
        self.assertEqual(statuses["artifact_tool"], "INFO")

    def test_present_optional_weekly_data_is_pass_and_not_core_requirement(self) -> None:
        self._write_required()
        self._write("records/weekly-reviews.jsonl", "")

        with mock.patch.object(doctor.shutil, "which", return_value=None):
            report = doctor.build_report(self.root)

        weekly = next(
            item for item in report["checks"] if item["name"] == "weekly_review_data"
        )
        self.assertEqual(weekly["status"], "PASS")
        self.assertEqual(weekly["scope"], "optional_source")

    def test_non_file_weekly_data_path_is_failure(self) -> None:
        self._write_required()
        (self.root / "records/weekly-reviews.jsonl").mkdir(parents=True)

        with mock.patch.object(doctor.shutil, "which", return_value=None):
            report = doctor.build_report(self.root)

        weekly = next(
            item for item in report["checks"] if item["name"] == "weekly_review_data"
        )
        self.assertEqual(weekly["status"], "FAIL")
        self.assertEqual(report["overall"], "FAIL")

    def test_non_file_phase_and_insight_paths_are_failures(self) -> None:
        self._write_required()
        (self.root / "records/phase-reviews.jsonl").mkdir(parents=True)
        (self.root / "journal/insight-decisions.jsonl").mkdir(parents=True)

        with mock.patch.object(doctor.shutil, "which", return_value=None):
            report = doctor.build_report(self.root)

        statuses = {item["name"]: item["status"] for item in report["checks"]}
        self.assertEqual(statuses["phase_review_data"], "FAIL")
        self.assertEqual(statuses["journal_insight_data"], "FAIL")
        self.assertEqual(report["overall"], "FAIL")

    def test_present_optional_phase_action_data_is_pass(self) -> None:
        self._write_required()
        self._write("records/phase-actions.jsonl", "")

        with mock.patch.object(doctor.shutil, "which", return_value=None):
            report = doctor.build_report(self.root)

        action = next(
            item for item in report["checks"] if item["name"] == "phase_action_data"
        )
        self.assertEqual(action["status"], "PASS")
        self.assertEqual(action["scope"], "optional_source")

    def test_phase_action_directory_and_symlink_paths_are_failures(self) -> None:
        for unsafe_kind in ("directory", "symlink"):
            with self.subTest(unsafe_kind=unsafe_kind):
                self.temp.cleanup()
                self.temp = tempfile.TemporaryDirectory()
                self.root = Path(self.temp.name)
                self._write_required()
                action_path = self.root / "records/phase-actions.jsonl"
                if unsafe_kind == "directory":
                    action_path.mkdir(parents=True)
                else:
                    target = self.root / "records/phase-actions-target.jsonl"
                    target.write_text("", encoding="utf-8")
                    action_path.symlink_to(target)

                with mock.patch.object(doctor.shutil, "which", return_value=None):
                    report = doctor.build_report(self.root)

                statuses = {item["name"]: item["status"] for item in report["checks"]}
                self.assertEqual(statuses["phase_action_data"], "FAIL")
                self.assertEqual(report["overall"], "FAIL")

    def test_missing_life_console_lockfile_is_failure(self) -> None:
        self._write_required()
        (self.root / "apps/life-console/package-lock.json").unlink()

        with mock.patch.object(doctor.shutil, "which", return_value=None):
            report = doctor.build_report(self.root)

        project = next(item for item in report["checks"] if item["name"] == "project_files")
        self.assertEqual(project["status"], "FAIL")
        self.assertEqual(report["overall"], "FAIL")

    def test_reactivated_dashboard_lifecycle_is_failure(self) -> None:
        self._write_required()
        path = self.root / "docs/operations/product-surfaces.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["surfaces"][-1]["lifecycle_state"] = "active"
        path.write_text(json.dumps(payload), encoding="utf-8")

        with mock.patch.object(doctor.shutil, "which", return_value=None):
            report = doctor.build_report(self.root)

        surfaces = next(item for item in report["checks"] if item["name"] == "product_surfaces")
        self.assertEqual(surfaces["status"], "FAIL")
        self.assertEqual(report["overall"], "FAIL")


if __name__ == "__main__":
    unittest.main()
