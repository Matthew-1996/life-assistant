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

当前状态：Gate 1 与 Gate 2 v2 已确认，[PR #58](https://github.com/Matthew-1996/life-assistant/pull/58)、记录页溢出热修复 [PR #59](https://github.com/Matthew-1996/life-assistant/pull/59) 与顶部横幅热修复 [PR #60](https://github.com/Matthew-1996/life-assistant/pull/60) 已合并。2.5.0 Production 已重新发布；1440px/390px 四页无根页面横向溢出，正式站点不再展示内部数据治理横幅。`CRON_SECRET` 已安全轮换，新闻 Cron 已鉴权触发；GDELT 在受控重试中持续超时，因此当前按设计显示可重试空态，未伪造摘要。寄语自动化仍待独立门禁。
