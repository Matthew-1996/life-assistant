# Life Console 2.6.0

本版本为 iOS Home Screen Web App 轻量适配：让用户可以把 Life Console 添加到 iPhone 主屏幕，并以独立窗口打开。版本不引入 Service Worker、自定义离线页、离线数据或 Android 适配。

- [PRD](生活助手-LifeConsole-2.6.0.md)
- [需求评审](需求评审报告-生活助手-LifeConsole-2.6.0.md)
- [设计方案](设计方案-生活助手-LifeConsole-2.6.0.md)
- [技术方案](技术方案-生活助手-LifeConsole-2.6.0.md)
- [实施计划](实施计划-生活助手-LifeConsole-2.6.0.md)
- [工程评审与验收](工程评审与验收-生活助手-LifeConsole-2.6.0.md)
- [上线证据](上线证据-生活助手-LifeConsole-2.6.0.md)
- [项目管理](项目管理-生活助手-LifeConsole-2.6.0.md)

当前状态：2.6.0 已上线。PR [#77](https://github.com/Matthew-1996/life-assistant/pull/77) 已 squash merge；合并后的准确 `main` 已发布到 [Life Console 正式站点](https://project-wpabq.vercel.app/)。Production 为 READY，PWA 资产、严格 CSP、无 Service Worker / Cache Storage 边界、未登录 API 门禁和 390px 四页布局均已只读验收；未触发 Cron、模型或真实数据写入。仍需 PO 在正式域名完成添加到主屏幕、独立窗口、登录恢复与飞行模式的发布后真机复验。
