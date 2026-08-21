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

当前状态：Gate 1 与 Gate 2 v2 已确认，[PR #58](https://github.com/Matthew-1996/life-assistant/pull/58)、记录页溢出热修复 [PR #59](https://github.com/Matthew-1996/life-assistant/pull/59)、顶部横幅热修复 [PR #60](https://github.com/Matthew-1996/life-assistant/pull/60) 与内容自动化收口 [PR #62](https://github.com/Matthew-1996/life-assistant/pull/62) 已合并。2.5.0 Production 已发布并复验；DeepSeek 纯合成健康探针可用，每日新闻 Cron 已启用，每周寄语实例为 ACTIVE。2026-08-21 PO 已确认每日新闻可靠性补强方向：GDELT 失败时切换新华网/BBC 公开源，并在同区域 Runtime Cache 保存最近 7 天的去敏 Cron 运行记录；当前处于 TDD 实施前设计收口，Production 变更尚未发布。
