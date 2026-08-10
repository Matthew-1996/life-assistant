# 项目治理文档

本目录保存项目开发治理规则。

## 权威正文

[`agent-user-project-development-standard.md`](agent-user-project-development-standard.md) 是 PO 制定规范的逐字副本，也是项目开发文档中的最高优先级规范。

- 正文不得由 Agent 改写、重排、润色、补充标题或追加元数据。
- Agent 的执行细化只能写入 `AGENTS.md`、`GIT_WORKFLOW.md` 或知识库，且不得覆盖或改变规范原意。
- 规范正文变更必须来自 PO 明确修改；同步后应重新做逐字比对，并更新完整性校验与变更记录。
- 当前正文 SHA-256：`6da8318c2ceaa99d43e5b9e103cd8ac643e9a5fa737c0e8c14c523166421386a`。

校验命令：

```bash
python3 tools/check_project_governance.py
```
