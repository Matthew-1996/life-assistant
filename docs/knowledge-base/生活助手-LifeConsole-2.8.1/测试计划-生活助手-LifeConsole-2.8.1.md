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
5. Preview、Owner 浏览器验收、合并与 Production 仅在取得对应授权后进行。
