#!/usr/bin/env python3
"""Read-only environment check for restoring the portable life-assistant project.

The project context is portable, but not every optional editing/build capability is
dependency-free. This doctor separates required local Python capabilities from
optional validators, spreadsheet tooling and the Life Console build toolchain.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Sequence

try:
    from tools.product_surfaces import ProductSurfaceError, load_product_surfaces
except ModuleNotFoundError:  # Direct execution from tools/.
    from product_surfaces import ProductSurfaceError, load_product_surfaces


ROOT = Path(__file__).resolve().parents[1]
MINIMUM_PYTHON = (3, 9)
DEFAULT_NODE_MINIMUM = (22, 13, 0)
REQUIRED_PROJECT_FILES = (
    "AGENTS.md",
    "USER.md",
    "MEMORY.md",
    "GOALS.md",
    "PORTABILITY.md",
    "PROJECT_CONTEXT.md",
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
    "docs/knowledge-base/生活助手-LifeConsole-1.1.0/README.md",
    "docs/knowledge-base/生活助手-LifeConsole-1.1.0/生活助手-LifeConsole-1.1.0.md",
    "docs/knowledge-base/生活助手-LifeConsole-1.1.0/需求评审报告-生活助手-LifeConsole-1.1.0.md",
    "docs/knowledge-base/生活助手-LifeConsole-1.1.0/设计方案-生活助手-LifeConsole-1.1.0.md",
    "docs/knowledge-base/生活助手-LifeConsole-1.1.0/技术方案-生活助手-LifeConsole-1.1.0.md",
    "docs/knowledge-base/生活助手-LifeConsole-1.1.0/工程评审与验收-生活助手-LifeConsole-1.1.0.md",
    "docs/knowledge-base/生活助手-LifeConsole-1.1.0/项目管理-生活助手-LifeConsole-1.1.0.md",
    "docs/operations/README.md",
    "docs/operations/product-surfaces.json",
    "apps/life-console/package.json",
    "apps/life-console/package-lock.json",
    "apps/life-console/contracts/life-console.openapi.yaml",
    "automations/registry.json",
    "automations/生活状态回访.prompt.txt",
    "integrations/README.md",
    "integrations/google-sheets.json",
    "journal/README.md",
    "journal/PRIVACY.md",
    "journal/INDEX.md",
    "journal/review-policy.json",
    "outputs/019fb832-be4f-74f1-add5-58cb6fb6fc09/生活计划表.xlsx",
    "outputs/019fb832-be4f-74f1-add5-58cb6fb6fc09/生活计划表.sync-state.json",
    "records/README.md",
    "tools/validate_project.py",
    "tools/check_project_governance.py",
    "tools/test_project_governance.py",
    "tools/create_backup.py",
    "tools/verify_backup.py",
    "tools/daily_checkin.py",
    "tools/weekly_review.py",
    "tools/test_weekly_review.py",
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
    "tools/life_plan_records.mjs",
    "tools/update_life_plan_journal.mjs",
    "tools/google_sheets_payload.mjs",
    "tools/google_sheets_state.py",
    "tools/life_assistant_status.py",
    "tools/product_surfaces.py",
)
SEVERITY = {"PASS": 0, "INFO": 0, "ATTENTION": 1, "FAIL": 2}


def _version_tuple(value: str) -> tuple[int, int, int] | None:
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", value)
    if not match:
        return None
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def _life_console_node_minimum(root: Path) -> tuple[int, int, int]:
    package_path = root / "apps" / "life-console" / "package.json"
    try:
        package = json.loads(package_path.read_text(encoding="utf-8"))
        requirement = package["engines"]["node"]
    except (OSError, UnicodeError, json.JSONDecodeError, KeyError, TypeError):
        return DEFAULT_NODE_MINIMUM
    if not isinstance(requirement, str):
        return DEFAULT_NODE_MINIMUM
    return _version_tuple(requirement) or DEFAULT_NODE_MINIMUM


def _run_version(executable: str) -> tuple[int, int, int] | None:
    try:
        result = subprocess.run(
            [executable, "--version"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode:
        return None
    return _version_tuple(result.stdout or result.stderr)


def _artifact_tool_resolves(node: str | None, root: Path) -> bool:
    if not node:
        return False
    try:
        result = subprocess.run(
            [node, "-e", "require.resolve('@oai/artifact-tool')"],
            cwd=root,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def build_report(root: Path = ROOT) -> dict[str, Any]:
    checks: list[dict[str, str]] = []

    def add(name: str, status: str, scope: str, message: str, action: str = "") -> None:
        item = {"name": name, "status": status, "scope": scope, "message": message}
        if action:
            item["action"] = action
        checks.append(item)

    missing = [relative for relative in REQUIRED_PROJECT_FILES if not (root / relative).is_file()]
    if missing:
        add(
            "project_files",
            "FAIL",
            "required",
            f"缺少 {len(missing)} 个恢复所需的核心文件。",
            "重新下载完整 iCloud 项目或从已验证 ZIP 恢复。",
        )
    else:
        add("project_files", "PASS", "required", "核心项目文件齐全。")

    try:
        load_product_surfaces(root)
    except (ProductSurfaceError, OSError, ValueError):
        add(
            "product_surfaces",
            "FAIL",
            "required",
            "展示层生命周期清单缺失、损坏或不是规范归档状态。",
            "恢复统一生命周期清单；不要用历史移动网页源码替代该契约。",
        )
    else:
        add(
            "product_surfaces",
            "PASS",
            "required",
            "Life Console 主入口、Google/XLSX 按需派生和移动网页归档状态有效。",
        )

    weekly_review_data = root / "records" / "weekly-reviews.jsonl"
    if weekly_review_data.is_symlink() or (
        weekly_review_data.exists() and not weekly_review_data.is_file()
    ):
        add(
            "weekly_review_data",
            "FAIL",
            "optional_source",
            "可选周复盘台账路径不是普通项目文件。",
            "移除该路径并在首次周复盘 upsert 时由工具创建普通 JSONL 文件。",
        )
    elif weekly_review_data.is_file():
        add(
            "weekly_review_data",
            "PASS",
            "optional_source",
            "周复盘台账已存在；完整备份会包含它。",
        )
    else:
        add(
            "weekly_review_data",
            "INFO",
            "optional_source",
            "周复盘台账尚未创建，按空台账处理；这不是恢复缺失。",
        )

    phase_review_data = root / "records" / "phase-reviews.jsonl"
    if phase_review_data.is_symlink() or (
        phase_review_data.exists() and not phase_review_data.is_file()
    ):
        add(
            "phase_review_data",
            "FAIL",
            "optional_source",
            "可选阶段复盘台账路径不是普通项目文件。",
            "移除不安全路径，由阶段复盘工具在首次明确回答时创建。",
        )
    elif phase_review_data.is_file():
        add(
            "phase_review_data",
            "PASS",
            "optional_source",
            "阶段复盘台账已存在；完整备份会包含它。",
        )
    else:
        add(
            "phase_review_data",
            "INFO",
            "optional_source",
            "阶段复盘台账尚未创建，按空台账处理；这不是恢复缺失。",
        )

    phase_action_data = root / "records" / "phase-actions.jsonl"
    if phase_action_data.is_symlink() or (
        phase_action_data.exists() and not phase_action_data.is_file()
    ):
        add(
            "phase_action_data",
            "FAIL",
            "optional_source",
            "可选阶段动作台账路径不是普通项目文件。",
            "移除不安全路径，由阶段动作工具在首次派生明确动作时创建。",
        )
    elif phase_action_data.is_file():
        add(
            "phase_action_data",
            "PASS",
            "optional_source",
            "阶段动作台账已存在；完整备份会包含它。",
        )
    else:
        add(
            "phase_action_data",
            "INFO",
            "optional_source",
            "阶段动作台账尚未创建，按空台账处理；这不是恢复缺失。",
        )

    insight_data = root / "journal" / "insight-decisions.jsonl"
    if insight_data.is_symlink() or (
        insight_data.exists() and not insight_data.is_file()
    ):
        add(
            "journal_insight_data",
            "FAIL",
            "optional_source",
            "可选日记候选认识台账路径不是普通项目文件。",
            "移除不安全路径，由候选认识工具在首次规划确认时创建。",
        )
    elif insight_data.is_file():
        add(
            "journal_insight_data",
            "PASS",
            "optional_source",
            "日记候选认识台账已存在；完整备份会包含它。",
        )
    else:
        add(
            "journal_insight_data",
            "INFO",
            "optional_source",
            "日记候选认识台账尚未创建，按空台账处理；这不是恢复缺失。",
        )

    current_python = sys.version_info[:3]
    if current_python < MINIMUM_PYTHON:
        add(
            "python",
            "FAIL",
            "required",
            f"Python {current_python[0]}.{current_python[1]}.{current_python[2]} 低于核心工具所需的 3.9。",
            "安装 Python 3.9 或更高版本后重试。",
        )
    else:
        add(
            "python",
            "PASS",
            "required",
            f"Python {current_python[0]}.{current_python[1]}.{current_python[2]} 可运行核心标准库工具。",
        )

    if importlib.util.find_spec("fcntl") is None:
        add(
            "journal_lock",
            "FAIL",
            "required",
            "当前 Python 缺少 fcntl，无法使用日记、候选认识、阶段动作及每日/每周/阶段状态并发写入锁。",
            "在 macOS/Linux Python 或 WSL 中恢复；直接 Windows Python 暂不受支持。",
        )
    else:
        add("journal_lock", "PASS", "required", "日记、候选认识、阶段动作及每日/每周/阶段状态并发写入锁 fcntl 可用。")

    if importlib.util.find_spec("yaml") is None:
        add(
            "pyyaml",
            "INFO",
            "optional",
            "PyYAML 未安装；不影响项目内校验、日记、状态或备份。",
            "只在重跑系统官方 quick_validate.py 时，按 tools/requirements-validator.txt 安装固定版本。",
        )
    else:
        add("pyyaml", "PASS", "optional", "PyYAML 可用，可支持可选的官方 Skill 校验。")

    node = shutil.which("node")
    node_version = _run_version(node) if node else None
    node_minimum = _life_console_node_minimum(root)
    minimum_label = ".".join(str(part) for part in node_minimum)
    if node_version is None:
        add(
            "node",
            "ATTENTION",
            "optional",
            "Node.js 不可用；核心 Python 工具仍可用，但不能测试/构建 Life Console、生成 Google 表格载荷或按需重建 XLSX。",
            f"需要这些能力时安装 Node.js >= {minimum_label}。",
        )
    elif node_version < node_minimum:
        installed = ".".join(str(part) for part in node_version)
        add(
            "node",
            "ATTENTION",
            "optional",
            f"Node.js {installed} 可用，但低于 Life Console 声明的 {minimum_label}。",
            f"测试或构建 Life Console 前升级到 Node.js >= {minimum_label}。",
        )
    else:
        installed = ".".join(str(part) for part in node_version)
        add("node", "PASS", "optional", f"Node.js {installed} 满足 Life Console 构建声明。")

    life_console_modules = root / "apps" / "life-console" / "node_modules"
    if life_console_modules.is_dir():
        add("life_console_dependencies", "PASS", "optional", "当前设备已有 Life Console node_modules（备份不会携带它）。")
    else:
        add(
            "life_console_dependencies",
            "INFO",
            "optional",
            "Life Console node_modules 未保留，这是可重建依赖的预期状态。",
            "需要测试或构建时，在 apps/life-console 运行 npm ci。",
        )

    if _artifact_tool_resolves(node, root):
        add("artifact_tool", "PASS", "optional", "@oai/artifact-tool 当前可解析，可按需重建归档 XLSX。")
    else:
        add(
            "artifact_tool",
            "INFO",
            "optional",
            "@oai/artifact-tool 不在项目内；不影响 iCloud 记录或 Google 日常展示，只影响按需重建归档 XLSX。",
            "需要导出或恢复 XLSX 时，由 Codex 重新加载电子表格 Skill 的捆绑运行时；不要复用旧电脑绝对路径。",
        )

    overall = "PASS"
    for item in checks:
        if SEVERITY[item["status"]] > SEVERITY[overall]:
            overall = item["status"]
    return {"overall": overall, "checks": checks}


def _print_human(report: dict[str, Any]) -> None:
    print(f"{report['overall']}: 生活助手迁移环境检查")
    for item in report["checks"]:
        print(f"- [{item['status']}] {item['message']}")
        if item.get("action"):
            print(f"  处理：{item['action']}")


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="检查生活助手在当前设备的可恢复能力")
    parser.add_argument("--root", type=Path, default=ROOT, help="项目根目录")
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    report = build_report(args.root.resolve())
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        _print_human(report)
    return 2 if report["overall"] == "FAIL" else 0


if __name__ == "__main__":
    raise SystemExit(main())
