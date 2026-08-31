# 项目管理：Life Console 2.8.1

## 1. 当前状态

- 主阶段：待验收。
- 子状态：进行中。
- 范围：工作台 Todo“今日”Tab 的本地自然日读取语义。
- 数据：不改 Schema、RPC、RLS、Owner 数据、备份或自动化。
- 分支：`agent/life-console-today-future-todo`。
- Draft PR：[#86](https://github.com/Matthew-1996/life-assistant/pull/86)，三项 CI 已通过。
- 门禁：PO 于 2026-08-31 明确授权依次完成合成 Preview 验收、PR #86 合并和 Production；每步仍须实际验证通过后才进入下一步。

## 2. 决策与进展

| 日期 | 事项 | 状态 |
|---|---|---|
| 2026-08-31 | PO 报告今日稍后开始的 Todo 被隐藏，明确“只要开始时间在今日就展示” | Gate 1 与本地修复范围已确认 |
| 2026-08-31 | 根因定位为投影和 Supabase 查询共用 2.5.0 `planned_start_at <= now` 旧语义 | 已完成 |
| 2026-08-31 | 先添加同日未来时刻与自然日边界红灯，再最小修正两层过滤 | 初始定向 9/9 通过；合成 Preview 与独立审查增强后 21/21 通过 |
| 2026-08-31 | 完整回归、构建、治理、当前隐私和差异检查 | 已完成；独立 worktree 便携性仍如实报告不跟踪私人真相源与既存告警 |
| 2026-08-31 | 独立代码审查 | 无 Critical；1 项 Important 测试缺口和文档证据数已修正；定向 21/21 与全量 Vitest 621/621 重跑通过 |
| 2026-08-31 | 创建 Draft PR #86 并等待远端门禁 | Node、Python、privacy 三项 CI 全部通过；保持 Draft |
| 2026-08-31 | PO 回复“授权全部” | 授权范围确认为合成 Preview 验收、PR #86 合并和 Production 发布；按顺序执行，失败即停 |

## 3. 后续门禁

1. 从最新 PR 提交创建纯合成 Preview，并验证今日稍后 Todo 在当前时刻之前可见。
2. Preview 通过后将 PR 转为 Ready、合并，并从准确 `main` 远端发布 Production。
3. 对稳定域名执行只读 HTTP 与浏览器验收；不操作真实 Todo，不触发模型、Cron、迁移或数据库写入。
