# 测试计划：Life Console 2.8.1

## 核心用例

1. 今日当前时刻之前计划开始的未完成 Todo 展示。
2. 今日当前时刻之后计划开始的未完成 Todo 也展示。
3. 昨日最后一刻与明日 00:00 计划开始的未完成 Todo 不展示。
4. 今日 00:00 完成的 Todo 保留，昨日最后一刻完成的 Todo 排除。
5. Supabase 请求使用本地今日起止的 `gte` / `lt` 边界，不再出现 `lte now`。

## 执行顺序

1. 定向 Vitest 红灯：投影和 Supabase Repository 测试均因旧逻辑失败。
2. 最小实现后定向绿灯。
3. `npm test` 完整 Node / Life Console Python 回归。
4. `npm run build`、工作区 Python、治理、隐私、历史隐私和差异检查。
5. PO 已于 2026-08-31 授权依次进行合成 Preview 验收、合并和 Production；Preview 只使用合成数据，Production 仅做不写真实数据的只读验收。
