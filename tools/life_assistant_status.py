#!/usr/bin/env python3
"""生活助手工作区的零依赖健康检查。

该工具只输出状态、计数和可执行的维护提示，不输出日记原文、
日记标题/摘要、候选认识内容、阶段动作值或 Sites project_id。
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import sqlite3
import stat
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, datetime, time, timezone
from datetime import timedelta
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    from tools.journal_integrity import JournalIntegrityError, inspect_journal_graph
except ModuleNotFoundError:  # Direct execution from tools/.
    from journal_integrity import JournalIntegrityError, inspect_journal_graph

try:
    from tools.phase_review import PhaseReviewError, inspect_phase_reviews
except ModuleNotFoundError:  # Direct execution from tools/.
    from phase_review import PhaseReviewError, inspect_phase_reviews

try:
    from tools.phase_actions import PhaseActionError, inspect_phase_actions
except ModuleNotFoundError:  # Direct execution from tools/.
    from phase_actions import PhaseActionError, inspect_phase_actions

try:
    from tools.journal_insights import InsightError, inspect_insight_ledger
except ModuleNotFoundError:  # Direct execution from tools/.
    from journal_insights import InsightError, inspect_insight_ledger

try:
    from tools.google_sheets_state import GoogleSheetsStateError, inspect_state as inspect_google_sheets_state
except ModuleNotFoundError:  # Direct execution from tools/.
    from google_sheets_state import GoogleSheetsStateError, inspect_state as inspect_google_sheets_state

try:
    from tools.product_surfaces import SURFACES_PATH, ProductSurfaceError, load_product_surfaces
except ModuleNotFoundError:  # Direct execution from tools/.
    from product_surfaces import SURFACES_PATH, ProductSurfaceError, load_product_surfaces

try:
    from tools.create_backup import (
        LEGACY_GOVERNANCE_LINK,
        LEGACY_GOVERNANCE_TARGET,
        legacy_governance_link_is_valid,
    )
except ModuleNotFoundError:  # Direct execution from tools/.
    from create_backup import (
        LEGACY_GOVERNANCE_LINK,
        LEGACY_GOVERNANCE_TARGET,
        legacy_governance_link_is_valid,
    )


DEFAULT_ROOT = Path(__file__).resolve().parents[1]
WORKBOOK = "outputs/019fb832-be4f-74f1-add5-58cb6fb6fc09/生活计划表.xlsx"
WORKBOOK_SYNC_STATE = "outputs/019fb832-be4f-74f1-add5-58cb6fb6fc09/生活计划表.sync-state.json"
WORKBOOK_SYNC_RECEIPT_FIELDS = {
    "schema_version",
    "workbook_sha256",
    "sources",
    "synced_at",
}
WORKBOOK_SYNC_SOURCE_FIELDS = {"path_category", "present", "sha256"}
WORKBOOK_SYNC_SOURCES = {
    "journal": ("journal/index.jsonl", "journal-index-jsonl"),
    "daily": ("records/daily-checkins.jsonl", "daily-checkins-jsonl"),
    "weekly": ("records/weekly-reviews.jsonl", "weekly-reviews-jsonl"),
}
WORKBOOK_SYNC_TIMESTAMP_PATTERN = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"
)
AUTOMATION_SPEC = "automations/生活状态回访.md"
AUTOMATION_REGISTRY = "automations/registry.json"
AUTOMATION_PROMPT = "automations/生活状态回访.prompt.txt"
AUTOMATION_KEY = "life-checkin"
DAILY_CHECKINS = "records/daily-checkins.jsonl"
WEEKLY_REVIEWS = "records/weekly-reviews.jsonl"
PHASE_REVIEWS = "records/phase-reviews.jsonl"
PHASE_ACTIONS = "records/phase-actions.jsonl"
JOURNAL_REVIEW_POLICY = "journal/review-policy.json"
JOURNAL_REVIEW_POLICY_FIELDS = {
    "schema_version",
    "timezone",
    "trial_weekly_start",
    "trial_weekly_end",
    "long_term_cadence",
    "long_term_effective_from",
    "decided_on",
}
JOURNAL_REVIEW_CADENCES = {
    "pending_user_choice",
    "weekly",
    "monthly",
    "on_demand",
    "paused",
}
JOURNAL_REVIEW_TIMEZONE = "Asia/Shanghai"
JOURNAL_TRIAL_WEEKLY_START = "2026-08-02"
JOURNAL_TRIAL_WEEKLY_END = "2026-08-14"
STALE_REVIEW_MARKERS = (
    "来源日记已撤回，本回顾需刷新",
    "来源日记已更正，本回顾需刷新",
)
WITHDRAWN_SOURCE_MARKERS = (
    "> 状态：已撤回；原文仍保留，但不再用于可读索引、回顾或长期记忆。",
    "> 状态：已撤回；不再用于索引、回顾或长期记忆。",
)
JOURNAL_ENTRY_LIST_FIELDS = (
    "facts",
    "feelings",
    "people",
    "places",
    "themes",
    "tags",
    "planning_clues",
    "inferences",
)
JOURNAL_INDEX_REQUIRED_FIELDS = frozenset(
    {
        "id",
        "date",
        "time",
        "time_precision",
        "title",
        "summary",
        *JOURNAL_ENTRY_LIST_FIELDS,
        "source",
        "privacy",
        "file",
        "status",
        "weekly_reviews",
        "monthly_reviews",
        "amendments",
        "invalidated_reviews",
        "recorded_at",
    }
)
JOURNAL_INDEX_OPTIONAL_FIELDS = frozenset(
    {
        "withdrawn_at",
        "original_date",
        "original_time",
        "original_time_precision",
    }
)
JOURNAL_INDEX_ALLOWED_FIELDS = (
    JOURNAL_INDEX_REQUIRED_FIELDS | JOURNAL_INDEX_OPTIONAL_FIELDS
)
BACKUP_PREFIX = "生活助手-完整备份-"
BACKUP_EXCLUDED_DIRS = {
    ".git",
    ".worktrees",
    ".mypy_cache",
    ".next",
    ".nox",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".venv",
    ".vinext",
    ".validator-venv",
    ".wrangler",
    "__pycache__",
    "backups",
    "dist",
    "htmlcov",
    "node_modules",
    "out",
    "venv",
}
BACKUP_EXCLUDED_FILES = {
    ".coverage",
    ".DS_Store",
    ".daily-checkins.lock",
    ".journal.lock",
    ".phase-actions.lock",
    ".phase-reviews.lock",
    ".weekly-reviews.lock",
    "STATUS.md",
}
BACKUP_EXCLUDED_SUFFIXES = {".pyc", ".pyo"}
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
BACKUP_PATTERN = re.compile(
    rf"^{re.escape(BACKUP_PREFIX)}(\d{{4}}-\d{{2}}-\d{{2}})"
    r"(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?\.zip$"
)
GOAL_DATE_PATTERN = re.compile(
    r"^-\s*(下次复盘|准备度复盘|节奏复盘)[：:]\s*(\d{4}-\d{2}-\d{2})\s*(?:[;；].*)?$",
    re.MULTILINE,
)
AUTOMATION_CONTRACT_FIELDS = {
    "key",
    "name",
    "kind",
    "desired_status",
    "timezone",
    "local_time",
    "start",
    "end",
    "runtime_time_basis",
    "max_scheduler_jitter_seconds",
    "prompt_file",
    "prompt_sha256",
}

CORE_FILES = (
    "AGENTS.md",
    "USER.md",
    "MEMORY.md",
    "GOALS.md",
    "PROJECT_CONTEXT.md",
    "PORTABILITY.md",
    "README.md",
    "GIT_WORKFLOW.md",
    "docs/governance/agent-user-project-development-standard.md",
    "docs/knowledge-base/README.md",
    "docs/knowledge-base/生活助手-LifeConsole-1.0.0/生活助手-LifeConsole-1.0.0.md",
    "docs/knowledge-base/生活助手-LifeConsole-1.0.0/项目管理-生活助手-LifeConsole-1.0.0.md",
    "docs/knowledge-base/生活助手-LifeConsole-1.0.0/需求评审报告-生活助手-LifeConsole-1.0.0.md",
    "docs/knowledge-base/生活助手-LifeConsole-1.0.0/README.md",
    "docs/knowledge-base/生活助手-LifeConsole-1.0.0/设计方案-生活助手-LifeConsole-1.0.0.md",
    "docs/knowledge-base/生活助手-LifeConsole-1.0.0/技术方案-生活助手-LifeConsole-1.0.0.md",
    "docs/knowledge-base/生活助手-LifeConsole-1.0.0/工程评审与验收-生活助手-LifeConsole-1.0.0.md",
    "docs/operations/README.md",
    "docs/operations/product-surfaces.json",
    "skills/improve-daily-life/SKILL.md",
    AUTOMATION_SPEC,
    AUTOMATION_REGISTRY,
    AUTOMATION_PROMPT,
    WORKBOOK,
    "journal/README.md",
    "journal/PRIVACY.md",
    "journal/INDEX.md",
    JOURNAL_REVIEW_POLICY,
    "records/README.md",
    "records/apple-health-latest.example.txt",
    "tools/validate_project.py",
    "tools/check_project_governance.py",
    "tools/test_project_governance.py",
    "tools/create_backup.py",
    "tools/verify_backup.py",
    "tools/portability_doctor.py",
    "tools/daily_checkin.py",
    "tools/weekly_review.py",
    "tools/journal_manager.py",
    "tools/journal_integrity.py",
    "tools/test_journal_integrity.py",
    "tools/journal_review_policy.py",
    "tools/test_journal_review_policy.py",
    "tools/phase_review.py",
    "tools/test_phase_review.py",
    "tools/phase_actions.py",
    "tools/test_phase_actions.py",
    "tools/journal_insights.py",
    "tools/test_journal_insights.py",
    "tools/test_journal_workbook_e2e.mjs",
    "tools/life_plan_records.mjs",
    "tools/update_life_plan_journal.mjs",
    "tools/life_assistant_status.py",
    "tools/product_surfaces.py",
    "tools/test_product_surfaces.py",
)

SEVERITY = {"PASS": 0, "ATTENTION": 1, "FAIL": 2}
SECTION_TITLES = {
    "core": "核心文件",
    "goals": "目标节点",
    "journal": "生活记录与回顾",
    "automation": "自动化",
    "site": "展示层",
    "backup": "迁移与备份",
}


class Section:
    """收集单个检查区域的结果，但不携带用户原始内容。"""

    def __init__(self) -> None:
        self.status = "PASS"
        self.messages: list[str] = []
        self.metrics: dict[str, Any] = {}
        self.actions: list[tuple[str, str]] = []

    def add(
        self,
        status: str,
        message: str,
        action: str | None = None,
    ) -> None:
        if SEVERITY[status] > SEVERITY[self.status]:
            self.status = status
        self.messages.append(message)
        if action:
            self.actions.append((status, action))

    def export(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "metrics": self.metrics,
            "messages": self.messages,
        }


def _valid_date(value: Any) -> date | None:
    if not isinstance(value, str) or not DATE_PATTERN.fullmatch(value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _json_object_without_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _reject_nonfinite_json_constant(_: str) -> None:
    raise ValueError("non-finite JSON constant")


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _sync_file_snapshot(path: Path) -> tuple[bool, bytes]:
    """读取普通文件的存在性与精确字节；不在异常中携带路径或内容。"""

    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return False, b""
    except OSError as exc:
        raise ValueError("sync file unavailable") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise ValueError("sync file is not regular")
    try:
        content = path.read_bytes()
    except OSError as exc:
        raise ValueError("sync file unreadable") from exc
    return True, content


def _valid_workbook_sync_timestamp(value: Any) -> bool:
    if not isinstance(value, str) or not WORKBOOK_SYNC_TIMESTAMP_PATTERN.fullmatch(value):
        return False
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return False
    return parsed.strftime("%Y-%m-%dT%H:%M:%SZ") == value


def _inspect_workbook_sync_state(
    root: Path,
) -> tuple[dict[str, Any], tuple[str, str, str] | None]:
    """严格核对工作簿同步收据，只返回状态和通用错误。"""

    metrics: dict[str, Any] = {
        "workbook_sync_due": False,
        "workbook_sync_receipt_present": False,
        "workbook_sync_receipt_valid": False,
        "workbook_sync_receipt_matches": False,
        "workbook_sync_receipt_state": "not_required_empty",
    }
    workbook_path = root / WORKBOOK
    receipt_path = root / WORKBOOK_SYNC_STATE
    try:
        workbook_present, workbook_bytes = _sync_file_snapshot(workbook_path)
        source_snapshots = {
            key: _sync_file_snapshot(root / relative)
            for key, (relative, _) in WORKBOOK_SYNC_SOURCES.items()
        }
    except ValueError:
        metrics["workbook_sync_due"] = True
        metrics["workbook_sync_receipt_state"] = "unsafe_current_file"
        return metrics, (
            "FAIL",
            "生活记录源或生活计划工作簿不是可安全核对的普通文件。",
            "修复文件类型或权限后重新运行工作簿同步。",
        )

    if not workbook_present:
        metrics["workbook_sync_due"] = True
        metrics["workbook_sync_receipt_state"] = "workbook_missing"
        return metrics, (
            "FAIL",
            "生活计划工作簿缺失，无法核对同步状态。",
            "恢复工作簿后重新运行工作簿同步。",
        )

    nonempty_source_present = any(
        present and bool(content) for present, content in source_snapshots.values()
    )
    try:
        receipt_metadata = receipt_path.lstat()
    except FileNotFoundError:
        if nonempty_source_present:
            metrics["workbook_sync_due"] = True
            metrics["workbook_sync_receipt_state"] = "missing_with_source_data"
            return metrics, (
                "ATTENTION",
                "生活记录已有内容，但生活计划工作簿缺少可验证的同步收据。",
                "运行工作簿同步工具，生成与源字节和工作簿字节绑定的同步收据。",
            )
        return metrics, None
    except OSError:
        metrics["workbook_sync_due"] = True
        metrics["workbook_sync_receipt_state"] = "invalid"
        return metrics, (
            "FAIL",
            "生活计划工作簿同步收据无法安全读取。",
            "保留现场排查，修复后重新运行工作簿同步。",
        )

    metrics["workbook_sync_receipt_present"] = True
    if stat.S_ISLNK(receipt_metadata.st_mode) or not stat.S_ISREG(receipt_metadata.st_mode):
        metrics["workbook_sync_due"] = True
        metrics["workbook_sync_receipt_state"] = "invalid"
        return metrics, (
            "FAIL",
            "生活计划工作簿同步收据结构无效或不是普通项目文件。",
            "移除不安全收据并重新运行工作簿同步。",
        )

    try:
        receipt_bytes = receipt_path.read_bytes()
        if len(receipt_bytes) > 65_536:
            raise ValueError("receipt too large")
        receipt_text = receipt_bytes.decode("utf-8")
        payload = json.loads(
            receipt_text,
            object_pairs_hook=_json_object_without_duplicate_keys,
            parse_constant=_reject_nonfinite_json_constant,
        )
        if not isinstance(payload, dict) or set(payload) != WORKBOOK_SYNC_RECEIPT_FIELDS:
            raise ValueError("invalid receipt fields")
        if type(payload["schema_version"]) is not int or payload["schema_version"] != 1:
            raise ValueError("invalid receipt version")
        workbook_sha256 = payload["workbook_sha256"]
        if not isinstance(workbook_sha256, str) or not SHA256_PATTERN.fullmatch(workbook_sha256):
            raise ValueError("invalid workbook hash")
        if not _valid_workbook_sync_timestamp(payload["synced_at"]):
            raise ValueError("invalid sync timestamp")
        sources = payload["sources"]
        if not isinstance(sources, dict) or set(sources) != set(WORKBOOK_SYNC_SOURCES):
            raise ValueError("invalid receipt sources")
        for key, (_, expected_category) in WORKBOOK_SYNC_SOURCES.items():
            source = sources[key]
            if not isinstance(source, dict) or set(source) != WORKBOOK_SYNC_SOURCE_FIELDS:
                raise ValueError("invalid receipt source fields")
            if source["path_category"] != expected_category or type(source["present"]) is not bool:
                raise ValueError("invalid receipt source metadata")
            source_sha256 = source["sha256"]
            if source["present"]:
                if not isinstance(source_sha256, str) or not SHA256_PATTERN.fullmatch(source_sha256):
                    raise ValueError("invalid receipt source hash")
            elif source_sha256 is not None:
                raise ValueError("absent source cannot have hash")
    except (OSError, UnicodeError, json.JSONDecodeError, KeyError, TypeError, ValueError):
        metrics["workbook_sync_due"] = True
        metrics["workbook_sync_receipt_state"] = "invalid"
        return metrics, (
            "FAIL",
            "生活计划工作簿同步收据结构无效或无法安全读取。",
            "保留现场排查，确认无误后重新运行工作簿同步。",
        )

    metrics["workbook_sync_receipt_valid"] = True
    workbook_matches = _sha256_bytes(workbook_bytes) == payload["workbook_sha256"]
    sources_match = True
    for key, (present, content) in source_snapshots.items():
        recorded = payload["sources"][key]
        if recorded["present"] != present:
            sources_match = False
            break
        current_hash = _sha256_bytes(content) if present else None
        if recorded["sha256"] != current_hash:
            sources_match = False
            break
    receipt_matches = workbook_matches and sources_match
    metrics["workbook_sync_receipt_matches"] = receipt_matches
    metrics["workbook_sync_due"] = not receipt_matches
    metrics["workbook_sync_receipt_state"] = "current" if receipt_matches else "stale"
    if receipt_matches:
        return metrics, None
    return metrics, (
        "ATTENTION",
        "生活记录源或生活计划工作簿字节与最近同步收据不一致。",
        "重新运行工作簿同步并验证三个派生视图。",
    )


def _inspect_google_display_state(
    root: Path,
) -> tuple[dict[str, Any], tuple[str, str, str] | None]:
    """核对私密 Google 表格派生展示；不返回表格标识或内容。"""

    # 没有新配置的恢复副本仍按旧 XLSX 收据检查；一旦配置存在，就只以
    # Google 展示状态为准。这样不会把归档 XLSX 误当作新系统真相源。
    if not (root / "integrations/google-sheets.json").exists():
        return _inspect_workbook_sync_state(root)
    try:
        state = inspect_google_sheets_state(root)
    except (GoogleSheetsStateError, OSError, ValueError):
        return {
            "display_backend": "google_sheets",
            "google_sheet_sync_due": True,
            "google_sheet_sync_state": "invalid",
        }, (
            "FAIL",
            "Google 表格展示配置或同步收据无效。",
            "修复 integrations/google-sheets.json 或同步收据后重新检查。",
        )
    name = state["state"]
    metrics = {
        "display_backend": "google_sheets",
        "google_sheet_sync_due": name not in {"current", "paused"},
        "google_sheet_sync_state": name,
    }
    if name in {"current", "paused"}:
        return metrics, None
    if name == "pending_connection":
        return metrics, (
            "ATTENTION",
            "iCloud 真相源正常，但私人 Google 表格展示层尚未完成连接。",
            "连接个人 Google Drive 后导入八页生活计划表并完成首次读回校验。",
        )
    if name == "pending_initial_sync":
        message = "私人 Google 表格已连接，但尚无可验证的首次同步收据。"
    else:
        message = "iCloud 记录已变化，私人 Google 表格展示层等待刷新。"
    return metrics, (
        "ATTENTION",
        message,
        "按确定性载荷刷新受管范围、读回校验并写入成功收据。",
    )


def _load_journal_review_policy(
    root: Path,
) -> tuple[dict[str, Any] | None, str | None]:
    """读取严格的日记整理节奏策略，不在错误中暴露文件内容。"""

    path = root / JOURNAL_REVIEW_POLICY
    if path.is_symlink() or not path.is_file():
        return None, "日记整理节奏策略缺失或不是普通项目文件。"
    try:
        payload = json.loads(
            _read_text(path),
            object_pairs_hook=_json_object_without_duplicate_keys,
        )
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
        return None, "日记整理节奏策略无法安全读取。"
    if not isinstance(payload, dict) or set(payload) != JOURNAL_REVIEW_POLICY_FIELDS:
        return None, "日记整理节奏策略结构无效。"

    schema_version = payload.get("schema_version")
    timezone_name = payload.get("timezone")
    trial_start_raw = payload.get("trial_weekly_start")
    trial_end_raw = payload.get("trial_weekly_end")
    cadence = payload.get("long_term_cadence")
    effective_raw = payload.get("long_term_effective_from")
    decided_raw = payload.get("decided_on")
    if (
        isinstance(schema_version, bool)
        or not isinstance(schema_version, int)
        or schema_version != 1
        or timezone_name != JOURNAL_REVIEW_TIMEZONE
        or trial_start_raw != JOURNAL_TRIAL_WEEKLY_START
        or trial_end_raw != JOURNAL_TRIAL_WEEKLY_END
        or not isinstance(cadence, str)
        or cadence not in JOURNAL_REVIEW_CADENCES
    ):
        return None, "日记整理节奏策略结构无效。"

    trial_start = _valid_date(trial_start_raw)
    trial_end = _valid_date(trial_end_raw)
    if trial_start is None or trial_end is None or trial_start > trial_end:
        return None, "日记整理节奏策略日期无效。"
    if cadence == "pending_user_choice":
        if effective_raw is not None or decided_raw is not None:
            return None, "日记整理节奏策略日期与当前选择不一致。"
    else:
        effective_date = _valid_date(effective_raw)
        decided_date = _valid_date(decided_raw)
        if (
            effective_date is None
            or decided_date is None
            or decided_date > effective_date
        ):
            return None, "日记整理节奏策略日期与当前选择不一致。"
    return payload, None


def _effective_review_cadence(policy: dict[str, Any] | None, today: date) -> str:
    if policy is None:
        return "invalid"
    trial_start = date.fromisoformat(policy["trial_weekly_start"])
    trial_end = date.fromisoformat(policy["trial_weekly_end"])
    if trial_start <= today <= trial_end:
        return "trial_weekly"

    cadence = policy["long_term_cadence"]
    if cadence == "pending_user_choice":
        return cadence
    effective_from = date.fromisoformat(policy["long_term_effective_from"])
    if today < effective_from:
        return "not_yet_effective"
    return cadence


def _safe_relative_path(value: Any, *, prefix: str, suffix: str) -> Path | None:
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = Path(value)
    if candidate.is_absolute() or ".." in candidate.parts:
        return None
    if not candidate.parts or candidate.parts[0] != prefix:
        return None
    if candidate.suffix.lower() != suffix:
        return None
    return candidate


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_stream(chunks: Iterable[bytes]) -> str:
    digest = hashlib.sha256()
    for chunk in chunks:
        digest.update(chunk)
    return digest.hexdigest()


def _check_core(root: Path) -> Section:
    section = Section()
    missing = [relative for relative in CORE_FILES if not (root / relative).is_file()]
    section.metrics = {
        "required": len(CORE_FILES),
        "present": len(CORE_FILES) - len(missing),
        "missing": len(missing),
    }
    if missing:
        for relative in missing:
            section.add(
                "FAIL",
                f"缺少核心文件：{relative}",
                "恢复缺失的核心文件后重新运行健康检查。",
            )
    else:
        section.add("PASS", f"核心文件完整（{len(CORE_FILES)}/{len(CORE_FILES)}）。")
    return section


def _check_goals(root: Path, today: date) -> Section:
    section = Section()
    path = root / "GOALS.md"
    if not path.is_file():
        section.metrics = {"total": 0, "upcoming": 0, "overdue": 0, "future": 0}
        section.add("FAIL", "无法读取目标台账。", "恢复 GOALS.md。")
        return section
    try:
        text = _read_text(path)
    except (OSError, UnicodeError):
        section.metrics = {"total": 0, "upcoming": 0, "overdue": 0, "future": 0}
        section.add("FAIL", "目标台账无法以 UTF-8 读取。", "修复 GOALS.md 的编码或访问问题。")
        return section

    nodes: list[dict[str, Any]] = []
    invalid_count = 0
    for label, raw_date in GOAL_DATE_PATTERN.findall(text):
        parsed = _valid_date(raw_date)
        if parsed is None:
            invalid_count += 1
            continue
        days_until = (parsed - today).days
        if days_until < 0:
            classification = "overdue"
        elif days_until <= 7:
            classification = "upcoming"
        else:
            classification = "future"
        nodes.append(
            {
                "kind": label,
                "date": raw_date,
                "classification": classification,
                "days_until": days_until,
            }
        )

    counts = {
        "upcoming": sum(item["classification"] == "upcoming" for item in nodes),
        "overdue": sum(item["classification"] == "overdue" for item in nodes),
        "future": sum(item["classification"] == "future" for item in nodes),
    }
    section.metrics = {"total": len(nodes), **counts, "nodes": nodes}
    if invalid_count:
        section.add("FAIL", f"有 {invalid_count} 个复盘日期无法解析。", "修正 GOALS.md 中的复盘日期。")
    if not nodes:
        section.add("ATTENTION", "未找到可跟踪的复盘节点。", "为当前重点或候选目标补充复盘日期。")
    else:
        section.add(
            "PASS",
            f"已识别 {len(nodes)} 个复盘节点（近期 {counts['upcoming']}、"
            f"逾期 {counts['overdue']}、未来 {counts['future']}）。",
        )
    if counts["overdue"]:
        section.add(
            "ATTENTION",
            f"有 {counts['overdue']} 个复盘节点已过期。",
            "下次对话时优先完成最早的逾期复盘。",
        )
    if counts["upcoming"]:
        section.add(
            "ATTENTION",
            f"有 {counts['upcoming']} 个复盘节点在 7 天内。",
            "在到期时用现有记录做一次低负担复盘。",
        )
    return section


def _load_journal_records(path: Path) -> tuple[list[dict[str, Any]], str | None]:
    if not path.exists():
        return [], None
    try:
        lines = _read_text(path).splitlines()
    except (OSError, UnicodeError):
        return [], "日记机器索引无法以 UTF-8 读取。"
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            return [], f"日记机器索引第 {line_number} 行不是有效 JSON。"
        if not isinstance(record, dict):
            return [], f"日记机器索引第 {line_number} 行必须是对象。"
        records.append(record)
    return records, None


def _journal_entry_block(content: str, identifier: str) -> str | None:
    """Return only the target entry block; never infer state from a sibling."""

    marker = f"<!-- journal-id: {identifier} -->"
    marker_matches = list(
        re.finditer(rf"(?m)^{re.escape(marker)}[ \t]*$", content)
    )
    if len(marker_matches) != 1:
        return None
    marker_position = marker_matches[0].start()
    heading_position = content.rfind("\n## ", 0, marker_position)
    if heading_position < 0:
        heading_position = 0 if content.startswith("## ") else -1
    else:
        heading_position += 1
    if heading_position < 0:
        return None
    next_heading = content.find("\n## ", marker_position + len(marker))
    block_end = len(content) if next_heading < 0 else next_heading
    return content[heading_position:block_end]


def _journal_withdrawal_state_count(block: str) -> int:
    return sum(
        len(list(re.finditer(rf"(?m)^{re.escape(marker)}[ \t]*$", block)))
        for marker in WITHDRAWN_SOURCE_MARKERS
    )


def _journal_timestamp_valid(value: Any) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return False
    return parsed.tzinfo is not None and parsed.utcoffset() is not None


def _journal_string_list_valid(value: Any) -> bool:
    return (
        isinstance(value, list)
        and all(isinstance(item, str) and item == " ".join(item.split()) and item for item in value)
        and len(value) == len(set(value))
    )


def _journal_index_shape_valid(record: dict[str, Any]) -> bool:
    fields = set(record)
    if not JOURNAL_INDEX_REQUIRED_FIELDS.issubset(fields) or not fields.issubset(
        JOURNAL_INDEX_ALLOWED_FIELDS
    ):
        return False
    identifier = record.get("id")
    if (
        not isinstance(identifier, str)
        or not identifier
        or identifier != " ".join(identifier.split())
    ):
        return False
    if record.get("source") not in {"explicit", "implicit"}:
        return False
    if record.get("status") not in {"active", "withdrawn"}:
        return False
    if (record.get("status") == "withdrawn") != ("withdrawn_at" in fields):
        return False
    if not isinstance(record.get("title"), str) or not record["title"].strip():
        return False
    if not isinstance(record.get("summary"), str):
        return False
    if not isinstance(record.get("file"), str) or not record["file"].strip():
        return False
    for field in (
        *JOURNAL_ENTRY_LIST_FIELDS,
        "weekly_reviews",
        "monthly_reviews",
        "invalidated_reviews",
    ):
        if not _journal_string_list_valid(record.get(field)):
            return False
    amendments = record.get("amendments")
    if not isinstance(amendments, list):
        return False
    amendment_ids: set[str] = set()
    for amendment in amendments:
        if not isinstance(amendment, dict) or set(amendment) != {"id", "timestamp"}:
            return False
        amendment_id_value = amendment.get("id")
        if (
            not isinstance(amendment_id_value, str)
            or not amendment_id_value
            or amendment_id_value in amendment_ids
            or not _journal_timestamp_valid(amendment.get("timestamp"))
        ):
            return False
        amendment_ids.add(amendment_id_value)
    if not _journal_timestamp_valid(record.get("recorded_at")):
        return False
    if "withdrawn_at" in record and not _journal_timestamp_valid(record.get("withdrawn_at")):
        return False
    if "original_date" in record and _valid_date(record.get("original_date")) is None:
        return False
    original_time_fields = {"original_time", "original_time_precision"}.intersection(fields)
    if original_time_fields and original_time_fields != {
        "original_time",
        "original_time_precision",
    }:
        return False
    if original_time_fields:
        original_time = record.get("original_time")
        original_precision = record.get("original_time_precision")
        if original_precision == "unknown":
            if original_time is not None:
                return False
        elif (
            original_precision not in {"exact", "approximate"}
            or not isinstance(original_time, str)
            or TIME_PATTERN.fullmatch(original_time) is None
        ):
            return False
    return True


def _pending_purge_identifier(operation_path: Path, payload: Any) -> str:
    expected_fields = {
        "schema_version",
        "operation",
        "id",
        "source_file",
        "source_block_sha256",
        "reviews",
        "index_references",
        "created_at",
    }
    if not isinstance(payload, dict) or set(payload) != expected_fields:
        raise ValueError("invalid operation fields")
    identifier = payload.get("id")
    source_hash = payload.get("source_block_sha256")
    if (
        payload.get("schema_version") != 2
        or payload.get("operation") != "purge"
        or not isinstance(identifier, str)
        or not identifier.strip()
        or _safe_relative_path(payload.get("source_file"), prefix="entries", suffix=".md")
        is None
        or (
            source_hash is not None
            and (
                not isinstance(source_hash, str)
                or re.fullmatch(r"[0-9a-f]{64}", source_hash) is None
            )
        )
    ):
        raise ValueError("invalid operation identity")

    expected_name = f"purge-{hashlib.sha256(identifier.encode('utf-8')).hexdigest()[:20]}.json"
    if operation_path.name != expected_name:
        raise ValueError("invalid operation filename")

    reviews = payload.get("reviews")
    if not isinstance(reviews, list):
        raise ValueError("invalid reviews")
    review_paths: list[str] = []
    for item in reviews:
        if (
            not isinstance(item, dict)
            or set(item) != {"path", "sha256"}
            or _safe_relative_path(item.get("path"), prefix="reviews", suffix=".md")
            is None
            or not isinstance(item.get("sha256"), str)
            or re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) is None
        ):
            raise ValueError("invalid review contract")
        review_paths.append(item["path"])
    if len(review_paths) != len(set(review_paths)):
        raise ValueError("duplicate review paths")

    references = payload.get("index_references")
    if (
        not isinstance(references, list)
        or any(
            _safe_relative_path(value, prefix="reviews", suffix=".md") is None
            for value in references
        )
        or references != sorted(set(references))
        or not set(references).issubset(set(review_paths))
    ):
        raise ValueError("invalid index references")

    created_at = payload.get("created_at")
    try:
        parsed_created_at = datetime.fromisoformat(created_at)
    except (TypeError, ValueError) as error:
        raise ValueError("invalid operation timestamp") from error
    if parsed_created_at.tzinfo is None or parsed_created_at.utcoffset() is None:
        raise ValueError("operation timestamp missing timezone")
    return identifier


def _validated_daily_checkin_count(path: Path) -> int:
    module_path = Path(__file__).with_name("daily_checkin.py")
    spec = importlib.util.spec_from_file_location("life_status_daily_checkin", module_path)
    if spec is None or spec.loader is None:
        raise ValueError("daily check-in validator unavailable")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
        _, records = module._load_records_bytes(path)
    except Exception as error:
        raise ValueError("daily check-in ledger invalid") from error
    return len(records)


def _validated_weekly_review_count(path: Path) -> int:
    module_path = Path(__file__).with_name("weekly_review.py")
    spec = importlib.util.spec_from_file_location("life_status_weekly_review", module_path)
    if spec is None or spec.loader is None:
        raise ValueError("weekly review validator unavailable")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
        _, records = module._load_records_bytes(path)
    except Exception as error:
        raise ValueError("weekly review ledger invalid") from error
    return len(records)


def _xlsx_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    namespace = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    return ["".join(node.text or "" for node in item.iter(f"{namespace}t")) for item in root]


def _weekly_workbook_scaffold_valid(path: Path) -> bool | None:
    """校验正式 XLSX 的自然周脚手架；非 XLSX 测试占位文件返回未知。"""

    try:
        with zipfile.ZipFile(path) as archive:
            workbook_root = ET.fromstring(archive.read("xl/workbook.xml"))
            relationships_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            main_ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
            rel_attr = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
            target_id = None
            for sheet in workbook_root.iter(f"{main_ns}sheet"):
                if sheet.attrib.get("name") == "每周复盘":
                    target_id = sheet.attrib.get(rel_attr)
                    break
            if target_id is None:
                return False
            target = None
            for relation in relationships_root:
                if relation.attrib.get("Id") == target_id:
                    target = relation.attrib.get("Target")
                    break
            if not target:
                return False
            sheet_name = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
            sheet_root = ET.fromstring(archive.read(sheet_name))
            shared = _xlsx_shared_strings(archive)
    except (OSError, zipfile.BadZipFile, KeyError, ET.ParseError, UnicodeError):
        return None

    cells: dict[str, Any] = {}
    for cell in sheet_root.iter(f"{main_ns}c"):
        reference = cell.attrib.get("r")
        if not reference or not re.fullmatch(r"[ABC](?:[5-9]|1[0-8])", reference):
            continue
        cell_type = cell.attrib.get("t")
        if cell_type == "inlineStr":
            cells[reference] = "".join(
                node.text or "" for node in cell.iter(f"{main_ns}t")
            )
            continue
        value_node = cell.find(f"{main_ns}v")
        raw = value_node.text if value_node is not None else None
        if raw is None:
            cells[reference] = None
        elif cell_type == "s":
            try:
                cells[reference] = shared[int(raw)]
            except (ValueError, IndexError):
                return False
        elif cell_type in {"str", "e"}:
            cells[reference] = raw
        else:
            try:
                cells[reference] = float(raw)
            except ValueError:
                return False

    epoch = date(1899, 12, 30)
    for offset in range(12):
        row = offset + 5
        week_start = date(2026, 8, 3) + timedelta(days=offset * 7)
        week_end = week_start + timedelta(days=6)
        if cells.get(f"A{row}") != float((week_start - epoch).days):
            return False
        if cells.get(f"B{row}") != float((week_end - epoch).days):
            return False
        iso_year, iso_number, _ = week_start.isocalendar()
        if cells.get(f"C{row}") != f"{iso_year}-W{iso_number:02d}":
            return False
    return all(cells.get(f"{column}{row}") in {None, ""} for row in (17, 18) for column in "ABC")


def _check_journal(root: Path, today: date) -> Section:
    section = Section()
    journal_root = root / "journal"
    index_path = journal_root / "index.jsonl"
    daily_checkin_path = root / DAILY_CHECKINS
    weekly_review_path = root / WEEKLY_REVIEWS
    phase_review_path = root / PHASE_REVIEWS
    google_sync_metrics, google_sync_issue = _inspect_google_display_state(root)
    if google_sync_issue is not None:
        section.add(*google_sync_issue)
    source_graph = {
        "valid": False,
        "index_present": False,
        "indexed_entries": 0,
        "source_entries": 0,
        "source_files": 0,
    }
    try:
        source_graph = inspect_journal_graph(journal_root)
    except (JournalIntegrityError, OSError):
        section.add(
            "FAIL",
            "日记机器索引与月度原文的双向完整性校验未通过。",
            "停止生成回顾或刷新 Google 展示层，先用日记完整性工具修复来源对应关系。",
        )
    review_policy, review_policy_error = _load_journal_review_policy(root)
    policy_valid = review_policy is not None
    effective_review_cadence = _effective_review_cadence(review_policy, today)
    if review_policy_error:
        section.add(
            "FAIL",
            review_policy_error,
            "修复 journal/review-policy.json 后再判断日记整理提醒。",
        )
    daily_checkins = 0
    daily_checkins_valid = True
    weekly_reviews = 0
    weekly_reviews_valid = True
    phase_reviews = 0
    phase_reviews_valid = True
    phase_action_ledger_present = False
    phase_actions_valid = True
    phase_actions = 0
    phase_action_pending = 0
    phase_action_failed = 0
    phase_action_applied = 0
    phase_action_dismissed = 0
    phase_action_superseded = 0
    insight_ledger_present = False
    insight_ledger_valid = True
    insight_candidates = 0
    insight_pending = 0
    insight_awaiting_proposal = 0
    insight_proposed = 0
    insight_applied = 0
    if daily_checkin_path.is_file():
        try:
            daily_checkins = _validated_daily_checkin_count(daily_checkin_path)
        except ValueError:
            daily_checkins_valid = False
            section.add(
                "FAIL",
                "每日状态台账结构无效或无法安全读取。",
                "保留原文件供排查，用每日状态工具修复后再刷新 Google 展示层。",
            )
    if weekly_review_path.is_file():
        try:
            weekly_reviews = _validated_weekly_review_count(weekly_review_path)
        except ValueError:
            weekly_reviews_valid = False
            section.add(
                "FAIL",
                "周复盘台账结构无效或无法安全读取。",
                "保留原文件供排查，用周复盘工具修复后再刷新 Google 展示层。",
            )
    if phase_review_path.exists() or phase_review_path.is_symlink():
        try:
            phase_summary = inspect_phase_reviews(root / "records")
            phase_reviews = int(phase_summary["count"])
        except (PhaseReviewError, OSError, KeyError, TypeError, ValueError):
            phase_reviews_valid = False
            section.add(
                "FAIL",
                "阶段复盘台账结构无效或无法安全读取。",
                "保留原文件供排查，用阶段复盘工具修复后再继续目标或节奏更新。",
            )
    try:
        phase_action_summary = inspect_phase_actions(root / "records")
        phase_action_ledger_present = bool(
            phase_action_summary["ledger_present"]
        )
        phase_actions_valid = bool(phase_action_summary["valid"]) and (
            phase_action_summary["permissions_ok"] is True
        )
        phase_actions = int(phase_action_summary["record_count"])
        phase_action_counts = phase_action_summary["state_counts"]
        phase_action_pending = int(phase_action_counts["pending"])
        phase_action_failed = int(phase_action_counts["failed"])
        phase_action_applied = int(phase_action_counts["applied"])
        phase_action_dismissed = int(phase_action_counts["dismissed"])
        phase_action_superseded = int(phase_action_counts["superseded"])
        if not phase_actions_valid:
            raise PhaseActionError("阶段动作台账检查未通过")
    except (PhaseActionError, OSError, KeyError, TypeError, ValueError):
        phase_actions_valid = False
        section.add(
            "FAIL",
            "阶段复盘动作台账结构、权限或路径无法安全验证。",
            "保留现场排查，修复后再继续应用或重试阶段动作。",
        )
    try:
        insight_summary = inspect_insight_ledger(journal_root)
        insight_ledger_present = bool(insight_summary["ledger_present"])
        insight_ledger_valid = bool(insight_summary["valid"])
        insight_candidates = int(insight_summary["total_candidates"])
        insight_pending = int(insight_summary["counts"]["pending"])
        insight_awaiting_proposal = int(
            insight_summary["counts"]["awaiting_proposal"]
        )
        insight_proposed = int(insight_summary["counts"]["proposed"])
        insight_applied = int(insight_summary["counts"]["applied"])
        if not insight_ledger_valid:
            raise InsightError("候选确认台账检查未通过")
    except (InsightError, OSError, KeyError, TypeError, ValueError):
        insight_ledger_valid = False
        section.add(
            "FAIL",
            "日记候选认识确认台账结构、权限或路径无法安全验证。",
            "保留现场排查，修复后再展示或记录候选认识。",
        )
    pending_purge_ids: set[str] = set()
    operations_root = journal_root / ".operations"
    pending_operation_files = 0
    if operations_root.is_dir():
        for operation_path in operations_root.glob("purge-*.json"):
            pending_operation_files += 1
            try:
                payload = json.loads(_read_text(operation_path))
            except (OSError, UnicodeError, json.JSONDecodeError):
                section.add(
                    "FAIL",
                    "有永久删除恢复记录无法安全读取。",
                    "停止新的日记写入并修复永久删除恢复记录。",
                )
                continue
            try:
                identifier = _pending_purge_identifier(operation_path, payload)
            except ValueError:
                section.add(
                    "FAIL",
                    "有永久删除恢复记录结构无效。",
                    "停止新的日记写入并修复永久删除恢复记录。",
                )
                continue
            pending_purge_ids.add(identifier)
    records, load_error = _load_journal_records(index_path)
    if load_error:
        section.metrics = {
            "active": 0,
            "withdrawn": 0,
            "daily_checkins": daily_checkins,
            "daily_checkins_valid": daily_checkins_valid,
            "weekly_reviews": weekly_reviews,
            "weekly_reviews_valid": weekly_reviews_valid,
            "phase_reviews": phase_reviews,
            "phase_reviews_valid": phase_reviews_valid,
            "phase_action_ledger_present": phase_action_ledger_present,
            "phase_actions_valid": phase_actions_valid,
            "phase_actions": phase_actions,
            "phase_action_pending": phase_action_pending,
            "phase_action_failed": phase_action_failed,
            "phase_action_applied": phase_action_applied,
            "phase_action_dismissed": phase_action_dismissed,
            "phase_action_superseded": phase_action_superseded,
            "insight_ledger_present": insight_ledger_present,
            "insight_ledger_valid": insight_ledger_valid,
            "insight_candidates": insight_candidates,
            "insight_pending": insight_pending,
            "insight_awaiting_proposal": insight_awaiting_proposal,
            "insight_proposed": insight_proposed,
            "insight_applied": insight_applied,
            "weekly_due": 0,
            "monthly_due": 0,
            "policy_valid": policy_valid,
            "effective_review_cadence": effective_review_cadence,
            "actionable_weekly_due": 0,
            "actionable_monthly_due": 0,
            "source_graph_valid": source_graph["valid"],
            "source_index_present": source_graph["index_present"],
            "source_indexed_entries": source_graph["indexed_entries"],
            "source_entries": source_graph["source_entries"],
            "source_files": source_graph["source_files"],
            "stale_reviews": 0,
            **google_sync_metrics,
        }
        section.add("FAIL", load_error, "修复 journal/index.jsonl 后再生成回顾或刷新 Google 展示层。")
        return section

    active = 0
    withdrawn = 0
    invalid = 0
    weekly_due = 0
    monthly_due = 0
    invalidated_review_paths: set[str] = set()
    effective_review_paths: set[str] = set()
    seen_ids: set[str] = set()
    first_of_month = today.replace(day=1)
    for line_number, record in enumerate(records, start=1):
        line_invalid = not _journal_index_shape_valid(record)
        identifier = record.get("id")
        entry_date = _valid_date(record.get("date"))
        entry_time = record.get("time")
        time_precision = record.get(
            "time_precision", "exact" if isinstance(entry_time, str) and entry_time else "unknown"
        )
        status = record.get("status")
        privacy = record.get("privacy")
        source_path = _safe_relative_path(record.get("file"), prefix="entries", suffix=".md")
        weekly = record.get("weekly_reviews")
        monthly = record.get("monthly_reviews")
        invalidated_reviews = record.get("invalidated_reviews", [])

        if not isinstance(identifier, str) or not identifier.strip() or identifier in seen_ids:
            line_invalid = True
        elif identifier:
            seen_ids.add(identifier)
        if entry_date is None or time_precision not in {"exact", "approximate", "unknown"}:
            line_invalid = True
        elif time_precision == "unknown":
            if entry_time is not None:
                line_invalid = True
        elif not isinstance(entry_time, str) or not TIME_PATTERN.fullmatch(entry_time):
            line_invalid = True
        if status not in {"active", "withdrawn"} or privacy != "local-only" or source_path is None:
            line_invalid = True
        if not isinstance(weekly, list) or any(not isinstance(value, str) for value in weekly):
            line_invalid = True
            weekly = []
        if not isinstance(monthly, list) or any(not isinstance(value, str) for value in monthly):
            line_invalid = True
            monthly = []
        if not isinstance(invalidated_reviews, list) or any(
            not isinstance(value, str) for value in invalidated_reviews
        ):
            line_invalid = True
            invalidated_reviews = []

        safe_weekly: list[Path] = []
        safe_monthly: list[Path] = []
        for value in weekly:
            candidate = _safe_relative_path(value, prefix="reviews", suffix=".md")
            if candidate is None:
                line_invalid = True
            else:
                safe_weekly.append(candidate)
        for value in monthly:
            candidate = _safe_relative_path(value, prefix="reviews", suffix=".md")
            if candidate is None:
                line_invalid = True
            else:
                safe_monthly.append(candidate)
        for value in invalidated_reviews:
            candidate = _safe_relative_path(value, prefix="reviews", suffix=".md")
            if candidate is None:
                line_invalid = True
            else:
                invalidated_review_paths.add(candidate.as_posix())

        marker_count: int | None = None
        source_withdrawn_marked = False
        if source_path is not None and isinstance(identifier, str):
            source_file = journal_root / source_path
            try:
                source_text = _read_text(source_file)
            except (OSError, UnicodeError):
                if identifier not in pending_purge_ids:
                    line_invalid = True
            else:
                marker = f"<!-- journal-id: {identifier} -->"
                marker_count = len(
                    list(re.finditer(rf"(?m)^{re.escape(marker)}[ \t]*$", source_text))
                )
                if marker_count != 1 and identifier not in pending_purge_ids:
                    line_invalid = True
                if marker_count == 1:
                    entry_block = _journal_entry_block(source_text, identifier)
                    if entry_block is None:
                        line_invalid = True
                    else:
                        withdrawal_state_count = _journal_withdrawal_state_count(
                            entry_block
                        )
                        if withdrawal_state_count > 1:
                            line_invalid = True
                        source_withdrawn_marked = withdrawal_state_count == 1

        if status == "active":
            active += 1
            if isinstance(identifier, str) and identifier in pending_purge_ids:
                line_invalid = True
            if source_withdrawn_marked:
                line_invalid = True
            for review_path in [*safe_weekly, *safe_monthly]:
                if not (journal_root / review_path).is_file():
                    line_invalid = True
                effective_review_paths.add(review_path.as_posix())
            if entry_date is not None:
                age_days = (today - entry_date).days
                if age_days < 0:
                    section.add(
                        "ATTENTION",
                        "有日记日期晚于本次检查日期。",
                        "下次整理日记时确认记录日期。",
                    )
                week_end = entry_date + timedelta(days=6 - entry_date.weekday())
                if week_end < today and not safe_weekly:
                    weekly_due += 1
                if entry_date < first_of_month and not safe_monthly:
                    monthly_due += 1
        elif status == "withdrawn":
            withdrawn += 1
            if safe_weekly or safe_monthly:
                line_invalid = True
            if (
                isinstance(identifier, str)
                and identifier not in pending_purge_ids
                and not source_withdrawn_marked
            ):
                line_invalid = True

        if line_invalid:
            invalid += 1
            section.add(
                "FAIL",
                f"日记机器索引第 {line_number} 行的结构或关联文件不完整。",
                "用日记工具修复索引与源文件的对应关系。",
            )

    stale_reviews = 0
    reviews_root = journal_root / "reviews"
    if reviews_root.exists():
        for review_path in reviews_root.rglob("*.md"):
            try:
                review_text = _read_text(review_path)
                if any(marker in review_text for marker in STALE_REVIEW_MARKERS):
                    stale_reviews += 1
                    relative_review = review_path.relative_to(journal_root).as_posix()
                    if relative_review in effective_review_paths:
                        section.add(
                            "FAIL",
                            "有已标记失效的日记回顾仍被机器索引当作有效回顾引用。",
                            "清除所有来源记录中的旧回顾引用，再重新生成该回顾。",
                        )
            except (OSError, UnicodeError):
                section.add(
                    "FAIL",
                    "有日记回顾文件无法以 UTF-8 读取。",
                    "修复日记回顾文件的编码或访问问题。",
                )

    conflicting_reviews = invalidated_review_paths & effective_review_paths
    if conflicting_reviews:
        section.add(
            "FAIL",
            "有已失效的日记回顾仍被机器索引当作有效回顾引用。",
            "清除所有来源记录中的旧回顾引用，再重新生成该回顾。",
        )

    workbook_path = root / WORKBOOK
    # XLSX 仅是归档/恢复备用，不再决定日常展示是否最新。
    weekly_scaffold_valid = _weekly_workbook_scaffold_valid(workbook_path) if workbook_path.is_file() else None

    actionable_weekly_due = 0
    actionable_monthly_due = 0
    if effective_review_cadence in {"trial_weekly", "weekly"}:
        actionable_weekly_due = weekly_due
    elif effective_review_cadence == "monthly":
        actionable_monthly_due = monthly_due

    section.metrics = {
        "records": len(records),
        "active": active,
        "withdrawn": withdrawn,
        "daily_checkins": daily_checkins,
        "daily_checkins_valid": daily_checkins_valid,
        "weekly_reviews": weekly_reviews,
        "weekly_reviews_valid": weekly_reviews_valid,
        "phase_reviews": phase_reviews,
        "phase_reviews_valid": phase_reviews_valid,
        "phase_action_ledger_present": phase_action_ledger_present,
        "phase_actions_valid": phase_actions_valid,
        "phase_actions": phase_actions,
        "phase_action_pending": phase_action_pending,
        "phase_action_failed": phase_action_failed,
        "phase_action_applied": phase_action_applied,
        "phase_action_dismissed": phase_action_dismissed,
        "phase_action_superseded": phase_action_superseded,
        "insight_ledger_present": insight_ledger_present,
        "insight_ledger_valid": insight_ledger_valid,
        "insight_candidates": insight_candidates,
        "insight_pending": insight_pending,
        "insight_awaiting_proposal": insight_awaiting_proposal,
        "insight_proposed": insight_proposed,
        "insight_applied": insight_applied,
        "weekly_scaffold_valid": weekly_scaffold_valid,
        "invalid": invalid,
        "weekly_due": weekly_due,
        "monthly_due": monthly_due,
        "policy_valid": policy_valid,
        "effective_review_cadence": effective_review_cadence,
        "actionable_weekly_due": actionable_weekly_due,
        "actionable_monthly_due": actionable_monthly_due,
        "source_graph_valid": source_graph["valid"],
        "source_index_present": source_graph["index_present"],
        "source_indexed_entries": source_graph["indexed_entries"],
        "source_entries": source_graph["source_entries"],
        "source_files": source_graph["source_files"],
        "stale_reviews": stale_reviews,
        "invalidated_reviews": len(invalidated_review_paths),
        "conflicting_reviews": len(conflicting_reviews),
        "pending_purges": pending_operation_files,
        **google_sync_metrics,
    }
    if not records and not load_error and source_graph["valid"]:
        section.add("PASS", "尚无日记记录；空白是正常状态，无需补记。")
    elif records:
        section.add(
            "PASS",
            f"日记索引共 {len(records)} 条（有效 {active}、已撤回 {withdrawn}）。",
        )
    if daily_checkins_valid and daily_checkins:
        section.add("PASS", f"每日状态台账共 {daily_checkins} 天，日期唯一且结构有效。")
    if weekly_reviews_valid and weekly_reviews:
        section.add("PASS", f"周复盘台账共 {weekly_reviews} 个自然周，周键唯一且结构有效。")
    if phase_reviews_valid and phase_reviews:
        section.add("PASS", f"阶段复盘台账共 {phase_reviews} 个日期，日期唯一且结构有效。")
    if phase_actions_valid and phase_action_ledger_present:
        section.add(
            "PASS",
            f"阶段复盘动作台账共 {phase_actions} 项"
            f"（待处理 {phase_action_pending}、失败 {phase_action_failed}、"
            f"已应用 {phase_action_applied}、已忽略 {phase_action_dismissed}、"
            f"已失效 {phase_action_superseded}）；运行状态不包含动作内容。",
        )
    if insight_ledger_valid and insight_ledger_present:
        section.add(
            "PASS",
            f"候选认识确认台账共 {insight_candidates} 项"
            f"（待确认 {insight_pending}、待拟定精确变更 "
            f"{insight_awaiting_proposal}、待确认精确变更 {insight_proposed}、"
            f"已应用 {insight_applied}）；未完成双重确认前不写入长期文件。",
        )
    recoverable_insights = insight_awaiting_proposal + insight_proposed
    if insight_ledger_valid and recoverable_insights:
        section.add(
            "ATTENTION",
            f"有 {recoverable_insights} 项已接受的候选认识正等待可恢复维护"
            f"（待拟定 {insight_awaiting_proposal}、待精确确认 {insight_proposed}）。",
            "在合适的用户确认节点恢复精确变更流程；不从旧对话猜测变更内容。",
        )
    recoverable_phase_actions = phase_action_pending + phase_action_failed
    if phase_actions_valid and recoverable_phase_actions:
        section.add(
            "ATTENTION",
            f"阶段复盘动作台账有 {recoverable_phase_actions} 项等待可恢复处理"
            f"（待处理 {phase_action_pending}、失败可重试 {phase_action_failed}）。",
            "按各动作的审批边界恢复执行；先获取只读执行计划，实际成功后再记录结果。",
        )
    if actionable_weekly_due:
        section.add(
            "ATTENTION",
            f"有 {actionable_weekly_due} 条较早日记尚未纳入周回顾。",
            "有新素材且用户愿意时，完成一次周度轻回顾。",
        )
    if actionable_monthly_due:
        section.add(
            "ATTENTION",
            f"有 {actionable_monthly_due} 条上月或更早的日记尚未纳入月回顾。",
            "素材足够时整理上一自然月的生活回顾。",
        )
    stale_total = max(stale_reviews, len(invalidated_review_paths))
    if stale_total:
        section.add(
            "ATTENTION",
            f"有 {stale_total} 份回顾因来源日记撤回或更正而需要刷新。",
            "重新生成已标记失效的日记回顾。",
        )
    if pending_operation_files:
        section.add(
            "ATTENTION",
            f"有 {pending_operation_files} 个永久删除操作在中断后等待安全收敛。",
            "按原删除范围重新运行 purge-plan 与 purge；工具会从持久化步骤继续。",
        )
    return section


def _default_automation_dir() -> Path:
    configured = os.environ.get("CODEX_HOME")
    base = Path(configured).expanduser() if configured else Path.home() / ".codex"
    return base / "automations"


def _normalize_prompt(value: str) -> str:
    """只忽略文件/TOML 序列化造成的尾部换行差异。"""

    return value.rstrip("\r\n")


def _load_automation_contract(root: Path) -> tuple[dict[str, Any] | None, str | None]:
    """读取并验证可迁移自动化契约，不把提示词或运行时标识带入错误。"""

    resolved_root = root.resolve()
    registry_path = root / AUTOMATION_REGISTRY
    try:
        registry_path.resolve().relative_to(resolved_root)
    except (OSError, ValueError):
        return None, "自动化注册表路径不安全。"
    if registry_path.is_symlink() or not registry_path.is_file():
        return None, "自动化注册表缺失或不是普通项目文件。"
    try:
        payload = json.loads(_read_text(registry_path))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None, "自动化注册表无法安全读取。"
    if (
        not isinstance(payload, dict)
        or set(payload) != {"schema_version", "automations"}
        or payload.get("schema_version") != 1
        or not isinstance(payload.get("automations"), list)
        or len(payload["automations"]) != 1
    ):
        return None, "自动化注册表结构或版本无效。"

    contracts: dict[str, dict[str, Any]] = {}
    for item in payload["automations"]:
        if not isinstance(item, dict) or set(item) != AUTOMATION_CONTRACT_FIELDS:
            return None, "自动化注册表中的契约结构无效。"
        key = item.get("key")
        if (
            not isinstance(key, str)
            or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", key)
            or key in contracts
        ):
            return None, "自动化注册表中的契约键无效或重复。"
        contracts[key] = item

    item = contracts.get(AUTOMATION_KEY)
    if item is None:
        return None, "自动化注册表缺少生活状态回访契约。"
    name = item.get("name")
    kind = item.get("kind")
    desired_status = item.get("desired_status")
    timezone_name = item.get("timezone")
    local_time = item.get("local_time")
    runtime_time_basis = item.get("runtime_time_basis")
    max_jitter = item.get("max_scheduler_jitter_seconds")
    prompt_hash = item.get("prompt_sha256")
    if (
        not isinstance(name, str)
        or not name.strip()
        or name != name.strip()
        or len(name) > 200
        or "\n" in name
        or "\r" in name
        or kind != "heartbeat"
        or desired_status != "ACTIVE"
        or not isinstance(timezone_name, str)
        or not isinstance(local_time, str)
        or not TIME_PATTERN.fullmatch(local_time)
        or runtime_time_basis != "utc"
        or isinstance(max_jitter, bool)
        or not isinstance(max_jitter, int)
        or not 0 <= max_jitter <= 3600
        or not isinstance(prompt_hash, str)
        or not re.fullmatch(r"[0-9a-f]{64}", prompt_hash)
    ):
        return None, "生活状态回访契约的字段值无效。"
    try:
        ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        return None, "生活状态回访契约的时区无效。"

    start = _valid_date(item.get("start"))
    end = _valid_date(item.get("end"))
    if start is None or end is None or start > end:
        return None, "生活状态回访契约的生效范围无效。"
    prompt_relative = _safe_relative_path(
        item.get("prompt_file"),
        prefix="automations",
        suffix=".txt",
    )
    if prompt_relative is None:
        return None, "生活状态回访契约的提示词路径不安全。"
    prompt_path = root / prompt_relative
    try:
        prompt_path.resolve().relative_to(resolved_root)
    except (OSError, ValueError):
        return None, "生活状态回访契约的提示词路径不安全。"
    if prompt_path.is_symlink() or not prompt_path.is_file():
        return None, "生活状态回访的规范提示词缺失或不是普通项目文件。"
    try:
        if prompt_path.stat().st_size > 1024 * 1024:
            return None, "生活状态回访的规范提示词文件异常。"
        canonical_prompt = _read_text(prompt_path)
        actual_hash = _sha256(prompt_path)
    except (OSError, UnicodeError):
        return None, "生活状态回访的规范提示词无法安全读取。"
    if not _normalize_prompt(canonical_prompt):
        return None, "生活状态回访的规范提示词为空。"
    if actual_hash != prompt_hash:
        return None, "生活状态回访的规范提示词完整性校验失败。"

    hour, minute = map(int, local_time.split(":"))
    return {
        "name": name,
        "kind": kind,
        "desired_status": desired_status,
        "timezone": timezone_name,
        "start": start,
        "end": end,
        "hour": hour,
        "minute": minute,
        "runtime_time_basis": runtime_time_basis,
        "max_scheduler_jitter_seconds": max_jitter,
        "canonical_prompt": canonical_prompt,
    }, None


def _toml_scalar_fields(path: Path) -> dict[str, Any] | None:
    """读取 Codex automation.toml 的顶层标量，不解析或输出未知字段。"""

    wanted = {"id", "name", "prompt", "status", "rrule", "target_thread_id", "kind"}
    try:
        content = _read_text(path)
    except (OSError, UnicodeError):
        return None
    fields: dict[str, Any] = {}
    for line in content.splitlines():
        match = re.fullmatch(r"([a-z_]+)\s*=\s*(.+)", line.strip())
        if not match or match.group(1) not in wanted:
            continue
        try:
            fields[match.group(1)] = json.loads(match.group(2))
        except json.JSONDecodeError:
            return None
    return fields


def _runtime_automation_configs(
    automation_dir: Path,
    expected_name: str,
) -> tuple[list[dict[str, Any]], bool]:
    if not automation_dir.is_dir():
        return [], False
    resolved_dir = automation_dir.resolve()
    configs: list[dict[str, Any]] = []
    unreadable = False
    try:
        candidates = list(automation_dir.glob("*/automation.toml"))
    except OSError:
        return [], True
    for candidate in candidates:
        try:
            candidate.resolve().relative_to(resolved_dir)
        except (OSError, ValueError):
            unreadable = True
            continue
        fields = _toml_scalar_fields(candidate)
        if fields is None:
            unreadable = True
            continue
        if fields.get("name") == expected_name:
            configs.append(fields)
    return configs, unreadable


def _rrule_matches(
    value: Any,
    *,
    end: date,
    hour: int,
    minute: int,
    timezone_name: str,
    runtime_time_basis: str,
) -> bool:
    if (
        not isinstance(value, str)
        or not value.startswith("RRULE:")
        or runtime_time_basis != "utc"
    ):
        return False
    parts: dict[str, str] = {}
    for part in value[len("RRULE:") :].split(";"):
        if "=" not in part:
            return False
        key, part_value = part.split("=", 1)
        if key in parts:
            return False
        parts[key] = part_value
    try:
        expected_occurrence = datetime.combine(
            end,
            time(hour=hour, minute=minute),
            tzinfo=ZoneInfo(timezone_name),
        ).astimezone(timezone.utc)
        expected_until = expected_occurrence.strftime("%Y%m%dT%H%M%SZ")
    except (ValueError, ZoneInfoNotFoundError):
        return False
    return (
        set(parts) == {"FREQ", "BYHOUR", "BYMINUTE", "UNTIL"}
        and parts.get("FREQ") == "DAILY"
        and parts.get("BYHOUR") == str(expected_occurrence.hour)
        and parts.get("BYMINUTE") == str(expected_occurrence.minute)
        and parts.get("UNTIL") == expected_until
    )


def _runtime_database_state(
    database_path: Path,
    *,
    automation_id: Any,
    start: date,
    end: date,
    hour: int,
    minute: int,
    timezone_name: str,
    desired_status: str,
    max_scheduler_jitter_seconds: int,
) -> tuple[str, str | None]:
    if not database_path.is_file():
        return "database_missing", None
    if not isinstance(automation_id, str) or not automation_id.strip():
        return "row_missing", None
    try:
        connection = sqlite3.connect(f"{database_path.resolve().as_uri()}?mode=ro", uri=True)
        try:
            row = connection.execute(
                "SELECT next_run_at, status FROM automations WHERE id = ?",
                (automation_id,),
            ).fetchone()
        finally:
            connection.close()
    except (OSError, sqlite3.Error):
        return "database_unreadable", None
    if row is None:
        return "row_missing", None
    next_run_at, database_status = row
    if not isinstance(next_run_at, (int, float)):
        return "scheduler_misaligned", None
    try:
        local_next = datetime.fromtimestamp(
            next_run_at / 1000,
            tz=timezone.utc,
        ).astimezone(ZoneInfo(timezone_name))
    except (OSError, OverflowError, ValueError, ZoneInfoNotFoundError):
        return "database_unreadable", None
    local_iso = local_next.isoformat(timespec="seconds")
    expected_local = datetime.combine(
        local_next.date(),
        time(hour=hour, minute=minute),
        tzinfo=local_next.tzinfo,
    )
    scheduler_jitter_seconds = abs((local_next - expected_local).total_seconds())
    if (
        database_status != desired_status
        or not start <= local_next.date() <= end
        or scheduler_jitter_seconds > max_scheduler_jitter_seconds
    ):
        return "scheduler_misaligned", local_iso
    return "aligned", local_iso


def _check_automation(
    root: Path,
    today: date,
    automation_dir: Path,
    automation_db: Path,
) -> Section:
    section = Section()
    contract, contract_error = _load_automation_contract(root)
    if contract_error or contract is None:
        section.metrics = {
            "state": "contract_invalid",
            "contract_verified": False,
            "prompt_sha256_verified": False,
            "local_runtime_verified": False,
            "runtime_state": "not_checked",
            "runtime_matches": 0,
            "runtime_database_verified": False,
        }
        section.add(
            "FAIL",
            contract_error or "生活状态回访契约无效。",
            "修复自动化注册表与规范提示词后重新运行状态检查。",
        )
        return section
    start = contract["start"]
    end = contract["end"]
    hour = contract["hour"]
    minute = contract["minute"]
    timezone_name = contract["timezone"]
    if today < start:
        state = "future"
        section.add("PASS", f"定时回访契约将于 {start.isoformat()} 生效。")
    elif today <= end:
        state = "active"
        section.add("PASS", f"定时回访契约有效至 {end.isoformat()}。")
    else:
        state = "expired"
        section.add(
            "ATTENTION",
            f"定时回访可迁移契约已于 {end.isoformat()} 结束。",
            "请用户决定续期、降频或停止后，更新可迁移契约。",
        )
    runtime_configs, runtime_unreadable = _runtime_automation_configs(
        automation_dir,
        contract["name"],
    )
    aligned = [
        config
        for config in runtime_configs
        if config.get("kind") == contract["kind"]
        and config.get("status") == contract["desired_status"]
        and isinstance(config.get("target_thread_id"), str)
        and bool(config["target_thread_id"].strip())
        and _rrule_matches(
            config.get("rrule"),
            end=end,
            hour=hour,
            minute=minute,
            timezone_name=timezone_name,
            runtime_time_basis=contract["runtime_time_basis"],
        )
        and isinstance(config.get("prompt"), str)
        and _normalize_prompt(config["prompt"])
        == _normalize_prompt(contract["canonical_prompt"])
    ]
    config_aligned = len(runtime_configs) == 1 and len(aligned) == 1
    database_state = "not_checked"
    next_run_local: str | None = None
    if config_aligned:
        database_state, next_run_local = _runtime_database_state(
            automation_db,
            automation_id=aligned[0].get("id"),
            start=start,
            end=end,
            hour=hour,
            minute=minute,
            timezone_name=timezone_name,
            desired_status=contract["desired_status"],
            max_scheduler_jitter_seconds=contract["max_scheduler_jitter_seconds"],
        )
    local_runtime_verified = config_aligned and database_state == "aligned"
    if local_runtime_verified:
        runtime_state = "aligned"
        section.add(
            "PASS",
            "已核对当前设备的回访自动化：配置与调度器下一次执行时间均符合可迁移规格。",
        )
    elif len(runtime_configs) > 1:
        runtime_state = "duplicate"
        section.add(
            "ATTENTION",
            "当前设备存在多个同名生活回访自动化，可能造成重复打扰。",
            "保留一个与可迁移规格一致的回访自动化，停用或删除重复项。",
        )
    elif runtime_configs and not config_aligned:
        runtime_state = "misaligned"
        section.add(
            "ATTENTION",
            "当前设备的生活回访自动化与可迁移规格不一致。",
            "更新现有回访自动化的启用状态、时间、截止日和关键流程。",
        )
    elif database_state == "scheduler_misaligned":
        runtime_state = "scheduler_misaligned"
        section.add(
            "ATTENTION",
            "当前调度器的下一次生活回访时间与可迁移规格不一致。",
            "按目标时区修正回访规则，并再次核对调度器的下一次执行时间。",
        )
    elif database_state in {"database_missing", "database_unreadable", "row_missing"}:
        runtime_state = database_state
        section.add(
            "ATTENTION",
            "无法从当前设备的调度数据库确认生活回访下一次何时执行。",
            "在 Codex 应用中重新保存回访自动化，再运行状态检查。",
        )
    elif runtime_unreadable:
        runtime_state = "unreadable"
        section.add(
            "ATTENTION",
            "无法完整核对当前设备的自动化配置。",
            "在 Codex 应用中查看生活回访自动化，并按可迁移规格核对。",
        )
    else:
        runtime_state = "missing"
        section.add(
            "ATTENTION",
            "当前设备尚未找到生活状态回访自动化。",
            "按可迁移规格在当前设备重建生活状态回访。",
        )
    section.metrics = {
        "state": state,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "contract_verified": True,
        "prompt_sha256_verified": True,
        "local_runtime_verified": local_runtime_verified,
        "runtime_state": runtime_state,
        "runtime_matches": len(runtime_configs),
        "runtime_database_verified": database_state == "aligned",
    }
    if next_run_local is not None:
        section.metrics["next_run_local"] = next_run_local
    return section


def _check_site(root: Path) -> Section:
    """Validate archived dashboard state without reading hosting metadata."""

    section = Section()
    try:
        surfaces = load_product_surfaces(root)
    except (ProductSurfaceError, OSError, ValueError):
        section.metrics = {
            "contract_verified": False,
            "life_dashboard_state": "unknown",
        }
        section.add(
            "FAIL",
            "展示层生命周期清单缺失、损坏或不是规范状态。",
            "恢复 docs/operations/product-surfaces.json 并重新运行项目校验。",
        )
        return section
    section.metrics = {
        "contract_verified": True,
        "truth_source": "icloud-private-workspace",
        "primary_surface": "life-console",
        "google_sync_cadence": surfaces["google-sheets"]["sync_cadence"],
        "xlsx_sync_cadence": surfaces["xlsx"]["sync_cadence"],
        "life_dashboard_state": surfaces["life-dashboard"]["lifecycle_state"],
        "new_deployments_allowed": False,
        "online_verified": False,
    }
    section.add(
        "PASS",
        "展示层生命周期已收口：Life Console 为主要入口，Google 与 XLSX 按需派生，移动网页已归档且禁止新部署。",
    )
    return section


def _parse_checksum_file(path: Path, expected_name: str) -> str | None:
    try:
        lines = [line.strip() for line in _read_text(path).splitlines() if line.strip()]
    except (OSError, UnicodeError):
        return None
    if len(lines) != 1:
        return None
    match = re.fullmatch(r"([0-9a-fA-F]{64})\s{2}([^/\\]+)", lines[0])
    if not match or match.group(2) != expected_name:
        return None
    return match.group(1).lower()


def _load_backup_manifest(manifest_path: Path) -> dict[str, str] | None:
    try:
        lines = [line for line in _read_text(manifest_path).splitlines() if line.strip()]
    except (OSError, UnicodeError):
        return None
    if not lines:
        return None
    manifest: dict[str, str] = {}
    for line in lines:
        match = re.fullmatch(r"([0-9a-fA-F]{64})\s{2}(.+)", line)
        if not match:
            return None
        expected, relative = match.group(1).lower(), match.group(2)
        candidate = Path(relative)
        if candidate.is_absolute() or ".." in candidate.parts or not candidate.parts:
            return None
        if relative in manifest:
            return None
        manifest[relative] = expected
    return manifest


def _verify_backup_manifest(archive: zipfile.ZipFile, manifest_path: Path) -> bool:
    manifest = _load_backup_manifest(manifest_path)
    if manifest is None:
        return False
    archive_names = {info.filename for info in archive.infolist() if not info.is_dir()}
    expected_archive_names: set[str] = set()
    for relative, expected in manifest.items():
        archive_name = f"codex-生活助手/{relative}"
        if archive_name not in archive_names:
            return False
        expected_archive_names.add(archive_name)
        try:
            with archive.open(archive_name) as handle:
                actual = _sha256_stream(iter(lambda: handle.read(1024 * 1024), b""))
        except (KeyError, OSError, RuntimeError):
            return False
        if actual != expected:
            return False
    return expected_archive_names == archive_names


def _current_project_manifest(root: Path) -> dict[str, str] | None:
    current: dict[str, str] = {}
    try:
        for path in root.rglob("*"):
            relative = path.relative_to(root)
            if any(part in BACKUP_EXCLUDED_DIRS for part in relative.parts):
                continue
            if relative == LEGACY_GOVERNANCE_LINK:
                if not legacy_governance_link_is_valid(root):
                    return None
                continue
            if not path.is_file() or path.name in BACKUP_EXCLUDED_FILES:
                continue
            if path.suffix.lower() in BACKUP_EXCLUDED_SUFFIXES:
                continue
            current[relative.as_posix()] = _sha256(path)
    except OSError:
        return None
    return current


def _check_backup(root: Path, today: date) -> Section:
    section = Section()
    backup_dir = root / "backups"
    candidates: list[tuple[date, int, str, Path]] = []
    if backup_dir.is_dir():
        for path in backup_dir.iterdir():
            if not path.is_file():
                continue
            match = BACKUP_PATTERN.fullmatch(path.name)
            if not match:
                continue
            parsed = _valid_date(match.group(1))
            if parsed is not None:
                try:
                    modified = path.stat().st_mtime_ns
                except OSError:
                    modified = 0
                candidates.append((parsed, modified, path.name, path))

    if not candidates:
        section.metrics = {"available": False, "verified": False}
        section.add(
            "ATTENTION",
            "未找到可验证的完整备份。",
            "在重要变更完成后生成一份可迁移快照。",
        )
        return section

    backup_date, _, _, archive_path = max(candidates)
    checksum_path = archive_path.with_name(f"{archive_path.name}.sha256")
    manifest_path = archive_path.with_name(f"{archive_path.stem}.files.sha256")
    missing_parts = [path for path in (archive_path, checksum_path, manifest_path) if not path.is_file()]
    age_days = (today - backup_date).days
    section.metrics = {
        "available": True,
        "date": backup_date.isoformat(),
        "age_days": age_days,
        "verified": False,
        "parts_complete": not missing_parts,
    }
    if missing_parts:
        section.add(
            "FAIL",
            "最新备份的 ZIP 或校验文件不完整。",
            "重新生成当日完整备份，不要手工拼接缺失文件。",
        )
        return section

    expected = _parse_checksum_file(checksum_path, archive_path.name)
    checksum_ok = False
    archive_ok = False
    manifest_ok = False
    current_project_matches = False
    try:
        checksum_ok = expected is not None and _sha256(archive_path) == expected
    except OSError:
        checksum_ok = False
    if checksum_ok:
        try:
            with zipfile.ZipFile(archive_path) as archive:
                archive_ok = archive.testzip() is None
                if archive_ok:
                    manifest_ok = _verify_backup_manifest(archive, manifest_path)
        except (OSError, RuntimeError, zipfile.BadZipFile):
            archive_ok = False

    verified = checksum_ok and archive_ok and manifest_ok
    if verified:
        manifest = _load_backup_manifest(manifest_path)
        current = _current_project_manifest(root)
        current_project_matches = manifest is not None and current == manifest
    section.metrics.update(
        {
            "checksum_ok": checksum_ok,
            "archive_ok": archive_ok,
            "manifest_ok": manifest_ok,
            "verified": verified,
            "current_project_matches": current_project_matches,
        }
    )
    if verified:
        section.add("PASS", f"最新备份（{backup_date.isoformat()}）的 ZIP、校验和文件清单完整。")
    else:
        section.add(
            "FAIL",
            "最新备份的校验和恢复完整性检查失败。",
            "保留原备份供排查，然后重新生成一份完整快照。",
        )
    if verified and not current_project_matches:
        section.add(
            "ATTENTION",
            "最新备份自身完整，但与当前项目文件不再一致。",
            "在本次实质变更验证通过后生成新的不可变修订快照。",
        )
    if age_days < 0:
        section.add(
            "ATTENTION",
            "最新备份日期晚于本次检查日期。",
            "确认系统日期和备份命名是否正确。",
        )
    elif age_days > 14:
        section.add(
            "ATTENTION",
            f"最新备份已距本次检查 {age_days} 天。",
            "在下次重要变更后刷新可迁移备份。",
        )
    return section


def build_status(
    root: Path,
    today: date,
    automation_dir: Path | None = None,
    automation_db: Path | None = None,
) -> dict[str, Any]:
    resolved_automation_dir = automation_dir or _default_automation_dir()
    resolved_automation_db = automation_db or resolved_automation_dir.parent / "sqlite" / "codex-dev.db"
    sections = {
        "core": _check_core(root),
        "goals": _check_goals(root, today),
        "journal": _check_journal(root, today),
        "automation": _check_automation(
            root,
            today,
            resolved_automation_dir,
            resolved_automation_db,
        ),
        "site": _check_site(root),
        "backup": _check_backup(root, today),
    }
    overall = max((section.status for section in sections.values()), key=SEVERITY.get)
    attention_count = sum(section.status == "ATTENTION" for section in sections.values())
    failure_count = sum(section.status == "FAIL" for section in sections.values())

    actions: list[str] = []
    action_pairs = [item for section in sections.values() for item in section.actions]
    action_pairs.sort(key=lambda item: SEVERITY[item[0]], reverse=True)
    for _, action in action_pairs:
        if action not in actions:
            actions.append(action)
        if len(actions) == 3:
            break

    return {
        "schema_version": 1,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "today": today.isoformat(),
        "overall": overall,
        "summary": {
            "attention_sections": attention_count,
            "failed_sections": failure_count,
        },
        "sections": {name: section.export() for name, section in sections.items()},
        "actions": actions,
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# 生活助手状态",
        "",
        f"> 检查日期：{report['today']}；生成时间：{report['generated_at']}",
        "",
        f"- 总体：**{report['overall']}**",
        f"- 需关注区域：{report['summary']['attention_sections']}",
        f"- 失败区域：{report['summary']['failed_sections']}",
        "",
        "## 助手待维护事项",
        "",
    ]
    if report["actions"]:
        lines.extend(f"- {action}" for action in report["actions"])
    else:
        lines.append("- 项目内部状态正常，用户无需为维护系统做额外操作。")
    lines.append("")

    for name, section in report["sections"].items():
        lines.extend(
            [
                f"## {SECTION_TITLES[name]}",
                "",
                f"- 状态：{section['status']}",
            ]
        )
        lines.extend(f"- {message}" for message in section["messages"])
        lines.append("")
    lines.extend(
        [
            "## 隐私说明",
            "",
            "本报告只包含结构状态和计数；不包含日记原文、日记标题/摘要、"
            "候选认识内容、阶段动作值或外部服务标识。",
            "",
        ]
    )
    return "\n".join(lines)


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            temporary_name = handle.name
        os.replace(temporary_name, path)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def _write_path(root: Path, value: str) -> Path:
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved_root = root.resolve()
    resolved = candidate.resolve()
    try:
        resolved.relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError("--write 必须位于 --root 指定的项目内") from exc
    return resolved


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="检查生活助手项目、日记、节点和备份状态")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="项目根目录")
    parser.add_argument("--today", default=date.today().isoformat(), help="检查日期，格式 YYYY-MM-DD")
    parser.add_argument("--json", action="store_true", help="将结果以 JSON 输出到 stdout")
    parser.add_argument("--write", metavar="PATH", help="将 Markdown 报告原子写入项目内的路径")
    parser.add_argument(
        "--automation-dir",
        type=Path,
        default=_default_automation_dir(),
        help="Codex 应用内自动化配置目录；默认从 CODEX_HOME 或用户目录定位",
    )
    parser.add_argument(
        "--automation-db",
        type=Path,
        help="Codex 调度数据库；默认使用自动化目录同级的 sqlite/codex-dev.db",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    parsed_today = _valid_date(args.today)
    if parsed_today is None:
        print("ERROR: --today 必须是有效的 YYYY-MM-DD", file=sys.stderr)
        return 2
    root = args.root.resolve()
    report = build_status(root, parsed_today, args.automation_dir, args.automation_db)
    markdown = render_markdown(report)
    if args.write:
        try:
            _atomic_write(_write_path(root, args.write), markdown)
        except (OSError, ValueError) as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 2
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print(markdown, end="")
    return 2 if report["overall"] == "FAIL" else 0


if __name__ == "__main__":
    raise SystemExit(main())
