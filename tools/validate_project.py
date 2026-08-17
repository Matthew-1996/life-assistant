#!/usr/bin/env python3
"""Validate the portable life-assistant workspace with no third-party packages."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
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
    from tools.journal_insights import InsightError, inspect_insight_ledger
except ModuleNotFoundError:  # Direct execution from tools/.
    from journal_insights import InsightError, inspect_insight_ledger

try:
    from tools.phase_actions import PhaseActionError, inspect_phase_actions
except ModuleNotFoundError:  # Direct execution from tools/.
    from phase_actions import PhaseActionError, inspect_phase_actions

try:
    from tools.check_project_governance import inspect_project_governance
except ModuleNotFoundError:  # Direct execution from tools/.
    from check_project_governance import inspect_project_governance

try:
    from tools.product_surfaces import ProductSurfaceError, load_product_surfaces
except ModuleNotFoundError:  # Direct execution from tools/.
    from product_surfaces import ProductSurfaceError, load_product_surfaces


ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills" / "improve-daily-life"
LEGACY_GOVERNANCE_LINK = Path("需求文档（个人维护）/agent项目开发规范.md")
LEGACY_GOVERNANCE_TARGET = Path("../docs/governance/agent-user-project-development-standard.md")

REQUIRED_FILES = [
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
    "tools/check_project_governance.py",
    "tools/test_project_governance.py",
    "research/2026-08-01-对话式日记完成审计.md",
    "automations/生活状态回访.md",
    "automations/registry.json",
    "automations/生活状态回访.prompt.txt",
    "integrations/README.md",
    "integrations/google-sheets.json",
    "journal/review-policy.json",
    "outputs/019fb832-be4f-74f1-add5-58cb6fb6fc09/生活计划表.xlsx",
    "outputs/019fb832-be4f-74f1-add5-58cb6fb6fc09/生活计划表.sync-state.json",
    "tools/create_backup.py",
    "tools/test_create_backup.py",
    "tools/verify_backup.py",
    "tools/test_verify_backup.py",
    "tools/portability_doctor.py",
    "tools/test_portability_doctor.py",
    "tools/life_assistant_status.py",
    "tools/test_life_assistant_status.py",
    "tools/daily_checkin.py",
    "tools/test_daily_checkin.py",
    "tools/apple_health_sleep.py",
    "tools/test_apple_health_sleep.py",
    "tools/apple_health_history.py",
    "tools/test_apple_health_history.py",
    "tools/weekly_review.py",
    "tools/test_weekly_review.py",
    "tools/journal_manager.py",
    "tools/test_journal_manager.py",
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
    "tools/test_life_plan_records.mjs",
    "tools/update_life_plan_journal.mjs",
    "tools/google_sheets_payload.mjs",
    "tools/test_google_sheets_payload.mjs",
    "tools/google_sheets_state.py",
    "tools/test_google_sheets_state.py",
    "tools/product_surfaces.py",
    "tools/test_product_surfaces.py",
    "journal/README.md",
    "journal/PRIVACY.md",
    "journal/INDEX.md",
    "records/README.md",
    "records/apple-health-latest.example.txt",
    "docs/design/README.md",
    "docs/design/apple-top-level-design-system/README.md",
    "docs/design/apple-top-level-design-system/usage-guide.md",
    "docs/design/apple-top-level-design-system/metadata.json",
    "docs/design/apple-top-level-design-system/design-system-consumption.json",
    "docs/design/apple-top-level-design-system/colors_and_type.css",
    "docs/design/apple-top-level-design-system/components.css",
    "docs/design/apple-top-level-design-system/css.json",
    "docs/design/apple-top-level-design-system/components/index.json",
    "docs/design/apple-top-level-design-system/preview/component-button.html",
    "docs/design/apple-top-level-design-system/ui_kits/website/index.html",
    "docs/design/life-console-trial-week-redesign/README.md",
    "docs/design/life-console-trial-week-redesign/colors_and_type.css",
    "docs/design/life-console-trial-week-redesign/pages/overview.html",
    "docs/design/life-console-trial-week-redesign/pages/capture.html",
    "docs/design/life-console-trial-week-redesign/pages/insights.html",
    "docs/design/life-console-trial-week-redesign/pages/system.html",
    "docs/design/life-console-apple-ui-ue-guidelines.md",
    "skills/improve-daily-life/SKILL.md",
    "skills/improve-daily-life/agents/openai.yaml",
    "skills/improve-daily-life/references/core-system-prompt.md",
    "skills/improve-daily-life/references/journaling.md",
    "skills/improve-daily-life/references/workflow-prompts.md",
    "skills/improve-daily-life/references/evals.md",
]

TEXT_SUFFIXES = {".json", ".md", ".mjs", ".py", ".ts", ".tsx", ".txt", ".yaml", ".yml"}
EXCLUDED_DIRS = {
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
MACHINE_PATH_PATTERNS = (
    re.compile(r"/Users/[A-Za-z0-9._-]+/"),
    re.compile(r"/private/(?:tmp|var)/"),
)
SECRET_PATTERNS = (
    re.compile(
        r"-----BEGIN (?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----"
        r"|-----BEGIN PGP " r"PRIVATE KEY BLOCK-----"
    ),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bghp_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
    re.compile(
        r"(?i)\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\b"
        r"\s*[:=]\s*[\"']?[A-Za-z0-9._~+/=-]{8,}"
    ),
    re.compile(r"(?i)authorization:\s*bearer\s+[A-Za-z0-9._-]{16,}"),
)

AUTOMATION_REGISTRY = "automations/registry.json"
AUTOMATION_KEY = "life-checkin"
AUTOMATION_FIELDS = {
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
AUTOMATION_SCHEDULE_FIELDS = {"frequency", "weekday"}
AUTOMATION_WEEKDAYS = {"MO", "TU", "WE", "TH", "FR", "SA", "SU"}
JOURNAL_REVIEW_POLICY = "journal/review-policy.json"


def validate_journal_normalization_contract(
    root: Path,
    errors: list[str],
) -> None:
    contract_path = (
        root
        / "apps/life-console/contracts/journal-normalization-v1.json"
    )
    if not contract_path.is_file():
        errors.append("缺少统一日记整理契约")
        return
    try:
        contract = json.loads(contract_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        errors.append("统一日记整理契约不是有效 UTF-8 JSON")
        return
    if (
        not isinstance(contract, dict)
        or contract.get("contract_version") != "journal-normalization/1.0.0"
        or not isinstance(contract.get("prompt_version"), str)
        or re.fullmatch(
            r"journal-normalization-prompt/\d+\.\d+\.\d+",
            contract["prompt_version"],
        ) is None
        or not isinstance(contract.get("system_prompt"), str)
        or not contract.get("system_prompt")
        or not isinstance(contract.get("schema"), dict)
    ):
        errors.append("统一日记整理契约版本、Prompt 或 Schema 不完整")
    schema = contract.get("schema") if isinstance(contract, dict) else None
    required_normalization_fields = (
        schema.get("required") if isinstance(schema, dict) else None
    )
    properties = schema.get("properties") if isinstance(schema, dict) else None
    display_fields = contract.get("display_fields")
    if (
        not isinstance(display_fields, list)
        or not isinstance(required_normalization_fields, list)
        or not isinstance(properties, dict)
        or set(properties) != set(required_normalization_fields)
        or [item.get("key") for item in display_fields if isinstance(item, dict)]
        != required_normalization_fields
        or any(
            not isinstance(item, dict)
            or not isinstance(item.get("label"), str)
            or not item.get("label")
            for item in display_fields or []
        )
    ):
        errors.append("统一日记整理契约展示字段与 Schema 不一致")

    required_routes = {
        "journal/QUICK_CAPTURE.md": "journal-normalization-v1.json",
        "journal/README.md": "journal-normalization-v1.json",
        "tools/life_console_cloud.py": "validate_normalization",
        "apps/life-console/src/journal/normalization-contract.ts":
            "journal-normalization-v1.json",
        "apps/life-console/src/features/journals/JournalStructuredView.tsx":
            "journalNormalizationFields",
        "apps/life-console/src/features/records/RecordsPage.tsx":
            "journalNormalizationFields",
        "apps/life-console/src/server/deepseek-normalizer.ts":
            "buildJournalNormalizationMessages",
        "apps/life-console/src/server/journal-normalization-service.ts":
            "journalContractVersion",
        "apps/life-console/src/supabase/dashboard.ts": "createRaw",
    }
    for relative, marker in required_routes.items():
        path = root / relative
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            errors.append(f"统一日记活跃路由缺失：{relative}")
            continue
        if marker not in text:
            errors.append(f"活跃日记路由未绑定统一契约版本：{relative}")

    service_path = (
        root
        / "apps/life-console/src/server/journal-normalization-service.ts"
    )
    if service_path.is_file():
        service = service_path.read_text(encoding="utf-8")
        if "journalPromptVersion" not in service:
            errors.append("活跃日记路由未绑定统一契约版本：服务端 Prompt")

    active_prompt_roots = [
        root / "apps/life-console/src/server",
        root / "apps/life-console/src/supabase",
    ]
    for directory in active_prompt_roots:
        if not directory.is_dir():
            continue
        for path in directory.rglob("*.ts"):
            text = path.read_text(encoding="utf-8")
            if re.search(r"\b(?:SYSTEM_PROMPT|JOURNAL_PROMPT)\s*=", text):
                errors.append(
                    "发现第二份活跃日记 Prompt："
                    + str(path.relative_to(root))
                )

    config_path = (
        root
        / "apps/life-console/scripts/supabase-candidate-config.mjs"
    )
    try:
        config = config_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        errors.append("缺少 DeepSeek 服务端 Key 部署边界")
    else:
        if (
            "VITE_DEEPSEEK_API_KEY" not in config
            or "must remain server-only" not in config
        ):
            errors.append("浏览器 DeepSeek Key 未被配置门禁拒绝")
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
WEEKLY_RECORD_FIELDS = {
    "schema_version",
    "key",
    "iso_week",
    "week_start",
    "week_end",
    "answers",
    "revision",
    "created_at",
    "updated_at",
}
WEEKLY_SUMMARY_FIELDS = {
    "better_summary",
    "friction_summary",
    "experiment_summary",
    "stop_summary",
}
WEEKLY_ANSWER_FIELDS = WEEKLY_SUMMARY_FIELDS | {"goal_intent"}
WEEKLY_GOAL_INTENTS = {
    "continue",
    "adjust",
    "downgrade",
    "pause",
    "complete",
    "replace",
    "unsure",
}
WEEKLY_TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def _reject_json_constant(_: str) -> None:
    raise ValueError("invalid JSON constant")


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _load_strict_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=_unique_json_object,
        parse_constant=_reject_json_constant,
    )
    if not isinstance(payload, dict):
        raise ValueError("JSON root is not an object")
    return payload


def _canonical_date(value: object) -> date | None:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.isoformat() == value else None


def validate_journal_review_policy(errors: list[str]) -> None:
    """Validate the portable cadence decision without choosing it for the user."""

    policy_path = ROOT / JOURNAL_REVIEW_POLICY
    if policy_path.is_symlink() or not policy_path.is_file():
        return
    try:
        policy = _load_strict_json_object(policy_path)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
        errors.append("日记整理节奏策略无法安全读取")
        return
    if set(policy) != JOURNAL_REVIEW_POLICY_FIELDS:
        errors.append("日记整理节奏策略字段集无效")
        return

    cadence = policy.get("long_term_cadence")
    if (
        type(policy.get("schema_version")) is not int
        or policy["schema_version"] != 1
        or policy.get("timezone") != JOURNAL_REVIEW_TIMEZONE
        or policy.get("trial_weekly_start") != JOURNAL_TRIAL_WEEKLY_START
        or policy.get("trial_weekly_end") != JOURNAL_TRIAL_WEEKLY_END
        or cadence not in JOURNAL_REVIEW_CADENCES
    ):
        errors.append("日记整理节奏策略字段值无效")
        return

    effective = _canonical_date(policy.get("long_term_effective_from"))
    decided = _canonical_date(policy.get("decided_on"))
    if cadence == "pending_user_choice":
        if policy.get("long_term_effective_from") is not None or policy.get("decided_on") is not None:
            errors.append("日记整理节奏策略日期与待选择状态不一致")
    elif effective is None or decided is None or decided > effective:
        errors.append("日记整理节奏策略日期与长期选择不一致")

    registry_path = ROOT / AUTOMATION_REGISTRY
    if not registry_path.is_file() or registry_path.is_symlink():
        return
    try:
        registry = _load_strict_json_object(registry_path)
        contracts = registry.get("automations")
        contract = next(
            item
            for item in contracts
            if isinstance(item, dict) and item.get("key") == AUTOMATION_KEY
        )
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError, TypeError, StopIteration):
        return
    if cadence == "pending_user_choice":
        if (
            contract.get("start") != policy.get("trial_weekly_start")
            or contract.get("end") != policy.get("trial_weekly_end")
            or contract.get("timezone") != policy.get("timezone")
        ):
            errors.append("日记试运行节奏与主动回访契约不一致")
    elif cadence == "weekly":
        contract_start = _canonical_date(contract.get("start"))
        weekday_index = {
            "MO": 0,
            "TU": 1,
            "WE": 2,
            "TH": 3,
            "FR": 4,
            "SA": 5,
            "SU": 6,
        }.get(contract.get("weekday"))
        if (
            effective is None
            or contract_start is None
            or contract.get("timezone") != policy.get("timezone")
            or contract.get("frequency") != "weekly"
            or weekday_index is None
            or contract_start < effective
            or (contract_start - effective).days >= 7
            or contract_start.weekday() != weekday_index
        ):
            errors.append("日记长期节奏与主动回访契约不一致")


def validate_journal_source_graph(errors: list[str]) -> None:
    try:
        inspect_journal_graph(ROOT / "journal")
    except (JournalIntegrityError, OSError):
        errors.append("日记机器索引与月度原文的双向完整性校验未通过")


def validate_optional_phase_reviews(errors: list[str]) -> None:
    """Treat an absent phase ledger as empty and an unsafe existing one as invalid."""

    try:
        inspect_phase_reviews(ROOT / "records")
    except (PhaseReviewError, OSError, KeyError, TypeError, ValueError):
        errors.append("阶段复盘台账结构或路径无法安全验证")


def validate_optional_insight_ledger(errors: list[str]) -> None:
    """Validate the optional candidate ledger without exposing candidate content."""

    try:
        report = inspect_insight_ledger(ROOT / "journal")
        if not report.get("valid"):
            raise InsightError("候选台账检查未通过")
    except (InsightError, OSError, KeyError, TypeError, ValueError):
        errors.append("日记候选认识确认台账结构、权限或路径无法安全验证")


def validate_optional_phase_actions(errors: list[str]) -> None:
    """Validate the optional action ledger without exposing desired values."""

    try:
        report = inspect_phase_actions(ROOT / "records")
        if not report.get("valid"):
            raise PhaseActionError("阶段动作台账检查未通过")
    except (PhaseActionError, OSError, KeyError, TypeError, ValueError):
        errors.append("阶段复盘动作台账结构、权限或路径无法安全验证")


def parse_simple_frontmatter(text: str) -> dict[str, str]:
    match = re.match(r"\A---\n(.*?)\n---(?:\n|\Z)", text, re.DOTALL)
    if not match:
        raise ValueError("SKILL.md 缺少有效 YAML frontmatter")

    result: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.startswith((" ", "\t")) or ":" not in line:
            raise ValueError("便携验证器只接受当前 Skill 使用的单行 frontmatter")
        key, value = line.split(":", 1)
        result[key.strip()] = value.strip().strip('"').strip("'")
    return result


def iter_text_files() -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        if any(part in EXCLUDED_DIRS for part in path.relative_to(ROOT).parts) or ".DS_Store" in path.parts:
            continue
        files.append(path)
    return sorted(files)


def validate_optional_weekly_records(path: Path, errors: list[str]) -> None:
    """Validate the optional ledger exactly enough to fail closed on corrupt restores."""

    if path.is_symlink() or (path.exists() and not path.is_file()):
        errors.append("可选周复盘台账不是普通项目文件：records/weekly-reviews.jsonl")
        return
    if not path.is_file():
        return
    try:
        text = path.read_bytes().decode("utf-8")
    except (OSError, UnicodeError):
        errors.append("可选周复盘台账无法安全读取或不是 UTF-8")
        return

    def reject_constant(_: str) -> None:
        raise ValueError("JSON 常量无效")

    def unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("JSON 字段重复")
            result[key] = value
        return result

    seen_keys: set[str] = set()
    seen_weeks: set[str] = set()
    seen_starts: set[str] = set()
    for line_number, line_text in enumerate(text.splitlines(), 1):
        if not line_text.strip():
            continue
        prefix = f"可选周复盘台账第 {line_number} 行"
        try:
            record = json.loads(
                line_text,
                object_pairs_hook=unique_object,
                parse_constant=reject_constant,
            )
        except (json.JSONDecodeError, ValueError):
            errors.append(f"{prefix}不是严格有效的 JSON")
            continue
        if not isinstance(record, dict) or set(record) != WEEKLY_RECORD_FIELDS:
            errors.append(f"{prefix}的字段集无效")
            continue
        if type(record.get("schema_version")) is not int or record["schema_version"] != 1:
            errors.append(f"{prefix}的 schema_version 无效")
            continue

        week_start = record.get("week_start")
        try:
            start = date.fromisoformat(week_start) if isinstance(week_start, str) else None
        except ValueError:
            start = None
        if start is None or start.isoformat() != week_start or start.weekday() != 0:
            errors.append(f"{prefix}的自然周起日无效")
            continue
        iso_year, iso_number, iso_weekday = start.isocalendar()
        iso_week = f"{iso_year:04d}-W{iso_number:02d}"
        expected_week = {
            "key": f"weekly-review:{iso_week}",
            "iso_week": iso_week,
            "week_start": start.isoformat(),
            "week_end": (start + timedelta(days=6)).isoformat(),
        }
        if iso_weekday != 1 or any(record.get(field) != value for field, value in expected_week.items()):
            errors.append(f"{prefix}的自然周或稳定键无效")
            continue

        revision = record.get("revision")
        if type(revision) is not int or revision < 1:
            errors.append(f"{prefix}的 revision 无效")

        timestamps: dict[str, datetime] = {}
        for field in ("created_at", "updated_at"):
            value = record.get(field)
            if not isinstance(value, str) or not WEEKLY_TIMESTAMP_RE.fullmatch(value):
                errors.append(f"{prefix}的 {field} 无效")
                continue
            try:
                timestamps[field] = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
            except ValueError:
                errors.append(f"{prefix}的 {field} 无效")
        if set(timestamps) == {"created_at", "updated_at"} and timestamps["created_at"] > timestamps["updated_at"]:
            errors.append(f"{prefix}的时间顺序无效")

        answers = record.get("answers")
        if not isinstance(answers, dict) or set(answers) != WEEKLY_ANSWER_FIELDS:
            errors.append(f"{prefix}的 answers 结构无效")
        else:
            for field in WEEKLY_SUMMARY_FIELDS:
                value = answers[field]
                if value is not None and (
                    not isinstance(value, str)
                    or not value
                    or len(value) > 160
                    or re.sub(r"\s+", " ", value).strip() != value
                ):
                    errors.append(f"{prefix}的 answers.{field} 无效")
            goal_intent = answers["goal_intent"]
            if goal_intent is not None and (
                not isinstance(goal_intent, str) or goal_intent not in WEEKLY_GOAL_INTENTS
            ):
                errors.append(f"{prefix}的 answers.goal_intent 无效")
            if all(answers[field] is None for field in WEEKLY_ANSWER_FIELDS):
                errors.append(f"{prefix}不能是全空周记录")

        key = expected_week["key"]
        if key in seen_keys or iso_week in seen_weeks or start.isoformat() in seen_starts:
            errors.append("可选周复盘台账存在重复自然周或稳定键")
        seen_keys.add(key)
        seen_weeks.add(iso_week)
        seen_starts.add(start.isoformat())


def validate_product_surface_lifecycle(errors: list[str]) -> None:
    try:
        load_product_surfaces(ROOT)
    except (ProductSurfaceError, OSError, ValueError):
        errors.append("展示层生命周期清单缺失、无效或不是规范状态")


def validate_design_governance(errors: list[str]) -> None:
    design_root = ROOT / "docs" / "design"
    top_system = design_root / "apple-top-level-design-system"
    prototype = design_root / "life-console-trial-week-redesign"
    guideline = design_root / "life-console-apple-ui-ue-guidelines.md"

    consumption_path = top_system / "design-system-consumption.json"
    metadata_path = top_system / "metadata.json"
    try:
        consumption = json.loads(consumption_path.read_text(encoding="utf-8"))
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        errors.append("UI 顶层设计系统配置无法安全读取")
        return

    if not isinstance(metadata, dict) or metadata.get("projectRole") != (
        "Life Console top-level UI design system"
    ):
        errors.append("UI 顶层设计系统元数据缺少项目角色")
    project_consumption = consumption.get("projectConsumption")
    if not isinstance(project_consumption, dict):
        errors.append("UI 顶层设计系统缺少项目消费配置")
        return
    expected_links = {
        "prototypePackage": "../life-console-trial-week-redesign",
        "uiGuidelines": "../life-console-apple-ui-ue-guidelines.md",
        "tokenCSS": "colors_and_type.css",
        "componentCSS": "components.css",
    }
    for field, expected in expected_links.items():
        if project_consumption.get(field) != expected:
            errors.append(f"UI 顶层设计系统消费配置字段无效：{field}")

    required_prototype_pages = {
        "overview.html",
        "capture.html",
        "insights.html",
        "system.html",
    }
    actual_pages = {
        path.name
        for path in (prototype / "pages").glob("*.html")
        if path.is_file() and not path.is_symlink()
    }
    if actual_pages != required_prototype_pages:
        errors.append("Life Console 当前设计原型页面集合无效")

    try:
        governance_text = (design_root / "README.md").read_text(encoding="utf-8")
        guideline_text = guideline.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        errors.append("UI 设计治理文档无法安全读取")
        return
    for snippet, label in {
        "apple-top-level-design-system": "顶层设计系统入口",
        "life-console-trial-week-redesign": "当前试行周原型入口",
        "life-console-apple-ui-ue-guidelines.md": "长期 UI/UE 规范入口",
    }.items():
        if snippet not in governance_text:
            errors.append(f"UI 设计治理文档缺少：{label}")
    for snippet, label in {
        "降低认知负担": "低认知负担原则",
        "保留用户控制感": "用户确认原则",
        "守住真相源边界": "真相源边界",
        "避免压力型反馈": "非压力反馈原则",
    }.items():
        if snippet not in guideline_text:
            errors.append(f"UI/UE 长期规范缺少：{label}")


def validate_automation_registry(errors: list[str]) -> None:
    registry_path = ROOT / AUTOMATION_REGISTRY
    if not registry_path.is_file() or registry_path.is_symlink():
        return
    try:
        payload = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        errors.append("自动化注册表无法安全读取")
        return
    if (
        not isinstance(payload, dict)
        or set(payload) != {"schema_version", "automations"}
        or payload.get("schema_version") != 1
        or not isinstance(payload.get("automations"), list)
        or not payload["automations"]
    ):
        errors.append("自动化注册表结构或版本无效")
        return

    contracts: dict[str, dict[str, object]] = {}
    for item in payload["automations"]:
        if not isinstance(item, dict) or set(item) not in {
            frozenset(AUTOMATION_FIELDS),
            frozenset(AUTOMATION_FIELDS | AUTOMATION_SCHEDULE_FIELDS),
        }:
            errors.append("自动化注册表中的契约结构无效")
            return
        key = item.get("key")
        if (
            not isinstance(key, str)
            or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", key)
            or key in contracts
        ):
            errors.append("自动化注册表中的契约键无效或重复")
            return
        contracts[key] = item

    contract = contracts.get(AUTOMATION_KEY)
    if contract is None:
        errors.append("自动化注册表缺少生活状态回访契约")
        return
    name = contract.get("name")
    timezone_name = contract.get("timezone")
    local_time = contract.get("local_time")
    max_jitter = contract.get("max_scheduler_jitter_seconds")
    prompt_hash = contract.get("prompt_sha256")
    frequency = contract.get("frequency", "daily")
    weekday = contract.get("weekday")
    if (
        not isinstance(name, str)
        or not name.strip()
        or name != name.strip()
        or len(name) > 200
        or "\n" in name
        or "\r" in name
        or contract.get("kind") != "heartbeat"
        or contract.get("desired_status") != "ACTIVE"
        or not isinstance(timezone_name, str)
        or not isinstance(local_time, str)
        or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", local_time)
        or contract.get("runtime_time_basis") != "utc"
        or isinstance(max_jitter, bool)
        or not isinstance(max_jitter, int)
        or not 0 <= max_jitter <= 3600
        or not isinstance(prompt_hash, str)
        or not re.fullmatch(r"[0-9a-f]{64}", prompt_hash)
        or frequency not in {"daily", "weekly"}
        or (frequency == "daily" and weekday is not None)
        or (frequency == "weekly" and weekday not in AUTOMATION_WEEKDAYS)
    ):
        errors.append("生活状态回访契约的字段值无效")
        return
    start_value = contract.get("start")
    end_value = contract.get("end")
    if (
        not isinstance(start_value, str)
        or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start_value)
        or not isinstance(end_value, str)
        or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end_value)
    ):
        errors.append("生活状态回访契约的日期或时区无效")
        return
    try:
        ZoneInfo(timezone_name)
        start = date.fromisoformat(start_value)
        end = date.fromisoformat(end_value)
    except (ZoneInfoNotFoundError, ValueError):
        errors.append("生活状态回访契约的日期或时区无效")
        return
    if start > end:
        errors.append("生活状态回访契约的生效范围无效")
        return

    prompt_value = contract.get("prompt_file")
    if not isinstance(prompt_value, str) or not prompt_value.strip():
        errors.append("生活状态回访契约的提示词路径无效")
        return
    prompt_relative = Path(prompt_value)
    if (
        prompt_relative.is_absolute()
        or ".." in prompt_relative.parts
        or not prompt_relative.parts
        or prompt_relative.parts[0] != "automations"
        or prompt_relative.suffix.lower() != ".txt"
    ):
        errors.append("生活状态回访契约的提示词路径不安全")
        return
    prompt_path = ROOT / prompt_relative
    try:
        prompt_path.resolve().relative_to(ROOT.resolve())
    except (OSError, ValueError):
        errors.append("生活状态回访契约的提示词路径不安全")
        return
    if prompt_path.is_symlink() or not prompt_path.is_file():
        errors.append("生活状态回访的规范提示词缺失或不是普通项目文件")
        return
    try:
        prompt_bytes = prompt_path.read_bytes()
        prompt_text = prompt_bytes.decode("utf-8")
    except (OSError, UnicodeError):
        errors.append("生活状态回访的规范提示词无法安全读取")
        return
    if len(prompt_bytes) > 1024 * 1024 or not prompt_text.rstrip("\r\n"):
        errors.append("生活状态回访的规范提示词为空或异常")
        return
    if hashlib.sha256(prompt_bytes).hexdigest() != prompt_hash:
        errors.append("生活状态回访的规范提示词 SHA-256 不匹配")
    if frequency == "weekly":
        for snippet, label in {
            "review-plan --type weekly": "日记周回顾补漏计划",
            "source_set_etag": "日记回顾完整来源集合指纹",
            "daily_checkin.py week-summary": "周复盘结构化摘要字段",
            "tools/weekly_review.py upsert": "周复盘按自然周 upsert",
            "周一至周日": "周回顾的自然周边界",
            "不得写入每日状态": "周复盘回答不是每日状态",
            "--note-summary": "周复盘禁止写入每日 note_summary",
            "不自动同步": "派生展示保持按需刷新",
        }.items():
            if snippet not in prompt_text:
                errors.append(f"生活状态回访规范提示词缺少流程：{label}")
        return
    for snippet, label in {
        "tools/daily_checkin.py upsert": "用户回答后的同日状态 upsert",
        "tools/daily_checkin.py purge-plan": "每日状态删除前只读预览",
        "record_etag": "每日状态删除内容冲突保护",
        "tools/google_sheets_payload.mjs": "状态写入后的 Google 展示载荷",
        "tools/google_sheets_state.py mark-success": "Google 展示读回后的成功收据",
        "每日记录”D:P、每周复盘和日记索引都是只读派生视图": "Google 展示来源边界",
        "外部失败不得回滚本地写入": "iCloud 本地优先与非阻塞外部失败",
        "即使是周日也按普通日期": "首日使用普通回访",
        "除 2026-08-02 外，如果当天是周日": "首日排除周复盘",
        "除 2026-08-02 外，如果当天是周一": "闭合自然周的周一日记整理",
        "journal_manager.py review-plan --type weekly": "日记周回顾补漏计划",
        "source_set_etag": "日记回顾完整来源集合指纹",
        "全部已有就跳过重复询问，部分已有则只问缺项": "已有回答只抑制重复问题",
        "必须使用 `1.`、`2.`、`3.`": "普通回访编号换行",
        "这四个分数都记在 YYYY-MM-DD": "四项评分明示同一当天日期",
        "`1` 很差、明显影响日常": "四项状态评分标准",
        "需要打分的只有四项——睡眠质量、精力、情绪、生活实感": "明确需要评分的四项",
        "起床、身体/光照、生活动作和晚间降速都不打分": "明确锚点不使用评分",
        "records/apple-health-latest.txt": "苹果健康摘要预读取",
        "差值 `≤60` 分钟采用设备精确值": "苹果健康近似时间精确化",
        "`≥120` 分钟只问一个确认问题": "苹果健康严重冲突确认",
        "tools/apple_health_sleep.py resolve": "苹果健康睡眠逐字段解析",
        "设备绝不填写离床": "苹果健康与离床字段隔离",
        "其他任何字段都不能从设备数据补齐": "苹果健康主客观数据边界",
        "昨晚至今早的 --sleep-time": "今晨睡眠与起床归入今天",
        "截至回访时的 --energy、--mood、--life-feeling": "当前三项主观评分归入今天",
        "昨天只写入回顾的 --life-action 和 --wind-down": "昨日只回顾收尾锚点",
        "--clear-field 与当前 --expect-revision": "误归字段精确清空",
        "“还没做”与未回答字段都不传": "尚未发生不误记为跳过",
        "静默日记维护仍须执行": "周一维护不被当日回答提前终止",
        "周一至周日自然周": "周回顾的自然周边界",
        "有帮助、一般还是打扰": "主动回访体验复盘",
        "继续每日、降为每周、仅按需、暂停或暂不决定": "主动回访后续节奏选择",
        "第一条阶段复盘最多三个回答组": "阶段复盘低负担上限",
        "不在同一条消息追问身体限制": "健身准备度分批询问",
        "先展示一次性提醒的日期、当地时间和目标": "职业复盘提醒预览",
        "取得当次明确确认后才创建提醒": "职业复盘提醒审批",
        "2026-08-14 之后没有新选择就保持安静": "首轮结束不默认续期",
        "仅回复“今天跳过”": "泛化拒答不留痕",
        "即使正文偶然提到睡眠或情绪": "显式日记不复制到状态台账",
        "普通问题、提醒时间或频率设置": "非状态意图不误写",
        "action 为 created、updated 或 unchanged": "日状态写入成功判定",
        "tools/phase_review.py upsert": "阶段复盘回答台账",
        "--review-date 2026-08-14 --input -": "延迟阶段回复固定原复盘日并使用 stdin",
        "checkin_experience=helpful|neutral|disruptive|undecided": "回访体验枚举不丢失",
        "life_experience_signal": "阶段复盘保留整体生活体验信号",
        "planning_changes_not_applied=true": "阶段回答与目标节奏分层",
        "tools/phase_actions.py plan": "阶段回答派生可恢复动作",
        "tools/phase_actions.py apply-plan": "阶段待执行动作只读恢复",
        "tools/phase_actions.py mark": "阶段动作精确记录结果",
        "pending/failed": "阶段动作恢复范围",
        "只有 next_track=career": "职业时点动作受已选分支门控",
        "只有 next_track=fitness": "健身对话动作受已选分支门控",
        "tools/phase_review.py purge-plan": "阶段复盘删除预览",
        "tools/journal_review_policy.py show": "日记长期节奏陈旧状态保护",
        "tools/journal_insights.py plan": "日记回顾候选认识规划",
        "journal_insights.py decide": "候选认识显式决策",
        "journal_insights.py propose": "接受后保存精确长期文件提案",
        "apply-plan --input -": "候选提案精确展示",
        "mark-applied --input -": "长期文件实际写入后再标记",
    }.items():
        if snippet not in prompt_text:
            errors.append(f"生活状态回访规范提示词缺少流程：{label}")

    weekly_context = "\n".join(
        paragraph
        for paragraph in re.split(r"\n\s*\n", prompt_text)
        if any(
            marker in paragraph
            for marker in ("周复盘", "周回顾", "周回答", "week-summary", "weekly_review.py")
        )
    )
    for snippet, label in {
        "week-summary": "周复盘结构化摘要字段",
        "tools/weekly_review.py upsert": "周复盘按 ISO 自然周 upsert",
    }.items():
        if snippet not in prompt_text:
            errors.append(f"生活状态回访规范提示词缺少流程：{label}")
    if not re.search(
        r"(?:不得|不能|禁止|不可|不要|不使用).{0,100}--note-summary"
        r"|--note-summary.{0,100}(?:不得|不能|禁止|不可|不要|不使用)",
        weekly_context,
        re.DOTALL,
    ):
        errors.append("生活状态回访规范提示词缺少流程：周复盘禁止写入每日 note_summary")
    if not re.search(
        r"(?:不是|不作为|不写入|不得写入|不能写入|不可写入).{0,120}每日状态"
        r"|每日状态.{0,120}(?:不是|不作为|不写入|不得写入|不能写入|不可写入)",
        weekly_context,
        re.DOTALL,
    ):
        errors.append("生活状态回访规范提示词缺少流程：周复盘回答不是每日状态")
    weekly_upsert_position = prompt_text.find("tools/weekly_review.py upsert")
    if weekly_upsert_position >= 0 and prompt_text.find(
        "tools/google_sheets_payload.mjs", weekly_upsert_position
    ) < 0:
        errors.append("生活状态回访规范提示词缺少流程：周复盘写入后的 Google 展示刷新")


def validate() -> list[str]:
    errors: list[str] = []

    for relative in REQUIRED_FILES:
        if not (ROOT / relative).is_file():
            errors.append(f"缺少必需文件：{relative}")

    for relative, label in {
        "docs/code-wiki": "第二套 Code Wiki",
        "docs/design/life-console-apple-redesign": "上一版 Life Console 设计",
        "web/life-dashboard": "已归档移动网页源码",
    }.items():
        if (ROOT / relative).exists():
            errors.append(f"活动树仍包含应移除的重复内容：{label}")
    apps_root = ROOT / "apps"
    active_apps = sorted(
        path.name
        for path in apps_root.iterdir()
        if path.is_dir() and not path.is_symlink()
    ) if apps_root.is_dir() else []
    if active_apps != ["life-console"]:
        errors.append("活动应用目录必须且只能包含 apps/life-console")

    errors.extend(inspect_project_governance(ROOT))

    # 周复盘台账是首次有效周回答后才创建的可选真相来源。缺失等于空台账，
    # 但一旦存在就必须是当前项目内可安全读取的普通 JSONL 文件。
    validate_optional_weekly_records(
        ROOT / "records" / "weekly-reviews.jsonl",
        errors,
    )

    symlinks = [
        path.relative_to(ROOT)
        for path in ROOT.rglob("*")
        if path.is_symlink()
        and path.relative_to(ROOT) != LEGACY_GOVERNANCE_LINK
        and not any(part in EXCLUDED_DIRS for part in path.relative_to(ROOT).parts)
    ]
    if symlinks:
        errors.append("存在不可移植的符号链接：" + ", ".join(map(str, symlinks)))
    legacy_link = ROOT / LEGACY_GOVERNANCE_LINK
    if legacy_link.is_symlink():
        try:
            link_target = Path(legacy_link.readlink())
        except OSError:
            errors.append("旧规范兼容链接无法安全读取")
        else:
            if link_target != LEGACY_GOVERNANCE_TARGET:
                errors.append("旧规范兼容链接没有指向唯一规范正文")
            else:
                try:
                    same_body = legacy_link.read_bytes() == (
                        ROOT / "docs/governance/agent-user-project-development-standard.md"
                    ).read_bytes()
                except OSError:
                    same_body = False
                if not same_body:
                    errors.append("旧规范兼容链接与唯一规范正文不一致")
    elif legacy_link.exists():
        errors.append("旧规范兼容路径必须是指向唯一正文的相对软链接")

    validate_automation_registry(errors)
    validate_journal_review_policy(errors)
    validate_journal_source_graph(errors)
    validate_optional_phase_reviews(errors)
    validate_optional_insight_ledger(errors)
    validate_optional_phase_actions(errors)
    validate_design_governance(errors)
    validate_product_surface_lifecycle(errors)
    validate_journal_normalization_contract(ROOT, errors)

    skill_path = SKILL_DIR / "SKILL.md"
    if skill_path.is_file():
        try:
            frontmatter = parse_simple_frontmatter(skill_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, ValueError) as exc:
            errors.append(str(exc))
            frontmatter = {}

        if set(frontmatter) != {"name", "description"}:
            errors.append("SKILL.md frontmatter 必须只含 name 和 description")
        name = frontmatter.get("name", "")
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
            errors.append(f"Skill 名称不合法：{name!r}")
        if name != SKILL_DIR.name:
            errors.append("Skill 名称与目录名不一致")
        description = frontmatter.get("description", "")
        if not description or len(description) > 1024 or "<" in description or ">" in description:
            errors.append("Skill description 为空、过长或包含尖括号")

        for relative in re.findall(r"\]\(((?:references|assets)/[^)]+)\)", skill_path.read_text(encoding="utf-8")):
            if not (SKILL_DIR / relative).is_file():
                errors.append(f"SKILL.md 引用了不存在的文件：{relative}")

    metadata_path = SKILL_DIR / "agents" / "openai.yaml"
    if metadata_path.is_file():
        metadata = metadata_path.read_text(encoding="utf-8")
        for field in ("display_name", "short_description", "default_prompt"):
            if not re.search(rf"^\s+{field}:\s+\".+\"\s*$", metadata, re.MULTILINE):
                errors.append(f"openai.yaml 缺少带引号的 {field}")
        if "$improve-daily-life" not in metadata:
            errors.append("openai.yaml 的 default_prompt 未显式引用 Skill")

    for path in iter_text_files():
        relative = path.relative_to(ROOT)
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeError:
            errors.append(f"文本文件不是 UTF-8：{relative}")
            continue

        if path.name != "validate_project.py":
            for pattern in MACHINE_PATH_PATTERNS:
                if pattern.search(text):
                    errors.append(f"包含旧机器绝对路径：{relative}")
                    break
            for pattern in SECRET_PATTERNS:
                if pattern.search(text):
                    errors.append(f"疑似包含高风险秘密：{relative}")
                    break

        if path.suffix.lower() == ".md":
            if sum(line.startswith("```") for line in text.splitlines()) % 2:
                errors.append(f"Markdown 代码围栏不成对：{relative}")

            for link in re.findall(r"\]\(([^)]+)\)", text):
                if link.startswith(("http://", "https://", "#", "mailto:")):
                    continue
                target = link.split("#", 1)[0].strip("<>")
                if target and not (path.parent / target).resolve().exists():
                    errors.append(f"本地链接失效：{relative} -> {link}")

    workflow_path = SKILL_DIR / "references" / "workflow-prompts.md"
    if workflow_path.is_file():
        workflow_text = workflow_path.read_text(encoding="utf-8")
        numbers = [int(value) for value in re.findall(r"^## (\d+)\.", workflow_text, re.MULTILINE)]
        if numbers != list(range(1, 15)):
            errors.append(f"工作流 Prompt 编号应为 1–14，实际为 {numbers}")
        for snippet, label in {
            "time_precision=unknown": "未知事件时间不制造假精度",
            "recorded_at": "事件时间与真实记录时间分离",
            "先用 `review-plan`": "闭合周期补漏计划",
            "source_set_etag": "回顾来源集合漂移保护",
            "尚未选择长期频率时只在用户提出时整理": "未选择长期节奏时保持按需",
        }.items():
            if snippet not in workflow_text:
                errors.append(f"工作流 Prompt 缺少日记契约：{label}")
        if "没有日期时用当前 Asia/Shanghai 日期时间" in workflow_text:
            errors.append("工作流 Prompt 不得用当前日期时间制造日记事件时刻")

    core_prompt_path = SKILL_DIR / "references" / "core-system-prompt.md"
    if core_prompt_path.is_file():
        core_prompt_text = core_prompt_path.read_text(encoding="utf-8")
        for snippet, label in {
            "没有具体发生时刻就保存为未知": "未知日记时刻",
            "周度在下一个周一处理已经结束的完整自然周": "闭合自然周",
            "未选择长期频率时保持按需": "长期日记节奏需用户选择",
            "source_set_etag": "回顾来源集合漂移保护",
        }.items():
            if snippet not in core_prompt_text:
                errors.append(f"主 Prompt 缺少日记契约：{label}")

    evals_path = SKILL_DIR / "references" / "evals.md"
    if evals_path.is_file():
        text = evals_path.read_text(encoding="utf-8")
        expected = {"T": 16, "N": 7, "F": 15, "S": 9}
        for prefix, count in expected.items():
            actual = len(re.findall(rf"^### {prefix}\d+\b", text, re.MULTILINE))
            if actual != count:
                errors.append(f"{prefix} 类评估应为 {count} 个，实际为 {actual} 个")

    daily_checkin_path = ROOT / "tools" / "daily_checkin.py"
    if daily_checkin_path.is_file():
        daily_checkin = daily_checkin_path.read_text(encoding="utf-8")
        for snippet, label in {
            'subparsers.add_parser("upsert"': "按日期幂等写入",
            'subparsers.add_parser("purge-plan"': "单日删除只读预览",
            'subparsers.add_parser("purge"': "单日精确删除",
            'subparsers.add_parser(\n        "migrate-v2"': "每日台账 v2 原子迁移",
            'f"daily-checkin:{checkin_date}"': "同日稳定键",
            '"--expect-revision"': "修订冲突保护",
            '"--expect-record-etag"': "删除内容哈希保护",
            '"--acknowledge-historical-copies"': "历史副本知情确认",
            '"--clear-field"': "单字段更正",
            '_records_lock': "并发文件锁",
            '_atomic_replace_if_unchanged': "写入前比较与原子替换",
            '_redact_summary': "短摘要去敏",
            '"--wake-time"': "最终醒来时间字段",
        }.items():
            if snippet not in daily_checkin:
                errors.append(f"每日状态工具缺少能力：{label}")

    apple_health_history_path = ROOT / "tools" / "apple_health_history.py"
    if apple_health_history_path.is_file():
        apple_health_history = apple_health_history_path.read_text(encoding="utf-8")
        for snippet, label in {
            'subparsers.add_parser("ingest"': "当日摘要归档",
            'subparsers.add_parser("list"': "按日期范围只读",
            'f"apple-health-summary:{record_date}"': "同日稳定键",
            '"--expect-date"': "陈旧摘要防护",
            '"--expect-today"': "无模型每日归档",
            '_records_lock': "并发文件锁",
            '_atomic_replace_if_unchanged': "写入前比较与原子替换",
            'MAX_SOURCE_BYTES': "不可信输入大小边界",
            'source_path.is_symlink()': "来源路径保护",
        }.items():
            if snippet not in apple_health_history:
                errors.append(f"苹果健康历史工具缺少能力：{label}")

    weekly_review_path = ROOT / "tools" / "weekly_review.py"
    if weekly_review_path.is_file():
        weekly_review = weekly_review_path.read_text(encoding="utf-8")
        for snippet, label in {
            'subparsers.add_parser("upsert"': "按 ISO 自然周幂等写入",
            'subparsers.add_parser("purge-plan"': "单周删除只读预览",
            'subparsers.add_parser("purge"': "单周精确删除",
            'f"weekly-review:{iso_week}"': "ISO 周稳定键",
            '"better_summary"': "变好事实短摘要",
            '"friction_summary"': "反复摩擦短摘要",
            '"experiment_summary"': "下周实验短摘要",
            '"stop_summary"': "停止或减少短摘要",
            '"goal_intent"': "明确目标决定",
            '"--week-start"': "周一到周日边界输入",
            '"--input"': "通过 stdin 接收结构化短摘要",
            '"--expect-revision"': "修订冲突保护",
            '"--expect-record-etag"': "删除内容哈希保护",
            '"--acknowledge-historical-copies"': "历史副本知情确认",
            '_records_lock': "并发文件锁",
            '_atomic_replace_if_unchanged': "写入前比较与原子替换",
            '_redact_summary': "周摘要去敏",
            '"workbook_sync_required"': "工作簿同步契约",
        }.items():
            if snippet not in weekly_review:
                errors.append(f"周复盘工具缺少能力：{label}")
        for forbidden, label in {
            "note_summary": "每日状态 note_summary",
            "raw_transcript": "原始对话字段",
        }.items():
            if forbidden in weekly_review:
                errors.append(f"周复盘工具不得保存或复用：{label}")

    phase_review_path = ROOT / "tools" / "phase_review.py"
    if phase_review_path.is_file():
        phase_review = phase_review_path.read_text(encoding="utf-8")
        for snippet, label in {
            'subparsers.add_parser("upsert"': "按复盘日幂等写入",
            'subparsers.add_parser("purge-plan"': "阶段复盘删除预览",
            'subparsers.add_parser("purge"': "阶段复盘精确删除",
            'f"phase-review:{normalized}"': "阶段复盘稳定键",
            '"checkin_experience"': "回访体验枚举",
            '"life_experience_signal"': "整体生活体验信号",
            '"planning_changes_not_applied"': "回答与规划动作分层",
            '"--expect-revision"': "修订冲突保护",
            '"--expect-record-etag"': "删除哈希保护",
            '"--acknowledge-historical-copies"': "历史副本知情",
            'inspect_phase_reviews': "可选台账无内容检查",
            'inspect_phase_review_snapshot': "备份固定字节检查",
        }.items():
            if snippet not in phase_review:
                errors.append(f"阶段复盘工具缺少能力：{label}")

    insight_tool_path = ROOT / "tools" / "journal_insights.py"
    if insight_tool_path.is_file():
        insight_tool = insight_tool_path.read_text(encoding="utf-8")
        for snippet, label in {
            '"propose"': "接受后保存精确提案",
            '"apply-plan"': "唯一返回精确提案的只读命令",
            '"mark-applied"': "长期文件实际写入后标记",
            'PLAN_LIMIT = 3': "每次最多三个候选",
            '"expect_candidate_etag"': "候选决策陈旧保护",
            '"awaiting_proposal"': "接受后待生成提案状态",
            '"proposed"': "待精确确认提案状态",
            '"applied"': "已验证写入状态",
            '"writes_long_term_files": False': "不自动写长期文件",
            '"superseded"': "回顾漂移候选失效",
            'TARGET_FILES = frozenset({"USER.md", "MEMORY.md", "GOALS.md"})': "长期文件目标白名单",
            '_target_contains_proposal': "标记前验证目标已包含精确文字",
            'inspect_insight_ledger': "无内容台账检查",
            'inspect_insight_snapshot': "备份固定字节检查",
            'st_nlink': "硬链接路径保护",
        }.items():
            if snippet not in insight_tool:
                errors.append(f"日记候选认识工具缺少能力：{label}")

    phase_actions_path = ROOT / "tools" / "phase_actions.py"
    if phase_actions_path.is_file():
        phase_actions = phase_actions_path.read_text(encoding="utf-8")
        for snippet, label in {
            'subparsers.add_parser("plan"': "从阶段回答派生动作",
            '"apply-plan", help="只读返回待执行或可重试动作"': "只读恢复待执行与失败动作",
            'subparsers.add_parser("mark"': "精确记录动作结果",
            'source_record_etag': "阶段回答来源漂移保护",
            'APPROVAL_REQUIREMENTS = ("none", "exact_change", "schedule_details")': "分级审批类型",
            'ACTION_STATES = (': "可恢复动作状态机",
            '"superseded"': "来源漂移失效",
            'inspect_phase_actions': "无内容实时检查",
            'inspect_phase_action_snapshot': "备份固定字节检查",
            'st_nlink': "硬链接路径保护",
        }.items():
            if snippet not in phase_actions:
                errors.append(f"阶段复盘动作工具缺少能力：{label}")

    journal_tool_path = ROOT / "tools" / "journal_manager.py"
    if journal_tool_path.is_file():
        journal_tool = journal_tool_path.read_text(encoding="utf-8")
        required_capabilities = {
            'subparsers.add_parser("add"': "新增日记",
            'subparsers.add_parser("amend"': "更正日记",
            'subparsers.add_parser("list"': "检索日记",
            'subparsers.add_parser("withdraw"': "撤回日记",
            '"withdraw-latest-implicit"': "按记录时间撤回最近隐式日记",
            'subparsers.add_parser("restore"': "恢复撤回",
            'subparsers.add_parser("purge"': "当前项目永久删除",
            '"purge-plan"': "永久删除只读预览",
            'subparsers.add_parser("review"': "生成周/月回顾",
            '"review-plan"': "闭合周期只读补漏计划",
            '"source_set_etag"': "完整回顾来源集合指纹",
            '_review_source_set_etag': "回顾写入前来源集合重验",
            '"people"': "人物索引",
            '"places"': "地点索引",
            '"themes"': "生活主题索引",
            '"weekly_reviews"': "周回顾状态",
            '"monthly_reviews"': "月回顾状态",
            '"invalidated_reviews"': "失效回顾状态",
            '"time_precision"': "未知或近似事件时间精度",
            'REINDEX_FIELDS': "内容更正完整重建轻量索引",
            'INDEX_ALLOWED_FIELDS': "机器索引严格字段白名单",
            'LIST_SAFE_FIELDS': "列表命令安全字段投影",
            '_mark_entry_withdrawn': "同月多条日记的局部撤回标记",
            '_unmark_entry_withdrawn': "同月多条日记的局部恢复标记",
            'acknowledge_historical_copies': "历史副本知情确认",
        }
        for snippet, label in required_capabilities.items():
            if snippet not in journal_tool:
                errors.append(f"日记工具缺少能力：{label}")

    journal_e2e_path = ROOT / "tools" / "test_journal_workbook_e2e.mjs"
    if journal_e2e_path.is_file():
        journal_e2e = journal_e2e_path.read_text(encoding="utf-8")
        for snippet, label in {
            '"withdraw-latest-implicit"': "按记录时间撤回的隔离演练",
            '"review-plan"': "闭合自然周回顾计划演练",
            'source_set_etag': "回顾来源集合漂移保护演练",
            'SpreadsheetFile.importXlsx': "工作簿导出结果复核",
            'formalWorkbookBefore': "正式工作簿未污染断言",
            'realJournalBefore': "真实日记未污染断言",
            'RAW-E2E-': "原文不进入索引与工作簿的隐私哨兵",
            '时间未知｜': "未知事件时间回顾显示",
            '约 21:00｜': "约略事件时间回顾显示",
        }.items():
            if snippet not in journal_e2e:
                errors.append(f"日记工作簿端到端测试缺少能力：{label}")

    journal_sync_path = ROOT / "tools" / "update_life_plan_journal.mjs"
    journal_records_path = ROOT / "tools" / "life_plan_records.mjs"
    if journal_sync_path.is_file() and journal_records_path.is_file():
        journal_sync = journal_sync_path.read_text(encoding="utf-8")
        journal_sync += "\n" + journal_records_path.read_text(encoding="utf-8")
        for snippet, label in {
            "loadJournalSource": "读取日记机器索引及快照",
            "journalTimeWorkbookValue": "日记时间按精确、约略或未知映射",
            'record.status === "active"': "仅同步有效记录",
            "monthly_reviews": "月回顾状态映射",
            "weekly_reviews": "周回顾状态映射",
            "journalRanges.clearRange": "按实际数量清理旧索引区域",
            "loadDailyCheckinSource": "读取幂等每日状态台账",
            "dailyCheckinWorkbookValues": "每日状态工作簿映射",
            "dailyWorkbookSyncPlan": "每日状态全量派生同步计划",
            'clear({ applyTo: "contents" })': "删除后清除旧派生值",
            "D:P 表头已漂移": "每日状态列漂移保护",
            "loadWeeklyReviewSource": "读取可选周复盘台账及快照",
            "weeklyScaffoldRows": "生成周一至周日自然周脚手架",
            "weeklyReviewWorkbookValues": "周回答到工作簿轻量字段映射",
            "weeklyWorkbookSyncPlan": "周复盘全量派生同步计划",
            "A:N 表头已漂移": "周复盘列漂移保护",
            "日期脚手架不是已知旧版或自然周版": "周复盘日期边界漂移保护",
            "I:N 含未知公式": "周复盘定性列公式保护",
            'A5:N18").clear({ applyTo: "all" })': "周记录删除后的全量清空重建",
            "assertSourceSnapshotsUnchanged": "同步前源台账冲突保护",
            "assertTableInspection": "轻量表格内部校验不打印内容",
            'previewDir === "-"': "日常同步使用私密临时预览目录",
            "fs.mkdtemp": "私密预览目录唯一创建",
            "mode: 0o600": "预览图片最小文件权限",
            "fs.rm(ephemeralPreviewDir": "运行后清理私密临时预览",
            "path_categories": "同步日志只输出脱敏路径类别",
            "syncReceiptPath": "工作簿同步收据固定路径",
            "workbook_sha256: workbookSha256": "收据绑定最终工作簿字节",
            "path_category: snapshot.pathCategory": "收据不记录绝对路径",
            "assertPortableSourceSnapshotsUnchanged": "收据发布前后源字节重验",
            "writePrivateStagedFile": "收据与工作簿私密暂存",
            "stagedReceiptPath": "同步收据原子替换",
        }.items():
            if snippet not in journal_sync:
                errors.append(f"工作簿日记同步缺少能力：{label}")
        for forbidden, label in {
            "console.log(keyInspect.ndjson)": "日记轻量索引表格内容",
            "console.log(weeklyInspect.ndjson)": "周复盘回答表格内容",
        }.items():
            if forbidden in journal_sync:
                errors.append(f"工作簿日记同步不得打印：{label}")

    google_payload_path = ROOT / "tools" / "google_sheets_payload.mjs"
    if google_payload_path.is_file():
        google_payload = google_payload_path.read_text(encoding="utf-8")
        for snippet, label in {
            "source_snapshots": "三类 iCloud 源快照",
            "clear_ranges": "受管范围先清空",
            "value_updates": "确定性值更新",
            "verification_ranges": "写后读回范围",
            '"journal_raw"': "日记原文排除契约",
            '"apple_health_summary"': "苹果健康排除契约",
            "assertSourceSnapshotsUnchanged": "载荷生成期间源漂移保护",
            "payload_sha256": "载荷确定性哈希",
        }.items():
            if snippet not in google_payload:
                errors.append(f"Google 表格载荷工具缺少能力：{label}")

    google_state_path = ROOT / "tools" / "google_sheets_state.py"
    if google_state_path.is_file():
        google_state = google_state_path.read_text(encoding="utf-8")
        for snippet, label in {
            '"pending_connection"': "连接前安全状态",
            '"active"': "激活状态",
            '"private_owner_only"': "私人访问策略",
            '"icloud_to_google_only"': "单向派生策略",
            '"every_record"': "每次记录同步节奏",
            '"on_demand"': "按需同步节奏",
            '"paused"': "展示暂停状态",
            'subparsers.add_parser("activate")': "首次绑定",
            'subparsers.add_parser("set-mode")': "同步模式切换",
            'subparsers.add_parser("mark-success")': "读回成功收据",
            "payload[\"sources\"] != current_sources": "同步期间源漂移拒绝",
            "os.fchmod(descriptor, 0o600)": "配置与收据私密权限",
        }.items():
            if snippet not in google_state:
                errors.append(f"Google 表格状态工具缺少能力：{label}")

    status_tool_path = ROOT / "tools" / "life_assistant_status.py"
    if status_tool_path.is_file():
        status_tool = status_tool_path.read_text(encoding="utf-8")
        required_status_capabilities = {
            'parser.add_argument("--root"': "可迁移项目根目录",
            'parser.add_argument("--today"': "可复现检查日期",
            'parser.add_argument("--json"': "机器可读输出",
            'parser.add_argument("--write"': "原子状态快照",
            '"GOALS.md"': "目标复盘节点",
            '"index.jsonl"': "日记机器索引",
            'JOURNAL_INDEX_ALLOWED_FIELDS': "日记索引严格字段白名单",
            '_journal_entry_block': "同月日记目标条目块定位",
            '_journal_withdrawal_state_count': "目标条目块撤回状态校验",
            '"weekly_reviews"': "周回顾覆盖",
            '"monthly_reviews"': "月回顾覆盖",
            'STALE_REVIEW_MARKER': "撤回后回顾失效",
            'AUTOMATION_SPEC': "可迁移自动化规格",
            'AUTOMATION_REGISTRY': "机器可读自动化契约",
            '_load_automation_contract': "自动化契约结构与路径校验",
            'prompt_sha256': "规范提示词完整性校验",
            '_normalize_prompt(config["prompt"])': "运行时提示词精确比对",
            'load_product_surfaces': "展示层生命周期严格校验",
            'surfaces["life-dashboard"]["lifecycle_state"]': "移动网页归档状态",
            'archive.testzip()': "ZIP 完整性",
            '_verify_backup_manifest': "备份文件清单",
            '_current_project_manifest': "备份与当前项目一致性",
            'inspect_journal_graph': "日记索引与原文双向完整性",
            'JOURNAL_REVIEW_POLICY': "日记整理节奏策略",
            'inspect_google_sheets_state': "Google 表格同步收据",
            '_inspect_google_display_state': "Google 展示与三类源字节精确核对",
            'inspect_phase_reviews': "阶段复盘台账检查",
            'inspect_insight_ledger': "候选认识台账检查",
            'inspect_phase_actions': "阶段动作台账检查",
            '".phase-reviews.lock"': "阶段复盘锁不进备份漂移",
            '".phase-actions.lock"': "阶段动作锁不进备份漂移",
            'return 2 if report["overall"] == "FAIL" else 0': "状态退出码分层",
        }
        for snippet, label in required_status_capabilities.items():
            if snippet not in status_tool:
                errors.append(f"生活助手状态检查器缺少能力：{label}")

    backup_tool_path = ROOT / "tools" / "create_backup.py"
    if backup_tool_path.is_file():
        backup_tool = backup_tool_path.read_text(encoding="utf-8")
        for snippet, label in {
            '"STATUS.md"': "排除可重建状态快照",
            '"--revision"': "同日不可变修订快照",
            'journal/PRIVACY.md': "日记备份隐私提示",
            'secret_preflight': "备份前高风险秘密预检",
            'NOTICE: 本快照将包含个人生活助手项目数据': "每次备份的个人数据提示",
            '检测到实际每日状态记录': "每日状态敏感备份提示",
            'private_weekly_review_files': "可选周复盘台账备份识别",
            '检测到实际每周复盘记录': "周复盘敏感备份提示",
            '".weekly-reviews.lock"': "排除周复盘临时锁",
            '".phase-reviews.lock"': "排除阶段复盘临时锁",
            '_capture_project_snapshot': "固定备份源字节快照",
            '_assert_snapshot_is_current': "发布前拒绝源文件漂移",
            'inspect_journal_snapshot': "固定备份字节的日记双向完整性",
            'inspect_phase_review_snapshot': "固定备份字节的阶段台账完整性",
            'inspect_insight_snapshot': "固定备份字节的候选提案完整性",
            'inspect_phase_action_snapshot': "固定备份字节的阶段动作完整性",
            '检测到实际阶段复盘记录': "阶段复盘敏感备份提示",
            '日记候选认识确认台账': "候选认识敏感备份提示",
            '".phase-actions.lock"': "排除阶段动作临时锁",
        }.items():
            if snippet not in backup_tool:
                errors.append(f"备份工具缺少能力：{label}")

    journal_integrity_path = ROOT / "tools" / "journal_integrity.py"
    if journal_integrity_path.is_file():
        journal_integrity = journal_integrity_path.read_text(encoding="utf-8")
        for snippet, label in {
            "inspect_journal_graph": "现场索引—原文双向核对",
            "inspect_journal_snapshot": "固定备份字节双向核对",
            "JOURNAL_ID_RE": "稳定日记标识约束",
            "MARKER_RE": "月度原文标识约束",
            "object_pairs_hook": "机器索引重复字段拒绝",
        }.items():
            if snippet not in journal_integrity:
                errors.append(f"日记完整性工具缺少能力：{label}")

    journal_policy_tool_path = ROOT / "tools" / "journal_review_policy.py"
    if journal_policy_tool_path.is_file():
        journal_policy_tool = journal_policy_tool_path.read_text(encoding="utf-8")
        for snippet, label in {
            'subparsers.add_parser("show"': "只读显示日记整理节奏",
            'subparsers.add_parser("set"': "保存用户明确长期选择",
            '"--expect-current"': "日记节奏陈旧状态保护",
            'choices=sorted(SELECTED_CADENCES)': "只接受明确可执行节奏",
            '_atomic_replace': "日记节奏原子写入",
            'LOCK_FILE = ".journal.lock"': "与日记写操作共享锁",
        }.items():
            if snippet not in journal_policy_tool:
                errors.append(f"日记节奏工具缺少能力：{label}")

    return errors


def main() -> int:
    errors = validate()
    if errors:
        print("FAIL: 项目便携性验证未通过", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("PASS: 项目背景、核心 Skill、Prompt、引用、隐私与便携性检查通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
