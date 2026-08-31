# 项目管理：Life Console 2.8.0

## 1. 当前状态

- 主阶段：待测试。
- 子状态：进行中。
- 范围：iOS / iPhone 移动端浮动底部导航，仅前端与 PWA 布局。
- 数据：不改 Supabase、Owner 数据、API、备份或自动化。
- 分支：`agent/life-console-bottom-nav-280`。
- PR：Draft PR [#84](https://github.com/Matthew-1996/life-assistant/pull/84)；Gate 1 / Gate 2 文档与本地实现候选在同一分支持续更新。
- 授权：PO 已确认 Gate 2 四项参数并授权本地 TDD 实现；尚未授权 Preview、合并或 Production。

## 2. 决策日志

| 日期 | 决策 | 状态 |
|---|---|---|
| 2026-08-31 | PO 指出现有底栏高度、圆角与 iPhone 屏幕不协调，要求比较全宽与浮动两案 | 已完成可行性分析与预览 |
| 2026-08-31 | PO 选择方案 2，可接受不完全原生的 PWA 替代 | Gate 1 已确认 |
| 2026-08-31 | PO 明确不做“向下滚动自动收起” | 已纳入范围与非目标 |
| 2026-08-31 | PO 确认进入方案固化阶段 | 已创建 2.8.0 设计 / 技术 / 测试草案；不等于代码或发布授权 |
| 2026-08-31 | Agent 推荐启用 `viewport-fit=cover` 并同步处理顶部 / 底部 safe-area | 待 Gate 2 PO 评审 |
| 2026-08-31 | 创建 Docs-only Draft PR #84 | 已完成；不构成代码实现、Preview、合并或 Production 授权 |
| 2026-08-31 | node CI 的既有 NodeNext 类型检查连续两次略超固定 5 秒；未改代码或测试超时，最后一次原样重跑通过 | node、python、privacy 三项 CI 全绿 |
| 2026-08-31 | PO 明确确认 Gate 2 四项：`viewport-fit=cover`、64/32/12/8px 几何、四个内联图标与不自动收起 | Gate 2 已完成；授权进入本地 TDD 实现 |
| 2026-08-31 | 按 TDD 完成组件、viewport 与浮动几何候选；Vitest 620、Life Console Python 93、Playwright 17、工作区工具 371 通过 / 1 跳过、构建、治理与隐私检查通过 | 本地候选已通过；等待 Draft PR CI |

## 3. 门禁

| 门禁 | 当前状态 | 恢复条件 |
|---|---|---|
| Gate 1 PRD | completed | PO 已确认方案 2、PWA 近似与不自动收起 |
| Gate 2 设计 / 技术 / 测试 | completed | PO 已明确确认全部四项参数 |
| 本地开发 | completed | TDD 红绿循环与完整本地回归已通过 |
| Draft PR CI | in_progress | 推送最新提交后等待 node、python、privacy 三项检查 |
| 合成 Preview | not authorized | 本地候选与完整测试通过后，PO 当次授权 |
| PR 合并 | not authorized | Preview 产品验收与 PO 当次授权 |
| Production | not authorized | 合并后准确 main 与 PO 当次发布授权 |

## 4. 工作分解

### 已完成工作块：方案固化

- 完成 PRD、需求评审、设计、技术、测试与 PMO 草案。
- 运行治理、隐私、链接和差异校验。
- 创建 Docs-only Draft PR，完成 PO Gate 2 评审。

### 当前工作块 A：TDD 与实现

- 先补组件、viewport 和移动几何失败测试。
- 完成 AppShell 图标、全屏安全区和浮动导航最小实现。
- 运行定向测试并更新 PMO。

### 工作块 B：完整回归与候选

- 运行完整 Node / Python / Playwright / Production build。
- 独立复审并修复 Critical / Important 问题。
- 仅在 PO 授权后生成合成数据 Preview。

## 5. 当前下一步

1. 推送本地候选到 Draft PR #84，等待 node、python、privacy 三项 CI。
2. CI 通过后停在 Preview 门禁，等待 PO 当次授权。
