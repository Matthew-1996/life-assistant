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

当前状态：2.5.0 主功能已发布，服务端每日新闻、Cron、Runtime Cache 与运行收据已有成功证据；但 PR #71 发布并完成 Owner 退出重登后，浏览器仍未发出新闻 API 请求。PO 已确认进入 PR #72 架构修复：删除应用级 token cache，以 Supabase provider 当前 Session 为唯一真相源，并增加去敏闭集新闻加载状态。本地 TDD、Vitest/Python、三种构建、Playwright、治理与 Git 隐私门禁已通过；仍需 Draft PR、远程 CI、纯合成 Preview，以及新的 Production 合并发布确认。
