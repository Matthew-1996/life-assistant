# 项目管理：Life Console 2.5.0

## 1. 当前状态

- 主阶段：PO 记录页反馈已完成本地与受保护合成 Preview 验收，并确认继续开发；当前先收口 Draft PR #58 的 Node CI 可移植性，下一外部写入门禁仍为 Supabase migration 与 Owner Preview 合成写入的分别确认。
- 子状态：语义卡已移除；对话记录下已恢复日记标题、原文、编辑、软删除与恢复；Node 24 下全量 74 个 Vitest 文件 / 539 项、Python 93 项、Production build、Playwright 8/8 及 npm 0 漏洞审计通过。
- 分支：`agent/life-console-250`，独立 worktree。
- PR：[Draft PR #58](https://github.com/Matthew-1996/life-assistant/pull/58)，保持 Draft 至全量验收与合并门禁。
- 数据库、Owner Preview、自动化与 Production：均未变更。

## 2. 阶段计划

每个连续工作块不超过 4 小时：

1. 基线收口：#56 合并、Production CSP 复验、热修复分支/worktree 清理。已完成。
2. 立项：2.5.0 worktree、完整文档、Draft PR。已完成。
3. Gate 2：Visual Companion 桌面/移动视觉、设计与技术评审。已完成。
4. 数据能力：migration 文件、RLS、RPC、Repository、backup v3。已完成本地实现与测试。
5. 页面与算法：工作台、记录、进展、样式拆分。已完成本地实现与测试。
6. 内容服务：寄语展示、新闻 API、Runtime Cache、降级。已完成本地实现与测试。
7. 测试与 Preview：记录页反馈与更新后的纯静态合成 Preview 已完成；锁文件私有镜像地址已在本地修复并由防回归测试、公共 Registry 空缓存 `npm ci` 和 Node 24 全量门禁验证，待更新 Draft PR 后重跑远端 CI。
8. 上线：经逐项确认后 migration、自动化、PR 合并和 Production。

## 3. 门禁与恢复条件

| 门禁 | 当前状态 | 恢复条件 |
|---|---|---|
| 正式视觉/设计/技术 | approved | PO 于 2026-08-20 明确确认 Gate 2 v2 通过 |
| Supabase migration | pending | 代码与合成数据库验收通过，PO 当次确认 |
| Owner Preview 写入 | pending | 合成 Preview 通过，PO 确认合成写入范围 |
| 寄语自动化创建 | pending | Preview 通过，PO 确认 Prompt、RRULE 和权限 |
| 2.5.0 PR 合并 | pending | 全量 CI、独立复审、PO 验收通过并确认 |
| Production | pending | 账号/项目绑定复核、回滚方案和 PO 上线确认 |

## 4. 开放风险

- 新闻源可用性和 GDELT 结果质量不稳定：白名单、动态配比、最近成功缓存降级。
- Runtime Cache 区域一致性：两个端点固定同区并测试缓存命中。
- Unsplash Key 可能不存在：Preview 使用合成元数据，Production 使用渐变。
- 当前 bundle 大于 500 kB：样式/组件拆分时观察，不为追求指标引入无关架构。
- iCloud worktree 偶发 interrupted syscall：每次创建后验证对象、HEAD 和工作树完整性。
- 本机 npm 镜像可能把下载地址写入锁文件：已加入只允许 `registry.npmjs.org` tarball 的回归测试；仍需由 GitHub Runner 的 `npm ci` 复验本次修复。

## 5. 决策日志

| 日期 | 决定 | 状态 |
|---|---|---|
| 2026-08-19 | 2.5.0 一个版本分阶段完成 | PO 已确认 |
| 2026-08-19 | Todo DDL 不自动延后，逾期派生 | PO 已确认 |
| 2026-08-19 | 日记只软删除并可恢复 | PO 已确认 |
| 2026-08-19 | 寄语每周更新，读取最小 Owner 上下文 | PO 已确认 |
| 2026-08-19 | 新闻使用 GDELT + 白名单 + DeepSeek 公开摘要 + Runtime Cache | PO 已确认 |
| 2026-08-19 | #56 Ready、合并与基线清理 | PO 已确认并完成 |
| 2026-08-20 | 固定 1440px 评审画板按可用宽度缩放；实际双栏在不足 1180px 时转单栏 | PO 反馈，draft.2 已修订 |
| 2026-08-20 | 今日锚点复用 2.4.0 四项、四状态、进展与修改链路 | PO 反馈，draft.2 已修订 |
| 2026-08-20 | Gate 2 v2 正式视觉、设计与技术方案 | PO 已确认，进入 TDD 开发 |
| 2026-08-20 | Tasks 1–8 本地实现、390/1440 响应式与全量合成门禁 | 已通过 |
| 2026-08-20 | 独立纯静态合成 Preview、严格 CSP、未知 API 404 与 390/1440 四页验收 | 已通过；未触达 Owner 数据或 Production |
| 2026-08-20 | Draft PR 远端 privacy/Python 通过，Node 安装被锁文件内网镜像地址阻断 | 待规范化锁文件并重跑 |
| 2026-08-20 | 记录页移除语义卡，对话记录下恢复日记标题/原文及编辑、软删除、恢复 | PO 已确认设计并进入开发 |
| 2026-08-20 | 更新纯静态合成 Preview，并将 `/api/*` 404 置于 SPA fallback 前 | 已通过；0 Functions、0 Cron，未触达 Owner 数据或 Production |
| 2026-08-20 | PO 确认继续开发 | 用于收口 CI 并准备下一阶段；不替代 Supabase migration 或 Owner Preview 写入的独立确认 |
| 2026-08-20 | 将 25 个私有镜像 tarball 地址规范化到公共 npm Registry，并增加真实锁文件可移植性测试 | Node 24 公共源空缓存安装、74/539 Vitest、Python 93、build、Playwright 8/8、npm audit 0 漏洞均通过；待推送后重跑远端 CI |
| 2026-08-19 | 视觉、设计、技术确认前不写生产功能 | Gate 2 v2 后已满足 |
