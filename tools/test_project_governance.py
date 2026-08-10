from __future__ import annotations

import hashlib
import tempfile
import unittest
from unittest import mock
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
                "修改唯一规范正文\n"
            ),
            "docs/governance/README.md": (
                "本地项目与 GitHub 仓库共同使用的唯一权威正文\n"
                "不得由 Agent 改写\n"
                "SHA-256\n"
            ),
            governance.GOVERNANCE_PATH: (
                "把这个规范作为项目开发上优先级最高的文档\n"
                "涉及需要用户确认的部分，不可以自行跳过\n"
                "# 核心流程\n"
                "项目知识库：必须集成每一次项目\n"
                "定期的技术方案review\n"
            ),
            f"{governance.KB_ROOT}/README.md": (
                "生活助手-LifeConsole-1.0.0.md\n"
                "项目管理-生活助手-LifeConsole-1.0.0.md\n"
                "PO 已确认\n"
            ),
            f"{governance.VERSION_DIR}/README.md": "版本知识库\n",
            f"{governance.VERSION_DIR}/生活助手-LifeConsole-1.0.0.md": (
                "状态：已确认 / 历史基线\n"
                "PO 确认结果\n"
                "事实来源：当前 `main`\n"
            ),
            f"{governance.VERSION_DIR}/项目管理-生活助手-LifeConsole-1.0.0.md": (
                "产品阶段：已上线\n"
                "当前卡点与风险\n"
                "PO 确认记录\n"
            ),
            f"{governance.VERSION_DIR}/需求评审报告-生活助手-LifeConsole-1.0.0.md": (
                "状态：需求评审已完成\n"
                "PO 确认记录\n"
                "结论：通过\n"
            ),
            f"{governance.VERSION_DIR}/设计方案-生活助手-LifeConsole-1.0.0.md": "设计方案\n",
            f"{governance.VERSION_DIR}/技术方案-生活助手-LifeConsole-1.0.0.md": "技术方案\n",
            f"{governance.VERSION_DIR}/工程评审与验收-生活助手-LifeConsole-1.0.0.md": "工程评审与验收\n",
        }
        for relative, text in self.contents.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        self.sha_patch = mock.patch.object(
            governance,
            "GOVERNANCE_SHA256",
            hashlib.sha256(
                self.contents[governance.GOVERNANCE_PATH].encode("utf-8")
            ).hexdigest(),
        )
        self.sha_patch.start()

    def tearDown(self) -> None:
        self.sha_patch.stop()
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

    def test_governance_body_cannot_be_silently_rewritten(self) -> None:
        path = self.root / governance.GOVERNANCE_PATH
        path.write_text(
            path.read_text(encoding="utf-8") + "Agent 补充\n",
            encoding="utf-8",
        )
        errors = governance.inspect_project_governance(self.root)
        self.assertTrue(any("不是 PO 确认版本" in error for error in errors))

    def test_confirmed_po_gate_cannot_be_silently_reverted(self) -> None:
        path = self.root / governance.VERSION_DIR / "生活助手-LifeConsole-1.0.0.md"
        path.write_text(
            self.contents[path.relative_to(self.root).as_posix()].replace(
                "状态：已确认 / 历史基线", "状态：待需求评审"
            ),
            encoding="utf-8",
        )
        errors = governance.inspect_project_governance(self.root)
        self.assertTrue(any("产品治理文件" in error or "项目治理文件" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
