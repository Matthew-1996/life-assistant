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

当前状态：Gate 1 与 Gate 2 v2 已确认，[PR #58](https://github.com/Matthew-1996/life-assistant/pull/58) 已合并，Supabase 两条 2.5.0 migration 与 Owner Preview 合成验收均已完成。PO 确认 Production 后曾发布 2.5.0，但上线后以真实浏览器发现记录页原始复盘回退分支在 1440px 产生横向溢出，已立即回滚至上一健康 Production；数据库加法对象与用户数据未回滚或删除。当前在独立热修复分支以 TDD 修复，重新发布与寄语自动化仍待独立门禁。
