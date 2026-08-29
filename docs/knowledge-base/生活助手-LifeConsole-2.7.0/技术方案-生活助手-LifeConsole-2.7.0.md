# 技术方案：Life Console 2.7.0

状态：Gate 2 已由 PO 于 2026-08-29 确认。

## 1. 总体方案

```text
repository.listToday / listAll
  → raw items（原有排序）
  → visibleStatuses.has(item.status)
  → visibleItems
      ├─ Todo list + display index
      └─ TodoGantt
```

`TodoPanel` 保持一个页面内 `Set<TodoStatus>`，初始值为 `not_started` 和 `in_progress`。原始 `items` 仍保留当前范围的完整读取结果，只在渲染投影层得到 `visibleItems`。

## 2. 更新语义

- 创建、编辑、状态流转和删除仍更新原始 `items`。
- React 重新渲染时根据当前筛选重算 `visibleItems`；无需额外请求或乐观删除。
- 展示序号在 `visibleItems.map` 上重新计算，避免隐藏项留下断号。
- `TodoGantt` 接收同一 `visibleItems`，并允许父组件传入筛选专用空状态文案。

## 3. 边界

- 不改动 domain 类型、Repository Port、Supabase adapter、API、RLS 或 Schema。
- 不把筛选值放入 URL、localStorage、Session Storage 或云端。
- Tab 切换会触发原有列表读取，但不重建筛选 state。
- 不变更排序、逾期计算、幂等键或 revision 并发控制。

## 4. 回滚

本版本只涉及前端投影、空状态和样式；回滚到上一前端制品即可。无数据迁移、补写或清理操作。
