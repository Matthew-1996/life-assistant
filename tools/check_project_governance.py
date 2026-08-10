#!/usr/bin/env python3
"""Validate the agent/user project-development governance entrypoints."""

from __future__ import annotations

import sys
from pathlib import Path


GOVERNANCE_PATH = "docs/governance/agent-user-project-development-standard.md"
KB_ROOT = "docs/knowledge-base"
VERSION_DIR = f"{KB_ROOT}/生活助手-LifeConsole-1.0.0"
REQUIRED_FILES = {
    GOVERNANCE_PATH,
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
        ),
        GOVERNANCE_PATH: (
            "项目开发最高优先级规范",
            "文档缺失与用户确认门禁",
            "核心开发流程与门禁",
            "项目知识库",
        ),
        f"{KB_ROOT}/README.md": (
            "生活助手-LifeConsole-1.0.0.md",
            "项目管理-生活助手-LifeConsole-1.0.0.md",
            "待 PO 确认",
        ),
        f"{VERSION_DIR}/生活助手-LifeConsole-1.0.0.md": (
            "状态：待需求评审",
            "本次需要 PO 确认",
            "事实基线：`origin/main@",
        ),
        f"{VERSION_DIR}/项目管理-生活助手-LifeConsole-1.0.0.md": (
            "当前阶段：待需求评审",
            "当前卡点与风险",
            "PO 确认入口",
        ),
        f"{VERSION_DIR}/需求评审报告-生活助手-LifeConsole-1.0.0.md": (
            "状态：待需求评审 / 进行中",
            "PO 确认记录",
            "结论：待确认",
        ),
    }
    contents = {
        "AGENTS.md": agents,
        "GIT_WORKFLOW.md": workflow,
        ".github/pull_request_template.md": template,
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
    print("PASS: 项目开发规范、知识库与用户确认门禁检查通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
