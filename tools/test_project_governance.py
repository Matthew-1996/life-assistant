from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tools import check_project_governance as governance


class ProjectGovernanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.contents = {
            "AGENTS.md": (
                "项目开发最高优先级\n"
                f"{governance.GOVERNANCE_PATH}\n"
                "不得静默跳过\n"
            ),
            "GIT_WORKFLOW.md": (
                "产品开发门禁\n"
                f"{governance.GOVERNANCE_PATH}\n"
                "未通过对应用户门禁的 PR 保持 Draft\n"
            ),
            ".github/pull_request_template.md": (
                "产品流程\n用户确认状态\n"
                f"{governance.GOVERNANCE_PATH}\n"
            ),
            governance.GOVERNANCE_PATH: (
                "项目开发最高优先级规范\n"
                "文档缺失与用户确认门禁\n"
                "核心开发流程与门禁\n"
                "项目知识库\n"
            ),
            f"{governance.KB_ROOT}/README.md": (
                "生活助手-LifeConsole-1.0.0.md\n"
                "项目管理-生活助手-LifeConsole-1.0.0.md\n"
                "待 PO 确认\n"
            ),
            f"{governance.VERSION_DIR}/生活助手-LifeConsole-1.0.0.md": (
                "状态：待需求评审\n"
                "本次需要 PO 确认\n"
                "事实基线：`origin/main@abcdef0`\n"
            ),
            f"{governance.VERSION_DIR}/项目管理-生活助手-LifeConsole-1.0.0.md": (
                "当前阶段：待需求评审\n"
                "当前卡点与风险\n"
                "PO 确认入口\n"
            ),
            f"{governance.VERSION_DIR}/需求评审报告-生活助手-LifeConsole-1.0.0.md": (
                "状态：待需求评审 / 进行中\n"
                "PO 确认记录\n"
                "结论：待确认\n"
            ),
        }
        for relative, text in self.contents.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_valid_governance_tree_passes(self) -> None:
        self.assertEqual(governance.inspect_project_governance(self.root), [])

    def test_missing_prd_fails_closed(self) -> None:
        (self.root / governance.VERSION_DIR / "生活助手-LifeConsole-1.0.0.md").unlink()
        errors = governance.inspect_project_governance(self.root)
        self.assertTrue(any("缺少项目治理文件" in error for error in errors))

    def test_agents_entrypoint_cannot_be_removed(self) -> None:
        (self.root / "AGENTS.md").write_text("普通规则\n", encoding="utf-8")
        errors = governance.inspect_project_governance(self.root)
        self.assertTrue(any("AGENTS.md" in error for error in errors))

    def test_pending_po_gate_cannot_be_silently_closed(self) -> None:
        path = self.root / governance.VERSION_DIR / "生活助手-LifeConsole-1.0.0.md"
        path.write_text(
            self.contents[path.relative_to(self.root).as_posix()].replace(
                "状态：待需求评审", "状态：已上线"
            ),
            encoding="utf-8",
        )
        errors = governance.inspect_project_governance(self.root)
        self.assertTrue(any("产品治理文件" in error or "项目治理文件" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
