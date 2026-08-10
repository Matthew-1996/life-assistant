# Life Console 试行周控制台设计方案

这是当前最新的 Life Console 交互稿与前端实现基准，用于承接“运动恢复与 Agent 实操一周试行计划”。它是 `LifeConsole-TrialWeek-Apple-Redesign.design` 的 GitHub 可维护版本。

## 页面

- `pages/overview.html`：一周试行控制台，突出运动恢复与 Agent 实操双轨项目，以及“今天只选一个最低版”。
- `pages/capture.html`：记录页，包含大对话输入、运动恢复快速记录、今日锚点快速记录、简洁表单兜底。
- `pages/insights.html`：进展页，展示自然周路径、双轨进展、主观信号和缺失不惩罚语义。
- `pages/system.html`：系统页，展示本地 Mac、iCloud 真相源、外部派生视图、移动端/图表边界与设计治理资产关系。
- `colors_and_type.css`：本方案使用的苹果式视觉 token 和页面样式。

## 和线上实现的关系

线上 React、OpenAPI 契约、Life Hub 读写路径和 synthetic tests 都应以本目录为当前页面结构、交互语义和视觉基准，同时保留核心功能：保存、刷新、冲突处理、删除确认、状态写入、自动整理和 API 调用不能退化。

当前实现同步范围：

- React 记录页使用“运动恢复快速记录 + 今日锚点快速记录 + 对话式记录 + 简洁表单兜底 + 已录入与上下文”。
- 今日锚点快速记录通过 `/api/v1/checkins/{date}` 写入 `wake / body_light / life_action / wind_down`，不依赖右侧表单 tab。
- Dashboard 读模型必须返回 `today.anchors`、`records.recent_journals` 和 `system` 状态，支撑记录页底部上下文。
- Agent 实操保留为试行周项目和普通日记语义，不做字段化快速反馈。

## 维护规则

- 如果最新需求改变页面结构，先更新本目录的静态原型，再改 React、OpenAPI/Hub 契约和相关测试。
- 如果只改组件 token 或基础风格，优先更新 `../apple-top-level-design-system/`。
- 如果改变产品原则、隐私边界或交互语义，同步更新 `../life-console-apple-ui-ue-guidelines.md`。
- 本方案只允许合成示例，不写入真实日记、健康明细、账号、凭据或本机私有运行态。
