#!/usr/bin/env python3
"""候选长期认识确认台账的隐私、并发与防陈旧回归测试。"""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).with_name("journal_insights.py")
SPEC = importlib.util.spec_from_file_location("journal_insights", SCRIPT)
assert SPEC and SPEC.loader
insights = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(insights)
SOURCE_ENTRY_ID = "20260801-unknown-abcdef123456"


class JournalInsightsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.root = self.base / "journal"
        self.root.mkdir()
        for name in ("USER.md", "MEMORY.md", "GOALS.md"):
            (self.base / name).write_text(f"# {name}\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _run_raw(
        self,
        command: str,
        raw: str,
        *,
        root: Path | None = None,
        expected_code: int = 0,
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                command,
                "--root",
                str(root or self.root),
                "--input",
                "-",
            ],
            input=raw,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(
            result.returncode,
            expected_code,
            msg=f"stdout={result.stdout!r}\nstderr={result.stderr!r}",
        )
        return result

    def _run(
        self,
        command: str,
        payload: dict[str, object] | None = None,
        *,
        root: Path | None = None,
        expected_code: int = 0,
    ) -> tuple[subprocess.CompletedProcess[str], dict[str, object] | None]:
        result = self._run_raw(
            command,
            json.dumps(payload if payload is not None else {}, ensure_ascii=False),
            root=root,
            expected_code=expected_code,
        )
        parsed = json.loads(result.stdout) if result.stdout.strip() else None
        return result, parsed

    def _write_review(
        self,
        *,
        root: Path | None = None,
        relative: str = "reviews/2026/2026-08.md",
        candidate_memories: list[str] | None = None,
        planning_implications: list[str] | None = None,
        source_entry_id: str = SOURCE_ENTRY_ID,
        extra_note: str = "",
    ) -> Path:
        journal_root = root or self.root
        path = journal_root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        review_type = "weekly" if "-W" in path.name else "monthly"
        planning = planning_implications or []
        memories = candidate_memories or []
        lines = [
            "# 合成生活回顾",
            "",
            f"<!-- journal-review: {review_type} {relative} -->",
            "- 隐私：local-only",
            extra_note,
            "",
            "## 对后续规划有用的启示",
            "",
        ]
        lines.extend(f"- {value}" for value in planning)
        if not planning:
            lines.append("- 暂无记录")
        lines.extend(
            [
                "",
                "## 候选长期认识（待用户确认）",
                "",
                "> 以下仅是候选线索，不得自动写入长期文件。",
                "",
            ]
        )
        lines.extend(f"- 待用户确认：{value}" for value in memories)
        if not memories:
            lines.append("- 暂无候选认识")
        lines.extend(
            [
                "",
                "## 来源日记",
                "",
                f"- 2026-08-01 时间未知｜合成来源（`{source_entry_id}`）",
                "",
            ]
        )
        path.write_text("\n".join(lines), encoding="utf-8")
        return path

    def _plan_one(self) -> dict[str, object]:
        _, planned = self._run("plan")
        assert planned is not None
        self.assertEqual(planned["returned"], 1)
        return planned["candidates"][0]  # type: ignore[index,return-value]

    def _decision_payload(self, candidate: dict[str, object], decision: str) -> dict[str, object]:
        return {
            "candidate_id": candidate["candidate_id"],
            "decision": decision,
            "expect_revision": candidate["revision"],
            "expect_candidate_etag": candidate["candidate_etag"],
        }

    def _accept_one(self) -> dict[str, object]:
        candidate = self._plan_one()
        _, accepted = self._run(
            "decide", self._decision_payload(candidate, "accept")
        )
        assert accepted is not None
        self.assertEqual(accepted["status"], "awaiting_proposal")
        return accepted

    def _proposal_payload(
        self,
        candidate: dict[str, object],
        text: str,
        *,
        target: str = "USER.md",
    ) -> dict[str, object]:
        return {
            "candidate_id": candidate["candidate_id"],
            "target_file": target,
            "proposal_text": text,
            "expect_revision": candidate["revision"],
            "expect_candidate_etag": candidate["candidate_etag"],
        }

    def _apply_plan_payload(self, proposal: dict[str, object]) -> dict[str, object]:
        return {
            "candidate_id": proposal["candidate_id"],
            "expect_revision": proposal["revision"],
            "expect_candidate_etag": proposal["candidate_etag"],
        }

    def _mark_payload(self, proposal: dict[str, object]) -> dict[str, object]:
        return {
            **self._apply_plan_payload(proposal),
            "expect_proposal_sha256": proposal["proposal_sha256"],
        }

    def _ledger(self) -> list[dict[str, object]]:
        path = self.root / "insight-decisions.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]

    def test_blank_journal_is_normal_and_does_not_create_ledger(self) -> None:
        _, planned = self._run("plan")
        self.assertEqual(planned["candidates"], [])  # type: ignore[index]
        self.assertEqual(planned["pending_count"], 0)  # type: ignore[index]
        self.assertFalse((self.root / "insight-decisions.jsonl").exists())

        _, status_result = self._run("status")
        self.assertEqual(status_result["total_candidates"], 0)  # type: ignore[index]
        self.assertEqual(
            status_result["counts"],  # type: ignore[index]
            {
                "applied": 0,
                "awaiting_proposal": 0,
                "pending": 0,
                "proposed": 0,
                "rejected": 0,
                "superseded": 0,
            },
        )

        empty_ledger = self.root / "insight-decisions.jsonl"
        empty_ledger.write_text("", encoding="utf-8")
        os.chmod(empty_ledger, 0o644)
        _, status_with_public_permissions = self._run("status")
        self.assertFalse(status_with_public_permissions["valid"])  # type: ignore[index]
        self.assertFalse(status_with_public_permissions["permissions_private"])  # type: ignore[index]
        self.assertEqual(stat.S_IMODE(empty_ledger.stat().st_mode), 0o644)

    def test_public_inspector_is_read_only_on_empty_journal(self) -> None:
        before = set(self.root.iterdir())
        report = insights.inspect_insight_ledger(self.root)
        after = set(self.root.iterdir())
        self.assertEqual(before, after)
        self.assertFalse((self.root / ".journal.lock").exists())
        self.assertEqual(
            report,
            {
                "valid": True,
                "ledger_present": False,
                "permissions_private": True,
                "record_versions": 0,
                "total_candidates": 0,
                "counts": {
                    "applied": 0,
                    "awaiting_proposal": 0,
                    "pending": 0,
                    "proposed": 0,
                    "rejected": 0,
                    "superseded": 0,
                },
                "action_required": False,
            },
        )

    def test_public_inspector_returns_only_safe_counts(self) -> None:
        private_text = "INSPECTOR-PRIVATE-CANDIDATE-TEXT"
        self._write_review(candidate_memories=[private_text])
        candidate = self._plan_one()
        report = insights.inspect_insight_ledger(self.root)
        serialized = json.dumps(report, ensure_ascii=False, sort_keys=True)
        self.assertEqual(
            set(report),
            {
                "valid",
                "ledger_present",
                "permissions_private",
                "record_versions",
                "total_candidates",
                "counts",
                "action_required",
            },
        )
        self.assertTrue(report["ledger_present"])
        self.assertTrue(report["permissions_private"])
        self.assertEqual(report["record_versions"], 1)
        self.assertEqual(report["total_candidates"], 1)
        self.assertEqual(report["counts"]["pending"], 1)
        for forbidden in (
            private_text,
            str(candidate["candidate_id"]),
            "reviews/2026/2026-08.md",
            SOURCE_ENTRY_ID,
            "review_sha256",
            "summary",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_candidate_id_is_deterministic_and_plan_is_byte_idempotent(self) -> None:
        self._write_review(candidate_memories=["可能更喜欢低压的户外活动"])
        first = self._plan_one()
        ledger_path = self.root / "insight-decisions.jsonl"
        first_bytes = ledger_path.read_bytes()
        mode = stat.S_IMODE(ledger_path.stat().st_mode)
        self.assertEqual(mode, 0o600)
        self.assertEqual(
            stat.S_IMODE((self.root / ".journal.lock").stat().st_mode),
            0o600,
        )

        second = self._plan_one()
        self.assertEqual(first["candidate_id"], second["candidate_id"])
        self.assertEqual(first["candidate_etag"], second["candidate_etag"])
        self.assertEqual(first_bytes, ledger_path.read_bytes())

        other_root = self.base / "other-journal"
        other_root.mkdir()
        self._write_review(
            root=other_root,
            candidate_memories=["可能更喜欢低压的户外活动"],
        )
        _, other_plan = self._run("plan", root=other_root)
        self.assertEqual(
            first["candidate_id"],
            other_plan["candidates"][0]["candidate_id"],  # type: ignore[index]
        )

    def test_plan_returns_at_most_three_then_advances_after_decisions(self) -> None:
        self._write_review(
            candidate_memories=[f"候选认识 {index}" for index in range(4)],
            planning_implications=[f"规划启示 {index}" for index in range(2)],
        )
        _, planned = self._run("plan")
        self.assertEqual(planned["pending_count"], 6)  # type: ignore[index]
        self.assertEqual(planned["returned"], 3)  # type: ignore[index]
        for candidate in planned["candidates"]:  # type: ignore[index]
            self._run("decide", self._decision_payload(candidate, "reject"))
        _, next_plan = self._run("plan")
        self.assertEqual(next_plan["returned"], 3)  # type: ignore[index]
        first_ids = {item["candidate_id"] for item in planned["candidates"]}  # type: ignore[index]
        next_ids = {item["candidate_id"] for item in next_plan["candidates"]}  # type: ignore[index]
        self.assertTrue(first_ids.isdisjoint(next_ids))

    def test_second_redaction_hides_secrets_and_source_entry_ids(self) -> None:
        token = "sk-" + "A" * 30
        raw_candidate = (
            f"用户的手机号是 13800138000，token: {token}，"
            f"邮箱 me@example.com，来源 {SOURCE_ENTRY_ID}"
        )
        self._write_review(candidate_memories=[raw_candidate])
        result, planned = self._run("plan")
        serialized = result.stdout + (self.root / "insight-decisions.jsonl").read_text(encoding="utf-8")
        for secret in ("13800138000", token, "me@example.com", SOURCE_ENTRY_ID):
            self.assertNotIn(secret, serialized)
        summary = planned["candidates"][0]["summary"]  # type: ignore[index]
        self.assertLessEqual(len(summary), 160)
        self.assertIn("已省略", summary)

    def test_rejected_and_accepted_candidates_do_not_repeat(self) -> None:
        self._write_review(candidate_memories=["可能喜欢安静的早晨"])
        rejected_candidate = self._plan_one()
        _, rejected = self._run(
            "decide", self._decision_payload(rejected_candidate, "reject")
        )
        self.assertEqual(rejected["status"], "rejected")  # type: ignore[index]
        self.assertFalse(rejected["action_required"])  # type: ignore[index]
        _, no_repeat = self._run("plan")
        self.assertEqual(no_repeat["candidates"], [])  # type: ignore[index]

        self._write_review(
            candidate_memories=["可能喜欢安静的早晨", "可能适合小步调整"],
            extra_note="合成回顾已更新",
        )
        _, refreshed_plan = self._run("plan")
        accepted_candidate = refreshed_plan["candidates"][0]  # type: ignore[index]
        _, accepted = self._run(
            "decide", self._decision_payload(accepted_candidate, "accept")
        )
        self.assertEqual(accepted["status"], "awaiting_proposal")  # type: ignore[index]
        self.assertTrue(accepted["action_required"])  # type: ignore[index]
        self.assertFalse(accepted["writes_long_term_files"])  # type: ignore[index]
        _, after_accept = self._run("plan")
        remaining_ids = {
            item["candidate_id"] for item in after_accept["candidates"]  # type: ignore[index]
        }
        self.assertNotIn(accepted_candidate["candidate_id"], remaining_ids)

    def test_recoverable_proposal_lifecycle_and_mark_retry(self) -> None:
        self._write_review(candidate_memories=["可能偏好低压的户外恢复"])
        accepted = self._accept_one()
        proposal_text = "- 稳定偏好：在精力低时优先低压户外恢复。"
        propose_payload = self._proposal_payload(accepted, proposal_text)
        proposed_result, proposed = self._run("propose", propose_payload)
        assert proposed is not None
        self.assertEqual(proposed["status"], "proposed")
        self.assertEqual(proposed["action"], "created")
        self.assertNotIn(proposal_text, proposed_result.stdout)
        self.assertNotIn("USER.md", proposed_result.stdout)
        self.assertEqual(
            proposed["proposal_sha256"],
            insights._proposal_sha256(proposal_text),
        )
        self.assertEqual(
            stat.S_IMODE((self.root / "insight-decisions.jsonl").stat().st_mode),
            0o600,
        )

        _, apply_plan = self._run(
            "apply-plan", self._apply_plan_payload(proposed)
        )
        assert apply_plan is not None
        self.assertEqual(apply_plan["target_file"], "USER.md")
        self.assertEqual(apply_plan["proposal_text"], proposal_text)
        self.assertTrue(apply_plan["read_only"])

        before_failed_mark = (self.root / "insight-decisions.jsonl").read_bytes()
        failed_mark, _ = self._run(
            "mark-applied", self._mark_payload(proposed), expected_code=2
        )
        self.assertNotIn(proposal_text, failed_mark.stderr)
        self.assertEqual(
            before_failed_mark,
            (self.root / "insight-decisions.jsonl").read_bytes(),
        )

        (self.base / "USER.md").write_text(
            "# USER.md\n\n" + proposal_text + "\n", encoding="utf-8"
        )
        mark_payload = self._mark_payload(proposed)
        marked_result, marked = self._run("mark-applied", mark_payload)
        assert marked is not None
        self.assertEqual(marked["status"], "applied")
        self.assertEqual(marked["action"], "updated")
        self.assertFalse(marked["writes_long_term_files"])
        self.assertNotIn(proposal_text, marked_result.stdout)
        self.assertNotIn("USER.md", marked_result.stdout)

        ledger_after_mark = (self.root / "insight-decisions.jsonl").read_bytes()
        _, retry = self._run("mark-applied", mark_payload)
        self.assertEqual(retry["status"], "applied")  # type: ignore[index]
        self.assertEqual(retry["action"], "unchanged")  # type: ignore[index]
        self.assertEqual(
            ledger_after_mark,
            (self.root / "insight-decisions.jsonl").read_bytes(),
        )
        self.assertEqual(
            [row["status"] for row in self._ledger()],
            ["pending", "awaiting_proposal", "proposed", "applied"],
        )

    def test_propose_is_idempotent_and_supports_revision(self) -> None:
        self._write_review(candidate_memories=["可能需要更多恢复空间"])
        accepted = self._accept_one()
        first_payload = self._proposal_payload(
            accepted, "- 长期偏好：预留恢复空间。"
        )
        _, first = self._run("propose", first_payload)
        assert first is not None
        first_bytes = (self.root / "insight-decisions.jsonl").read_bytes()
        _, retried = self._run("propose", first_payload)
        self.assertEqual(retried["action"], "unchanged")  # type: ignore[index]
        self.assertEqual(first_bytes, (self.root / "insight-decisions.jsonl").read_bytes())

        revised_payload = self._proposal_payload(
            first,
            "- 规划原则：每周预留一段无任务恢复时间。",
            target="GOALS.md",
        )
        _, revised = self._run("propose", revised_payload)
        assert revised is not None
        self.assertEqual(revised["action"], "updated")
        self.assertNotEqual(first["proposal_sha256"], revised["proposal_sha256"])
        self._run("apply-plan", self._apply_plan_payload(first), expected_code=2)
        _, current_plan = self._run(
            "apply-plan", self._apply_plan_payload(revised)
        )
        self.assertEqual(current_plan["target_file"], "GOALS.md")  # type: ignore[index]
        self.assertEqual(
            [row["status"] for row in self._ledger()],
            ["pending", "awaiting_proposal", "proposed", "proposed"],
        )

    def test_apply_plan_is_read_only_and_review_drift_supersedes_on_write(self) -> None:
        private_proposal = "- 长期偏好：保留安静时间。"
        self._write_review(candidate_memories=["可能喜欢安静时间"])
        accepted = self._accept_one()
        _, proposed = self._run(
            "propose", self._proposal_payload(accepted, private_proposal)
        )
        assert proposed is not None
        self._write_review(candidate_memories=["更新后的候选"], extra_note="来源漂移")

        before = (self.root / "insight-decisions.jsonl").read_bytes()
        failed_plan, _ = self._run(
            "apply-plan", self._apply_plan_payload(proposed), expected_code=2
        )
        self.assertNotIn(private_proposal, failed_plan.stdout + failed_plan.stderr)
        self.assertEqual(before, (self.root / "insight-decisions.jsonl").read_bytes())

        failed_mark, _ = self._run(
            "mark-applied", self._mark_payload(proposed), expected_code=2
        )
        self.assertNotIn(private_proposal, failed_mark.stdout + failed_mark.stderr)
        old_rows = [
            row
            for row in self._ledger()
            if row["candidate_id"] == proposed["candidate_id"]
        ]
        self.assertEqual(old_rows[-1]["status"], "superseded")
        self.assertEqual(old_rows[-1]["proposal_text"], private_proposal)

    def test_snapshot_inspector_missing_empty_private_and_corrupt(self) -> None:
        expected_counts = {
            "applied": 0,
            "awaiting_proposal": 0,
            "pending": 0,
            "proposed": 0,
            "rejected": 0,
            "superseded": 0,
        }
        for snapshot in ({}, {"journal/insight-decisions.jsonl": b""}, {"journal/insight-decisions.jsonl": b" \n"}):
            with self.subTest(snapshot=snapshot):
                result = insights.inspect_insight_snapshot(snapshot)
                self.assertEqual(result["counts"], expected_counts)
                self.assertEqual(result["total_candidates"], 0)
                self.assertTrue(result["valid"])
                self.assertNotIn("permissions_private", result)

        proposal_text = "- 规划原则：使用低负担节奏。"
        self._write_review(candidate_memories=["可能适合低负担节奏"])
        accepted = self._accept_one()
        self._run("propose", self._proposal_payload(accepted, proposal_text))
        snapshot = {
            "journal/insight-decisions.jsonl": (
                self.root / "insight-decisions.jsonl"
            ).read_bytes()
        }
        result = insights.inspect_insight_snapshot(snapshot)
        self.assertEqual(result["counts"]["proposed"], 1)
        self.assertNotIn(proposal_text, json.dumps(result, ensure_ascii=False))

        private_marker = "SNAPSHOT-PRIVATE-PROPOSAL"
        with self.assertRaises(insights.InsightError) as raised:
            insights.inspect_insight_snapshot(
                {
                    "journal/insight-decisions.jsonl": (
                        '{"private":"' + private_marker + '"}\n'
                    ).encode("utf-8")
                }
            )
        self.assertNotIn(private_marker, str(raised.exception))

    def test_target_symlink_hardlink_and_insecure_ledger_fail_closed(self) -> None:
        proposal_text = "- 稳定偏好：优先安静的恢复。"
        self._write_review(candidate_memories=["可能喜欢安静恢复"])
        accepted = self._accept_one()
        invalid_target = self._proposal_payload(accepted, proposal_text)
        invalid_target["target_file"] = "OTHER.md"
        self._run("propose", invalid_target, expected_code=2)

        user_path = self.base / "USER.md"
        external = self.base / "external-private.md"
        external.write_text("EXTERNAL-MUST-NOT-CHANGE", encoding="utf-8")
        user_path.unlink()
        os.symlink(external, user_path)
        symlink_result, _ = self._run(
            "propose", self._proposal_payload(accepted, proposal_text), expected_code=2
        )
        self.assertNotIn(proposal_text, symlink_result.stdout + symlink_result.stderr)
        self.assertEqual(external.read_text(encoding="utf-8"), "EXTERNAL-MUST-NOT-CHANGE")

        user_path.unlink()
        os.link(external, user_path)
        self._run(
            "propose", self._proposal_payload(accepted, proposal_text), expected_code=2
        )
        user_path.unlink()
        user_path.write_text("# USER.md\n", encoding="utf-8")
        _, proposed = self._run(
            "propose", self._proposal_payload(accepted, proposal_text)
        )
        assert proposed is not None

        ledger_path = self.root / "insight-decisions.jsonl"
        os.chmod(ledger_path, 0o644)
        permission_result, _ = self._run(
            "apply-plan", self._apply_plan_payload(proposed), expected_code=2
        )
        self.assertNotIn(proposal_text, permission_result.stdout + permission_result.stderr)
        self.assertEqual(stat.S_IMODE(ledger_path.stat().st_mode), 0o644)
        snapshot_result = insights.inspect_insight_snapshot(
            {"journal/insight-decisions.jsonl": ledger_path.read_bytes()}
        )
        self.assertTrue(snapshot_result["valid"])

    def test_concurrent_same_proposal_and_mark_are_idempotent(self) -> None:
        proposal_text = "- 稳定偏好：每周保留恢复时间。"
        self._write_review(candidate_memories=["可能需要稳定恢复时间"])
        accepted = self._accept_one()
        payload = json.dumps(
            self._proposal_payload(accepted, proposal_text), ensure_ascii=False
        )
        command = [
            sys.executable,
            str(SCRIPT),
            "propose",
            "--root",
            str(self.root),
            "--input",
            "-",
        ]
        processes = [
            subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            for _ in range(2)
        ]
        outputs = [process.communicate(payload, timeout=20) for process in processes]
        self.assertEqual([process.returncode for process in processes], [0, 0])
        parsed = [json.loads(stdout) for stdout, _stderr in outputs]
        self.assertEqual({item["action"] for item in parsed}, {"created", "unchanged"})
        proposed = next(item for item in parsed if item["status"] == "proposed")
        self.assertEqual(
            [row["status"] for row in self._ledger()],
            ["pending", "awaiting_proposal", "proposed"],
        )

        (self.base / "USER.md").write_text(proposal_text, encoding="utf-8")
        mark_payload = json.dumps(self._mark_payload(proposed), ensure_ascii=False)
        mark_command = command.copy()
        mark_command[2] = "mark-applied"
        mark_processes = [
            subprocess.Popen(
                mark_command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            for _ in range(2)
        ]
        mark_outputs = [
            process.communicate(mark_payload, timeout=20) for process in mark_processes
        ]
        self.assertEqual([process.returncode for process in mark_processes], [0, 0])
        marked = [json.loads(stdout) for stdout, _stderr in mark_outputs]
        self.assertEqual({item["action"] for item in marked}, {"updated", "unchanged"})
        self.assertEqual(
            [row["status"] for row in self._ledger()],
            ["pending", "awaiting_proposal", "proposed", "applied"],
        )

    def test_review_drift_supersedes_old_candidate_and_creates_new_id(self) -> None:
        self._write_review(candidate_memories=["旧候选"])
        old = self._plan_one()
        self._write_review(candidate_memories=["新候选"], extra_note="内容变化")
        new = self._plan_one()
        self.assertNotEqual(old["candidate_id"], new["candidate_id"])

        old_history = [
            row for row in self._ledger() if row["candidate_id"] == old["candidate_id"]
        ]
        self.assertEqual([row["status"] for row in old_history], ["pending", "superseded"])
        self.assertIsNone(old_history[-1]["decided_at"])

    def test_drift_preserves_explicit_decision_history_without_faking_a_new_decision(self) -> None:
        self._write_review(candidate_memories=["已确认前的候选"])
        old = self._plan_one()
        self._run("decide", self._decision_payload(old, "accept"))
        self._write_review(candidate_memories=["更新后的候选"])
        self._run("plan")
        history = [
            row for row in self._ledger() if row["candidate_id"] == old["candidate_id"]
        ]
        self.assertEqual(
            [row["status"] for row in history],
            ["pending", "awaiting_proposal", "superseded"],
        )
        self.assertIsNotNone(history[1]["decided_at"])
        self.assertEqual(history[2]["decided_at"], history[1]["decided_at"])

    def test_invalidated_review_is_not_used_for_planning_or_memory(self) -> None:
        review_path = self._write_review(candidate_memories=["不应继续使用的候选"])
        old = self._plan_one()
        content = review_path.read_text(encoding="utf-8")
        first_line, remainder = content.split("\n", 1)
        review_path.write_text(
            first_line
            + "\n\n> [!WARNING]\n> ⚠️ 来源日记已撤回，本回顾需刷新后再用于规划。\n\n"
            + remainder,
            encoding="utf-8",
        )
        _, planned = self._run("plan")
        self.assertEqual(planned["candidates"], [])  # type: ignore[index]
        old_history = [
            row for row in self._ledger() if row["candidate_id"] == old["candidate_id"]
        ]
        self.assertEqual([row["status"] for row in old_history], ["pending", "superseded"])

    def test_stale_decision_conflicts_after_review_drift(self) -> None:
        self._write_review(candidate_memories=["原候选"])
        old = self._plan_one()
        self._write_review(candidate_memories=["变更后候选"])
        result, _ = self._run(
            "decide",
            self._decision_payload(old, "accept"),
            expected_code=2,
        )
        self.assertIn("状态已变化", result.stderr)
        old_statuses = [
            row["status"]
            for row in self._ledger()
            if row["candidate_id"] == old["candidate_id"]
        ]
        self.assertEqual(old_statuses, ["pending", "superseded"])
        self.assertNotIn("accepted", old_statuses)

    def test_wrong_etag_and_revision_cannot_write(self) -> None:
        self._write_review(candidate_memories=["候选"])
        candidate = self._plan_one()
        before = (self.root / "insight-decisions.jsonl").read_bytes()
        bad = self._decision_payload(candidate, "accept")
        bad["expect_candidate_etag"] = "0" * 64
        self._run("decide", bad, expected_code=2)
        self.assertEqual(before, (self.root / "insight-decisions.jsonl").read_bytes())

        bad = self._decision_payload(candidate, "accept")
        bad["expect_revision"] = 2
        self._run("decide", bad, expected_code=2)
        self.assertEqual(before, (self.root / "insight-decisions.jsonl").read_bytes())

    def test_two_concurrent_decisions_only_one_succeeds(self) -> None:
        self._write_review(candidate_memories=["并发候选"])
        candidate = self._plan_one()
        payload = json.dumps(self._decision_payload(candidate, "accept"), ensure_ascii=False)
        command = [
            sys.executable,
            str(SCRIPT),
            "decide",
            "--root",
            str(self.root),
            "--input",
            "-",
        ]
        first = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        second = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        first_out, first_err = first.communicate(payload, timeout=20)
        second_out, second_err = second.communicate(payload, timeout=20)
        self.assertEqual(sorted([first.returncode, second.returncode]), [0, 2])
        combined = first_out + first_err + second_out + second_err
        self.assertNotIn(SOURCE_ENTRY_ID, combined)
        history = [
            row for row in self._ledger() if row["candidate_id"] == candidate["candidate_id"]
        ]
        self.assertEqual(
            [row["status"] for row in history],
            ["pending", "awaiting_proposal"],
        )

    def test_unknown_fields_duplicate_keys_nan_and_raw_injection_fail_closed(self) -> None:
        private_sentinel = "SHOULD_NOT_ECHO_SECRET"
        result = self._run_raw(
            "plan", json.dumps({"raw": private_sentinel}), expected_code=2
        )
        self.assertNotIn(private_sentinel, result.stderr)
        self._run_raw("plan", '{"x":1,"x":2}', expected_code=2)
        self._run_raw("plan", '{"value":NaN}', expected_code=2)

        self._write_review(candidate_memories=[f"raw: {private_sentinel}"])
        review_result, _ = self._run("plan", expected_code=2)
        self.assertNotIn(private_sentinel, review_result.stdout + review_result.stderr)
        self.assertFalse((self.root / "insight-decisions.jsonl").exists())

    def test_corrupt_ledger_unknown_field_and_duplicate_key_fail_closed(self) -> None:
        self._write_review(candidate_memories=["合成候选"])
        self._plan_one()
        ledger_path = self.root / "insight-decisions.jsonl"
        row = self._ledger()[0]
        row["raw"] = "不应进入台账的原文"
        ledger_path.write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")
        result, _ = self._run("status", expected_code=2)
        self.assertNotIn("不应进入台账的原文", result.stderr)

        ledger_path.write_text('{"candidate_id":"x","candidate_id":"y"}\n', encoding="utf-8")
        self._run("status", expected_code=2)

    def test_list_and_status_never_return_candidate_summary_or_source_metadata(self) -> None:
        private_text = "唯一候选私密摘要"
        self._write_review(candidate_memories=[private_text])
        self._plan_one()
        listed, list_payload = self._run("list")
        status_result, _ = self._run("status")
        combined = listed.stdout + status_result.stdout
        self.assertNotIn(private_text, combined)
        self.assertNotIn(SOURCE_ENTRY_ID, combined)
        self.assertNotIn("review_file", combined)
        self.assertNotIn("review_sha256", combined)
        self.assertNotIn("candidate_id", combined)
        self.assertEqual(list_payload["total_candidates"], 1)  # type: ignore[index]
        self.assertEqual(list_payload["counts"]["pending"], 1)  # type: ignore[index]

    def test_decision_input_is_strict_and_retry_is_not_a_second_decision(self) -> None:
        self._write_review(candidate_memories=["幂等候选"])
        candidate = self._plan_one()
        payload = self._decision_payload(candidate, "reject")
        payload["raw"] = "不允许"
        self._run("decide", payload, expected_code=2)

        good = self._decision_payload(candidate, "reject")
        self._run("decide", good)
        self._run("decide", good, expected_code=2)
        history = [
            row for row in self._ledger() if row["candidate_id"] == candidate["candidate_id"]
        ]
        self.assertEqual([row["status"] for row in history], ["pending", "rejected"])

    def test_public_inspector_rejects_ledger_and_root_symlinks_without_leak(self) -> None:
        sentinel = "SYMLINK-LEDGER-PRIVATE-CONTENT"
        external = self.base / "private-ledger-target.jsonl"
        external.write_text(sentinel, encoding="utf-8")
        os.symlink(external, self.root / "insight-decisions.jsonl")
        with self.assertRaises(insights.InsightError) as context:
            insights.inspect_insight_ledger(self.root)
        message = str(context.exception)
        self.assertNotIn(sentinel, message)
        self.assertNotIn(str(external), message)

        linked_root = self.base / "linked-journal"
        os.symlink(self.root, linked_root)
        with self.assertRaises(insights.InsightError) as context:
            insights.inspect_insight_ledger(linked_root)
        self.assertNotIn(str(self.root), str(context.exception))

    def test_plan_rejects_symlinked_review_tree_at_every_level(self) -> None:
        sentinel = "SYMLINK-REVIEW-PRIVATE-CONTENT"
        for level in ("reviews", "year", "file"):
            with self.subTest(level=level):
                case_root = self.base / f"case-{level}"
                case_root.mkdir()
                external_root = self.base / f"external-{level}"
                external_root.mkdir()
                external_file = self._write_review(
                    root=external_root,
                    candidate_memories=[sentinel],
                )
                if level == "reviews":
                    os.symlink(external_root / "reviews", case_root / "reviews")
                elif level == "year":
                    (case_root / "reviews").mkdir()
                    os.symlink(
                        external_root / "reviews" / "2026",
                        case_root / "reviews" / "2026",
                    )
                else:
                    (case_root / "reviews" / "2026").mkdir(parents=True)
                    os.symlink(
                        external_file,
                        case_root / "reviews" / "2026" / "2026-08.md",
                    )
                result, _ = self._run("plan", root=case_root, expected_code=2)
                combined = result.stdout + result.stderr
                self.assertNotIn(sentinel, combined)
                self.assertNotIn(str(external_root), combined)
                self.assertFalse((case_root / "insight-decisions.jsonl").exists())

    def test_plan_rejects_symlinked_lock_without_touching_target(self) -> None:
        sentinel = "LOCK-TARGET-MUST-NOT-CHANGE"
        external = self.base / "private-lock-target"
        external.write_text(sentinel, encoding="utf-8")
        os.symlink(external, self.root / ".journal.lock")
        result, _ = self._run("plan", expected_code=2)
        self.assertNotIn(sentinel, result.stdout + result.stderr)
        self.assertNotIn(str(external), result.stdout + result.stderr)
        self.assertEqual(external.read_text(encoding="utf-8"), sentinel)

    def test_in_place_review_change_during_read_fails_closed(self) -> None:
        sentinel = "TOCTOU-PRIVATE-CANDIDATE"
        review_path = self._write_review(candidate_memories=[sentinel])
        real_read = os.read
        changed = False

        def read_then_change(descriptor: int, size: int) -> bytes:
            nonlocal changed
            data = real_read(descriptor, size)
            if data and not changed:
                changed = True
                with review_path.open("a", encoding="utf-8") as handle:
                    handle.write("\n合成并发变更\n")
            return data

        with mock.patch.object(insights.os, "read", side_effect=read_then_change):
            with self.assertRaises(insights.InsightError) as context:
                insights.plan(self.root)
        message = str(context.exception)
        self.assertNotIn(sentinel, message)
        self.assertNotIn(str(review_path), message)
        self.assertFalse((self.root / "insight-decisions.jsonl").exists())

    def test_low_level_read_and_atomic_write_errors_are_generic_and_cleanup_temp(self) -> None:
        sentinel = "LOW-LEVEL-OSERROR-PRIVATE-PATH"
        (self.root / "reviews").mkdir()
        with mock.patch.object(insights.os, "listdir", side_effect=OSError(sentinel)):
            with self.assertRaises(insights.InsightError) as context:
                insights.plan(self.root)
        self.assertNotIn(sentinel, str(context.exception))
        self.assertNotIn(str(self.root), str(context.exception))

        self._write_review(candidate_memories=["写入失败时也不得泄露"])
        with mock.patch.object(insights.os, "replace", side_effect=OSError(sentinel)):
            with self.assertRaises(insights.InsightError) as context:
                insights.plan(self.root)
        self.assertNotIn(sentinel, str(context.exception))
        self.assertNotIn(str(self.root), str(context.exception))
        self.assertFalse((self.root / "insight-decisions.jsonl").exists())
        self.assertEqual(
            list(self.root.glob(".insight-decisions.jsonl.*.tmp")),
            [],
        )


if __name__ == "__main__":
    unittest.main()
