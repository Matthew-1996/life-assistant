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

当前状态：Gate 1 与 Gate 2 v2 已确认，[PR #58](https://github.com/Matthew-1996/life-assistant/pull/58) 与记录页溢出热修复 [PR #59](https://github.com/Matthew-1996/life-assistant/pull/59) 已合并，2.5.0 Production 已重新发布并通过 1440px/390px 四页真实浏览器复验。PO 进一步指出正式站点仍展示内部数据治理横幅；该行为与已确认 PRD 的全局顶部减法不一致，当前通过快速维护分支以 TDD 移除，并在发布时轮换 `CRON_SECRET`、触发新闻 Cron。寄语自动化仍待独立门禁。
