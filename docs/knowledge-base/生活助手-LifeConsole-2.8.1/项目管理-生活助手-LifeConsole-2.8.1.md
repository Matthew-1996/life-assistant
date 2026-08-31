# 项目管理：Life Console 2.8.1

## 1. 当前状态

- 主阶段：已上线。
- 子状态：已完成。
- 范围：工作台 Todo“今日”Tab 的本地自然日读取语义。
- 数据：不改 Schema、RPC、RLS、Owner 数据、备份或自动化。
- 应用 PR：[#86](https://github.com/Matthew-1996/life-assistant/pull/86)，已 squash 合并。
- 上线证据 PR：[#87](https://github.com/Matthew-1996/life-assistant/pull/87)，仅含去敏文档收口。
- 应用发布提交：`6a269934f1622fbfd1ffaaedc78a47a6fd7f20bc`。
- 门禁：PO 于 2026-08-31 明确授权的合成 Preview、合并、Production 与只读上线验收均已完成。

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
| 2026-08-31 | 从应用内容提交 `4e0c307` 创建纯静态合成 Preview | READY；10 个静态文件、0 Functions、0 Cron；HTTP、安全头与真实浏览器今日未来项验收通过 |
| 2026-08-31 | PR #86 最新三项 CI 通过并 squash 合并 | 准确远端 `main` 为 `6a269934f1622fbfd1ffaaedc78a47a6fd7f20bc`；远端与本地功能分支及 worktree 已清理 |
| 2026-08-31 | 从准确 `main` 触发 Vercel 远端 Production 构建 | 构建守卫与 130 模块转换通过，READY；稳定域名指向本轮部署 |
| 2026-08-31 | Production HTTP、Owner 浏览器与日志只读验收 | 通过；真实数据无同日未来时刻样本，功能条件沿用合成 Preview 证据，不创建验收数据 |

## 3. 后续门禁

1. 去敏上线证据通过独立文档 PR #87 合入 `main` 后，清理该短期分支和 worktree。
2. 本版本无其他产品或上线门禁；若后续发现新的 Todo 日期语义问题，另开维护任务。
