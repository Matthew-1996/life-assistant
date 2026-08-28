# 项目管理：Life Console 2.6.0

## 1. 当前状态

- 主阶段：待验收。
- 子状态：等待 Preview 授权。
- 分支：`agent/life-console-pwa-ios-260`。
- PR：Draft PR [#77](https://github.com/Matthew-1996/life-assistant/pull/77)，包含治理文档、iOS 安装资产与自动化契约。
- 实现：本地候选已完成；Manifest、Apple Touch Icon、iOS 元数据和无 Service Worker 边界均已自动验证。
- 数据：不改数据库、Owner 数据、备份或自动化。
- 发布：未创建 Preview，未申请 PR 合并或 Production 发布。

## 2. 决策日志

| 日期 | 决策 | 状态 |
|---|---|---|
| 2026-08-28 | 用户要求轻量安全 PWA，仅适配 iOS | 已确认方向 |
| 2026-08-28 | 用户接受在线才能使用、断网可显示错误 | 已确认方向 |
| 2026-08-28 | 用户从受控离线页改选“仅安装配置”，接受感知 iOS 原生离线状态 | 已确认方向 |
| 2026-08-29 | PO 确认 Gate 1 与 Gate 2，允许按方案 2 进入 TDD 实现 | 已确认 |
| 2026-08-29 | 方案 2 最小实现与本地全量门禁完成 | 已完成；不构成 Preview、合并或发布授权 |

书面 PRD 明确补充：方案 2 不会在网络中断瞬间主动遮住已经加载的页面。PO 已在 Gate 1 确认该限制。

## 3. 阶段计划

1. Gate 1：复核 PRD、需求评审与已知离线限制。
2. Gate 2：复核图标、Manifest、iOS 元数据、技术边界和测试方案。
3. 实施计划：Gate 2 后按 TDD 写详细计划。
4. 开发与本地验收：失败测试 → 最小实现 → 全量门禁。
5. 合成 Preview：只部署可验收静态制品，不变更 Production。
6. 真机验收：PO 在 iPhone 添加到主屏幕并验证在线 / 离线行为。
7. 合并与上线：分别取得当次明确确认。

## 4. 门禁

| 门禁 | 当前状态 | 恢复条件 |
|---|---|---|
| Gate 1 PRD | completed | PO 于 2026-08-29 确认 PRD 与方案 2 已知限制 |
| Gate 2 设计 / 技术 | completed | PO 于 2026-08-29 确认图标、元数据、禁止 Service Worker 和验收方案 |
| 开始实现 | approved | 按实施计划执行 TDD；不复用为后续发布授权 |
| Preview | ready / pending approval | 本地 TDD 与治理 / 隐私 / Node / build / 浏览器门禁已通过；等待 PO 当次授权创建 Preview |
| 真机验收 | pending | 合格 Preview 可用，PO 在真实 iPhone 验收 |
| PR 合并 | pending | PO 当次确认 |
| Production | pending | 合并后 PO 当次确认；发布后再次真机复验 |

## 5. 风险

- 方案 2 不是实时联网门禁：在线加载后断网，页面可能暂时留在屏幕上。
- WebKit 安装行为会随 iOS 版本变化；Manifest 与 Apple 元数据双轨保留兼容性。
- 真机安装与独立窗口行为不能只靠 Chromium / Playwright 推断，必须保留真实 iPhone 验收。
- 当前仓库存在其他活动 PR / worktree；本任务只改 2.6.0 文档和后续 PWA 静态资产，不触碰其范围。
