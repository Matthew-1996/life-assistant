# 项目管理：Life Console 2.6.0

## 1. 当前状态

- 主阶段：已上线。
- 子状态：已完成。
- 分支：2.6.0 功能与上线证据分支均已合并清理；当前在独立 `agent/life-console-edit-datetime-width` 分支处理编辑弹窗的移动端快速维护候选。
- PR：PR [#77](https://github.com/Matthew-1996/life-assistant/pull/77) 已 squash merge，包含治理文档、iOS 安装资产、响应式修复与自动化契约；编辑弹窗快速维护候选位于 Draft PR [#82](https://github.com/Matthew-1996/life-assistant/pull/82)。
- 实现：本地候选、390px 底部导航安全区、Todo 表单单列、记录页 iOS 日期筛选与 Todo“计划开始”/“DDL”日期时间边界修复已完成；Manifest、Apple Touch Icon、iOS 元数据和无 Service Worker 边界均已自动验证。
- 数据：不改数据库、Owner 数据、备份或自动化。
- 发布：合并后的准确 `main` 已发布到 [正式站点](https://project-wpabq.vercel.app/)；Production READY，安全、PWA、未登录门禁和 390px 只读验收通过。编辑弹窗快速维护已创建[受保护合成 Preview](https://life-console-synthetic-preview-2llfw6ii1-test11-b88a.vercel.app)，没有变更 Production。发布后主屏幕安装 / 离线真机复验仍待 PO。

## 2. 决策日志

| 日期 | 决策 | 状态 |
|---|---|---|
| 2026-08-28 | 用户要求轻量安全 PWA，仅适配 iOS | 已确认方向 |
| 2026-08-28 | 用户接受在线才能使用、断网可显示错误 | 已确认方向 |
| 2026-08-28 | 用户从受控离线页改选“仅安装配置”，接受感知 iOS 原生离线状态 | 已确认方向 |
| 2026-08-29 | PO 确认 Gate 1 与 Gate 2，允许按方案 2 进入 TDD 实现 | 已确认 |
| 2026-08-29 | 方案 2 最小实现与本地全量门禁完成 | 已完成；不构成 Preview、合并或发布授权 |
| 2026-08-29 | PO 确认创建受保护纯静态合成 Preview | 已完成；Preview 不连接 Owner 数据，不构成合并或 Production 授权 |
| 2026-08-29 | PO 指出 390px 按钮与底部导航重叠，并确认采用独立正文滚动区与导航安全区方案 | 已按 TDD 修复；修复版 Preview 四页复验通过 |
| 2026-08-29 | PO 反馈“新建 Todo”仍与其他组件重合 | 已确认第一次自动化只覆盖控件与底栏交集；Todo 两列布局中的 DDL 输入与按钮存在真实交集，已按 TDD 改为移动端单列并部署二次修复版 Preview |
| 2026-08-29 | PO 反馈记录页“筛选日记日期”控件超出边界 | 已确认命中 iOS WebKit 对带 padding 的 date 输入错误计算 `width: 100%` 的已知问题；按 TDD 增加 28px 越界几何回归、避开触发条件并部署第三次响应式修复版 Preview |
| 2026-08-29 | PO 反馈 Todo“计划开始”和“DDL”组件超出边界 | 已确认相同 iOS WebKit 问题也覆盖 `datetime-local`；按 TDD 对两个控件增加 20px 越界几何回归、避开触发条件并部署第四次响应式修复版 Preview |
| 2026-08-29 | PO 确认最新 Preview“没问题了” | 最新 390px 响应式修复验收通过 |
| 2026-08-29 | PO 明确要求“继续开发上线” | PR #77 合并与本次 Production 发布已获当次授权；不扩展数据、API、自动化或离线能力范围 |
| 2026-08-29 | PR #77 squash merge，准确 `main` 发布到既有 Production | READY；稳定别名、PWA 资产、严格 CSP、无 Service Worker、未登录 401 与 390px 四页只读验收通过 |
| 2026-08-30 | PO 反馈移动端 Todo 编辑弹窗的“计划开始”与“DDL”宽于其他字段 | 已确认编辑表单未被原 iOS `datetime-local` 移动端宽度规则覆盖；按快速维护 + TDD 形成 Draft PR #82，不构成 Preview、合并或 Production 授权 |
| 2026-08-30 | PO 确认创建受保护合成 Preview | 已从 Draft PR #82 准确提交创建纯静态 Preview 并完成只读 390px 验收；未授权合并或 Production |
| 2026-08-31 | PO 确认编辑弹窗快速维护 Preview“已验收，符合预期” | Preview 验收完成；Draft PR #82 继续等待单独的合并授权，Production 未变更 |

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
| Preview | completed | 第四次响应式修复版受保护合成 Preview READY；9 个静态文件、0 Functions、0 Cron，390px 两个 Todo 日期时间控件右侧溢出为 0，四页内容控件彼此交集、控件横向越界、底栏自身交集与根横向溢出均为 0 |
| 编辑弹窗快速维护 Preview | completed | Draft PR #82 受保护纯静态 Preview READY；10 个静态文件、0 Functions、0 Cron，真实浏览器 390px 四个编辑字段左右边界一致，日期时间右侧溢出为 0；未授权合并或 Production |
| 编辑弹窗快速维护 PO 验收 | completed | PO 于 2026-08-31 确认“已验收，符合预期”；该确认不自动授权 PR 合并或 Production |
| PO Preview 验收 | completed | PO 于 2026-08-29 确认最新修复版“没问题了” |
| PR 合并 | completed | PR #77 已通过三项 CI 并 squash merge；准确 merge commit 已记录 |
| Production | completed | 已从准确 `main` 发布；READY、稳定别名、PWA 资产、安全头、401 门禁和 390px 四页布局已只读验收 |
| 发布后真机复验 | pending | PO 从正式域名重新添加主屏幕图标，复验独立窗口、登录恢复与飞行模式行为 |

## 5. 风险

- 方案 2 不是实时联网门禁：在线加载后断网，页面可能暂时留在屏幕上。
- WebKit 安装行为会随 iOS 版本变化；Manifest 与 Apple 元数据双轨保留兼容性。
- 真机安装与独立窗口行为不能只靠 Chromium / Playwright 推断，必须保留真实 iPhone 验收。
- 当前仓库存在其他活动 PR / worktree；本任务只改 2.6.0 文档和后续 PWA 静态资产，不触碰其范围。
