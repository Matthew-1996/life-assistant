# 项目管理：Life Console 2.8.2

## 1. 当前状态

- 主阶段：待验收。
- 子状态：待开始。
- 范围：工作台 Todo“今日”Tab 的跨日日期区间读取语义。
- 数据：不改 Schema、RPC、RLS、Owner 数据、备份或自动化。
- 分支：`agent/life-console-today-date-range`。
- PR：[#88](https://github.com/Matthew-1996/life-assistant/pull/88)，Draft。
- 门禁：Gate 1、本地全量工程验证、独立审查修订和 Draft PR CI 已完成；Preview、合并和 Production 尚未完成。

## 2. 决策与进展

| 日期 | 事项 | 状态 |
|---|---|---|
| 2026-08-31 | PO 明确规则为 `计划开始日期 ≤ 今天 ≤ DDL 日期`，忽略小时 | Gate 1 已确认 |
| 2026-08-31 | 根因定位为投影和 Supabase 查询只按今日开始日期过滤 | 已完成 |
| 2026-08-31 | 添加跨日区间与查询边界红灯测试 | 2 项按预期失败 |
| 2026-08-31 | 最小修正两层过滤 | 定向 11/11 通过 |
| 2026-08-31 | 完整回归、构建、治理、当前隐私和差异检查 | Vitest 623/623、Life Console Python 93/93、工作区 Python 372 通过 / 1 跳过；构建与三项检查通过 |
| 2026-08-31 | 独立代码审查 | 1 项 Important 查询分组测试缺口与 2 项 Minor 已修正；增加畸形 DDL 失败关闭，定向 11/11 通过 |
| 2026-08-31 | 审查修订后全量复验 | 既存 Miniflare 响应体竞态单独 7/7 通过后，完整 Vitest 623/623、Life Console Python 93/93 与 Production build 重跑通过 |
| 2026-08-31 | 创建 Draft PR #88 | 已创建；等待远端 CI |
| 2026-08-31 | Draft PR #88 CI | Node、Python、privacy 三项检查全部通过 |
| 2026-08-31 | 为 Preview 增加跨日合成样本 | TDD 红灯后将“整理旅行清单”设为昨日开始、未来截止；最终 Vitest 624/624、Life Console Python 93/93 与 Production build 通过 |

## 3. 下一步

1. 执行只含合成数据的 Preview 验收。
2. Preview 通过后按授权处理 PR #88 合并。
3. Production 发布与只读验收按独立证据推进。
