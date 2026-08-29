# Life Console 2.6.0

本版本为 iOS Home Screen Web App 轻量适配：让用户可以把 Life Console 添加到 iPhone 主屏幕，并以独立窗口打开。版本不引入 Service Worker、自定义离线页、离线数据或 Android 适配。

- [PRD](生活助手-LifeConsole-2.6.0.md)
- [需求评审](需求评审报告-生活助手-LifeConsole-2.6.0.md)
- [设计方案](设计方案-生活助手-LifeConsole-2.6.0.md)
- [技术方案](技术方案-生活助手-LifeConsole-2.6.0.md)
- [实施计划](实施计划-生活助手-LifeConsole-2.6.0.md)
- [工程评审与验收](工程评审与验收-生活助手-LifeConsole-2.6.0.md)
- [项目管理](项目管理-生活助手-LifeConsole-2.6.0.md)

当前状态：方案 2、390px 底部导航安全区、Todo 表单单列、记录页 iOS 日期筛选及 Todo“计划开始”/“DDL”日期时间边界修复均已按 TDD 完成，并通过本地应用、构建、浏览器、治理与隐私门禁。第四次响应式修复后的受保护纯静态合成 Preview 已 READY；390px 下两个 Todo 日期时间控件的右侧溢出均为 0，四页内容控件彼此交集、控件横向越界、底栏自身交集和根横向溢出均为 0。Draft PR [#77](https://github.com/Matthew-1996/life-assistant/pull/77) 仍为 Draft；等待真实 iPhone 复验，尚未合并或发布 Production。
