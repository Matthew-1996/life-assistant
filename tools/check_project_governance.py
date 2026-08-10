#!/usr/bin/env python3
"""Validate the agent/user project-development governance entrypoints."""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path


GOVERNANCE_PATH = "docs/governance/agent-user-project-development-standard.md"
GOVERNANCE_SHA256 = (
    "6da8318c2ceaa99d43e5b9e103cd8ac643e9a5fa737c0e8c14c523166421386a"
)
KB_ROOT = "docs/knowledge-base"
VERSION_DIR = f"{KB_ROOT}/生活助手-LifeConsole-1.0.0"
REQUIRED_FILES = {
    GOVERNANCE_PATH,
    "docs/governance/README.md",
    f"{KB_ROOT}/README.md",
    f"{VERSION_DIR}/生活助手-LifeConsole-1.0.0.md",
    f"{VERSION_DIR}/项目管理-生活助手-LifeConsole-1.0.0.md",
    f"{VERSION_DIR}/需求评审报告-生活助手-LifeConsole-1.0.0.md",
}


def _read_text(root: Path, relative: str, errors: list[str]) -> str:
    path = root / relative
    if path.is_symlink() or not path.is_file():
        errors.append(f"缺少项目治理文件：{relative}")
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        errors.append(f"项目治理文件无法安全读取：{relative}")
        return ""


def inspect_project_governance(root: Path) -> list[str]:
    """Return generic validation errors without exposing private workspace data."""

    errors: list[str] = []
    for relative in sorted(REQUIRED_FILES):
        _read_text(root, relative, errors)

    agents = _read_text(root, "AGENTS.md", errors)
    workflow = _read_text(root, "GIT_WORKFLOW.md", errors)
    template = _read_text(root, ".github/pull_request_template.md", errors)
    governance = _read_text(root, GOVERNANCE_PATH, errors)
    if (
        governance
        and hashlib.sha256(governance.encode("utf-8")).hexdigest()
        != GOVERNANCE_SHA256
    ):
        errors.append(f"项目治理规范不是 PO 原文的逐字副本：{GOVERNANCE_PATH}")
    kb_index = _read_text(root, f"{KB_ROOT}/README.md", errors)
    prd = _read_text(root, f"{VERSION_DIR}/生活助手-LifeConsole-1.0.0.md", errors)
    pmo = _read_text(
        root,
        f"{VERSION_DIR}/项目管理-生活助手-LifeConsole-1.0.0.md",
        errors,
    )
    review = _read_text(
        root,
        f"{VERSION_DIR}/需求评审报告-生活助手-LifeConsole-1.0.0.md",
        errors,
    )

    required_markers = {
        "AGENTS.md": (
            "项目开发最高优先级",
            GOVERNANCE_PATH,
            "不得静默跳过",
        ),
        "GIT_WORKFLOW.md": (
            "产品开发门禁",
            GOVERNANCE_PATH,
            "未通过对应用户门禁的 PR 保持 Draft",
        ),
        ".github/pull_request_template.md": (
            "产品流程",
            "用户确认状态",
            GOVERNANCE_PATH,
            "从 PO 原始文件逐字同步",
        ),
        "docs/governance/README.md": (
            "PO 制定规范的逐字副本",
            "不得由 Agent 改写",
            "SHA-256",
        ),
        GOVERNANCE_PATH: (
            "项目开发上优先级最高的文档",
            "涉及需要用户确认的部分，不可以自行跳过",
            "# 核心流程",
            "项目知识库：必须集成每一次项目",
            "定期的技术方案review",
        ),
        f"{KB_ROOT}/README.md": (
            "生活助手-LifeConsole-1.0.0.md",
            "项目管理-生活助手-LifeConsole-1.0.0.md",
            "PO 已于 2026-08-10 确认",
        ),
        f"{VERSION_DIR}/生活助手-LifeConsole-1.0.0.md": (
            "状态：已确认 / 历史基线",
            "PO 确认结果",
            "事实基线：`origin/main@",
        ),
        f"{VERSION_DIR}/项目管理-生活助手-LifeConsole-1.0.0.md": (
            "当前阶段：已上线",
            "当前卡点与风险",
            "PO 确认记录",
        ),
        f"{VERSION_DIR}/需求评审报告-生活助手-LifeConsole-1.0.0.md": (
            "状态：需求评审已完成",
            "PO 确认记录",
            "结论：通过",
        ),
    }
    contents = {
        "AGENTS.md": agents,
        "GIT_WORKFLOW.md": workflow,
        ".github/pull_request_template.md": template,
        "docs/governance/README.md": _read_text(
            root, "docs/governance/README.md", errors
        ),
        GOVERNANCE_PATH: governance,
        f"{KB_ROOT}/README.md": kb_index,
        f"{VERSION_DIR}/生活助手-LifeConsole-1.0.0.md": prd,
        f"{VERSION_DIR}/项目管理-生活助手-LifeConsole-1.0.0.md": pmo,
        f"{VERSION_DIR}/需求评审报告-生活助手-LifeConsole-1.0.0.md": review,
    }
    for relative, markers in required_markers.items():
        text = contents[relative]
        for marker in markers:
            if marker not in text:
                errors.append(f"项目治理文件缺少必要门禁标记：{relative}")
                break

    return errors


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    errors = inspect_project_governance(root)
    if errors:
        print("FAIL: 项目开发治理检查未通过", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("PASS: PO 规范原文完整，项目知识库与用户确认门禁检查通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
