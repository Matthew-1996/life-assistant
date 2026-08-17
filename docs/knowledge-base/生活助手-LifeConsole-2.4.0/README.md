# Life Console 2.4.0

本版本统一 Agent 对话、Life Console 对话式记录、表单和后续自动化入口的日记整理规则、字段契约与展示方式。原文先保存到 Supabase，结构化整理是可重试的后续步骤；历史记录暂不批量重写。

- [PRD](生活助手-LifeConsole-2.4.0.md)
- [需求评审](需求评审报告-生活助手-LifeConsole-2.4.0.md)
- [设计方案](设计方案-生活助手-LifeConsole-2.4.0.md)
- [技术方案](技术方案-生活助手-LifeConsole-2.4.0.md)
- [工程评审与验收](工程评审与验收-生活助手-LifeConsole-2.4.0.md)
- [项目管理](项目管理-生活助手-LifeConsole-2.4.0.md)
- [实施计划](实施计划-生活助手-LifeConsole-2.4.0.md)
- [上线证据](上线证据-生活助手-LifeConsole-2.4.0.md)

当前状态：2.4.0 已正式上线。PR #54 已通过独立安全、并发与隐私复审及全部 CI，并以 squash merge 合入 `main`；Vercel Production `READY / PROMOTED`。2026-08-17 发现浏览器共享契约模块在严格 CSP 下触发 Ajv `unsafe-eval`，导致首屏空白；PO 已明确授权修复并上线，当前热修复分支已完成 TDD 和本地构建，待 Production 复验。修复不放开 `unsafe-eval`，不读写日记或数据库。
