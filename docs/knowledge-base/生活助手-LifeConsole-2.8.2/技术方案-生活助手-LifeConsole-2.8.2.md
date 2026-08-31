# 技术方案：Life Console 2.8.2

## 1. 根因

2.8.1 的未完成项条件只保留 `planned_start_at` 位于当地今日自然日的记录，没有读取 `due_at`。因此 8 月 27 日开始、8 月 31 日截止的 Todo 在 8 月 31 日仍会被排除。

## 2. 最小修复

以调用时 `now` 所在的本地时区计算：

```text
start = 今日 00:00:00.000
end   = 次日 00:00:00.000
```

- 未完成项：`planned_start_at < end AND due_at >= start`；
- 已完成项：继续使用 `completed_at >= start AND completed_at < end`。

合成投影和 Supabase REST 查询使用同一边界。不修改 UI、写入、Schema、RPC、RLS 或排序。

## 3. 边界说明

- `planned_start_at < end` 对应“开始日期不晚于今天”，避免把明日 00:00 算入今天。
- `due_at >= start` 对应“DDL 日期不早于今天”，包含今日 00:00 截止的 Todo。
- 数据模型要求 DDL 非空，本次无需定义无 DDL 分支。

## 4. 回滚

仅前端投影与 REST 查询语句变更；回滚应用制品即可，无数据迁移或补写。
