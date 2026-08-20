# Life Console 2.5.0

本版本聚焦界面减法、Todo 管理、可恢复日记删除、两周趋势、每周寄语和每日新闻。在不改变 Owner-scoped Supabase 私人数据真相源的前提下，提高工作台、记录与进展页的信息效率。

- [PRD](生活助手-LifeConsole-2.5.0.md)
- [需求评审](需求评审报告-生活助手-LifeConsole-2.5.0.md)
- [设计方案](设计方案-生活助手-LifeConsole-2.5.0.md)
- [正式视觉评审稿](视觉评审稿-生活助手-LifeConsole-2.5.0.html)
- [技术方案](技术方案-生活助手-LifeConsole-2.5.0.md)
- [测试计划](测试计划-生活助手-LifeConsole-2.5.0.md)
- [实施计划](实施计划-生活助手-LifeConsole-2.5.0.md)
- [工程评审与验收](工程评审与验收-生活助手-LifeConsole-2.5.0.md)
- [项目管理](项目管理-生活助手-LifeConsole-2.5.0.md)
- [上线证据](上线证据-生活助手-LifeConsole-2.5.0.md)

当前状态：Gate 1 范围和 Gate 2 v2 正式视觉、设计与技术方案均已由 PO 确认，[Draft PR #58](https://github.com/Matthew-1996/life-assistant/pull/58) 已完成功能实现、本地全量门禁、受保护合成 Preview，且 privacy、Python、Node 三项远端 CI 全绿。Supabase 已切换到与 Life Console Production URL 匹配的健康项目；2.5.0 主 migration 与 Todo 软删除增量 migration 均经当次确认后应用并通过去敏验证。受保护 Owner Preview 已完成 Todo、日记和远期寄语的合成写入验收；自动化、PR 合并和 Vercel Production 仍未执行，继续遵守各自门禁。
