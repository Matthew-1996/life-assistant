# Life Console 2.4.0

本版本统一 Agent 对话、Life Console 对话式记录、表单和后续自动化入口的日记整理规则、字段契约与展示方式。原文先保存到 Supabase，结构化整理是可重试的后续步骤；历史记录暂不批量重写。

- [PRD](生活助手-LifeConsole-2.4.0.md)
- [需求评审](需求评审报告-生活助手-LifeConsole-2.4.0.md)
- [设计方案](设计方案-生活助手-LifeConsole-2.4.0.md)
- [技术方案](技术方案-生活助手-LifeConsole-2.4.0.md)
- [工程评审与验收](工程评审与验收-生活助手-LifeConsole-2.4.0.md)
- [项目管理](项目管理-生活助手-LifeConsole-2.4.0.md)
- [实施计划](实施计划-生活助手-LifeConsole-2.4.0.md)

当前状态：2.4.0 发布候选已通过 Production 收口验收，PR #54 仍为 Draft、尚未合并，因此尚未标记“正式上线”。统一契约、revision-safe 数据状态机、Agent 主路径、DeepSeek 服务端兜底和统一前端均已完成；Keychain Owner 纯合成探针为 `HTTP 200 / provider_ok`。此前授权的唯一 failed journal 已由 Agent 原子完成，原文 revision 与 SHA-256 未变化，未触发其他日记，DeepSeek 未接收该条真实原文。历史不做批量整理。剩余门禁是完整 diff review、最终 CI、Ready/squash merge、main Production 复验和 release-evidence 合并。
