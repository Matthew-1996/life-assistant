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
- [每日新闻搁置与接力](每日新闻搁置与接力-生活助手-LifeConsole-2.5.0.md)

当前状态：2.5.0 主功能已发布。PR #72 已合并并从准确 `main` 重新发布，Production、新闻 Functions 与 Cron 均正常；但最终 Owner 只读复验仍为 `error`、0 条，且服务器侧没有收到 `/api/daily-news` 请求。按 PO 的最后一次修复边界，每日新闻前端展示已搁置，不再继续热修复；历史定位、剩余假设和未来恢复门禁见“每日新闻搁置与接力”。
