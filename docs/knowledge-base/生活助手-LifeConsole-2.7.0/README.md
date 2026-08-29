# Life Console 2.7.0

本版本为 Todo 状态筛选优化：“今日”和“全部”默认仅显示未开始、进行中项目，并允许用户重新选中已完成以回捞异常流转或历史项目。Todo 列表与 14 天甘特图共用同一筛选投影。

- [PRD](生活助手-LifeConsole-2.7.0.md)
- [需求评审](需求评审报告-生活助手-LifeConsole-2.7.0.md)
- [设计方案](设计方案-生活助手-LifeConsole-2.7.0.md)
- [技术方案](技术方案-生活助手-LifeConsole-2.7.0.md)
- [测试计划](测试计划-生活助手-LifeConsole-2.7.0.md)
- [工程评审与验收](工程评审与验收-生活助手-LifeConsole-2.7.0.md)
- [项目管理](项目管理-生活助手-LifeConsole-2.7.0.md)

当前状态：Gate 1、Gate 2 与[受保护的合成数据 Preview](https://life-console-production-bzv5o4q62-test11-b88a.vercel.app)产品验收均已由 PO 于 2026-08-29 确认，[PR #79](https://github.com/Matthew-1996/life-assistant/pull/79) 已合并。首次 Production 发布因本地预构建把 Vercel 敏感环境变量占位符打入浏览器制品，导致 Owner 登录后无法读取工作台，已立即回滚到上一已知可用制品并验证工作台恢复。当前以独立修复分支增加 Production 构建硬门禁；2.7.0 尚未重新上线，真实浏览器验收保持重新打开。
