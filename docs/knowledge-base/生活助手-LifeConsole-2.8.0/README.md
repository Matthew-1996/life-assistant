# Life Console 2.8.0

本版本优化 iPhone / iOS PWA 的底部一级导航：采用常驻浮动胶囊，让页面内容从导航下方和两侧透出，并以 Web 可实现的半透明、模糊、描边和阴影近似 iOS 26 的浮动导航层级。

- [PRD](生活助手-LifeConsole-2.8.0.md)
- [需求评审](需求评审报告-生活助手-LifeConsole-2.8.0.md)
- [设计方案](设计方案-生活助手-LifeConsole-2.8.0.md)
- [技术方案](技术方案-生活助手-LifeConsole-2.8.0.md)
- [测试计划](测试计划-生活助手-LifeConsole-2.8.0.md)
- [工程评审与验收](工程评审与验收-生活助手-LifeConsole-2.8.0.md)
- [项目管理](项目管理-生活助手-LifeConsole-2.8.0.md)

当前状态：待上线（进行中）。Gate 1 与 Gate 2 已由 PO 于 2026-08-31 确认；PO 已选择浮动方案、接受不完全原生的 PWA 替代，并明确不做“向下滚动自动收起”。经两轮同机参照反馈，当前外壳几何为 62px 高、31px CSS 圆角、20px 侧距，34px 安全区下约 21px 物理底距。[20px 侧距 Preview](https://life-console-production-no4wccgkq-test11-b88a.vercel.app)已通过本地、CI、远端浏览器技术验收及 PO 产品验收；PO 已当次授权合并 PR #84 与 Production 上线，等待执行和上线后只读验收。
