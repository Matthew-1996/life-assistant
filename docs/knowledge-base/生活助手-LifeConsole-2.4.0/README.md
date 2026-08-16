# Life Console 2.4.0

本版本统一 Agent 对话、Life Console 对话式记录、表单和后续自动化入口的日记整理规则、字段契约与展示方式。原文先保存到 Supabase，结构化整理是可重试的后续步骤；历史记录暂不批量重写。

- [PRD](生活助手-LifeConsole-2.4.0.md)
- [需求评审](需求评审报告-生活助手-LifeConsole-2.4.0.md)
- [设计方案](设计方案-生活助手-LifeConsole-2.4.0.md)
- [技术方案](技术方案-生活助手-LifeConsole-2.4.0.md)
- [工程评审与验收](工程评审与验收-生活助手-LifeConsole-2.4.0.md)
- [项目管理](项目管理-生活助手-LifeConsole-2.4.0.md)
- [实施计划](实施计划-生活助手-LifeConsole-2.4.0.md)

当前状态：Gate 1、Gate 2 已确认；统一契约、revision-safe 数据状态机、Agent 主路径、纯合成 DeepSeek 服务端边界和统一前端已在 Draft PR #54 完成并通过本地门禁。DeepSeek 只作为无法触发 Agent 时的候选兜底；在 PO 单独确认第三方模型数据处理边界前，不接入真实日记、不配置密钥、不部署。候选部署、真实 POC、历史重整、PR Ready/合并均未执行。
