# 项目管理：Life Console 2.8.0

## 1. 当前状态

- 主阶段：待验收。
- 子状态：进行中（合成 Preview 待 PO 产品验收）。
- 范围：iOS / iPhone 移动端浮动底部导航，仅前端与 PWA 布局。
- 数据：不改 Supabase、Owner 数据、API、备份或自动化。
- 分支：`agent/life-console-bottom-nav-280`。
- PR：Draft PR [#84](https://github.com/Matthew-1996/life-assistant/pull/84)；实现候选、完整本地回归与 node / python / privacy CI 已通过。
- 授权：PO 已确认 Gate 2 四项参数，并分别授权本地 TDD 实现与合成数据 Preview；尚未授权合并或 Production。

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
| 2026-08-31 | Draft PR #84 node、python、privacy 分别以 2m13s、1m04s、6s 通过 | 远端实现候选 CI 全绿；保持 Draft |
| 2026-08-31 | PO 当次明确授权创建合成数据 Preview | Preview 门禁已开启；不扩展为合并或 Production 授权 |
| 2026-08-31 | 部署受保护的纯静态合成数据 Preview；桌面与 393×852 浏览器技术验收通过 | 等待 PO 产品验收；真实 iPhone Safari / 主屏幕 PWA 验收仍未完成 |
| 2026-08-31 | PO 真机反馈首版导航整体偏高，并明确要求尺寸参照招商银行 App | 已测量为外壳高度约 62px、物理底距约 21px；进入 TDD 修订 |
| 2026-08-31 | 招商银行参照几何完成红绿循环与完整本地回归 | 等待 Draft PR CI 与替换 Preview |

## 3. 门禁

| 门禁 | 当前状态 | 恢复条件 |
|---|---|---|
| Gate 1 PRD | completed | PO 已确认方案 2、PWA 近似与不自动收起 |
| Gate 2 设计 / 技术 / 测试 | completed | PO 已明确确认全部四项参数 |
| 本地开发 | completed | TDD 红绿循环与完整本地回归已通过 |
| Draft PR CI | completed | node、python、privacy 三项检查已通过 |
| 合成 Preview | in progress | 首版未通过 PO 产品验收；招商银行参照修订已完成本地候选，等待替换 Preview |
| PR 合并 | not authorized | Preview 产品验收与 PO 当次授权 |
| Production | not authorized | 合并后准确 main 与 PO 当次发布授权 |

## 4. 工作分解

### 已完成工作块：方案固化

- 完成 PRD、需求评审、设计、技术、测试与 PMO 草案。
- 运行治理、隐私、链接和差异校验。
- 创建 Docs-only Draft PR，完成 PO Gate 2 评审。

### 已完成工作块 A：TDD 与实现

- 先补组件、viewport 和移动几何失败测试。
- 完成 AppShell 图标、全屏安全区和浮动导航最小实现。
- 运行定向测试并更新 PMO。

### 已完成工作块 B：完整回归与候选

- 运行完整 Node / Python / Playwright / Production build。
- 独立复审并修复 Critical / Important 问题。
- PO 授权后已生成受保护的合成数据 Preview，并完成技术验收。

### 当前工作块 C：Preview 产品验收

- Preview 仅含合成数据，为纯静态站点；`/api/*` 不可用。
- 已完成 393×852 浏览器几何、四页切换、滚动常驻与控制台检查。
- 等待 PO 视觉与产品验收；真实 iPhone Safari / 主屏幕 PWA 仍按独立验收项处理。
- 首版 Preview 因导航整体偏高未通过 PO 产品验收；替换 Preview 必须使用招商银行参照修订后的准确候选提交。

## 5. 当前下一步

1. 请 PO 检查[受保护的合成数据 Preview](https://life-console-production-lbvbo3rna-test11-b88a.vercel.app)并明确产品验收结论。
2. Preview 产品验收通过后，PR 合并仍需另一次明确授权。
