# 技术方案：Life Console 2.8.1

## 1. 根因

2.5.0 的旧定义是“今日展示已经开始的开放项”。该定义同时固化在：

- `selectTodayTodos`：未完成项使用 `planned_start_at <= now`；
- `TodoRepository.listToday`：Supabase REST `or` 过滤使用同样的 `lte now`。

因此今日未来时刻的 Todo 在到达开始时间之前根本不会进入组件。

## 2. 最小修复

以调用时 `now` 所在的本地时区计算：

```text
start = 今日 00:00:00.000
end   = 次日 00:00:00.000
```

- 未完成项：`planned_start_at >= start AND planned_start_at < end`；
- 已完成项：继续使用 `completed_at >= start AND completed_at < end`。

合成投影和 Supabase 查询使用同一边界。不在 UI 增加第二次过滤，不修改写入、Schema、RPC、RLS 或排序。

## 3. 回滚

仅前端投影与 REST 查询语句变更；回滚应用制品即可，无数据迁移或补写。
