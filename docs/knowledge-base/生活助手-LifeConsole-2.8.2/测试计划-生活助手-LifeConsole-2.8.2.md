# 测试计划：Life Console 2.8.2

## 核心用例

1. 更早日期开始、DDL 为今日 00:00 的未完成 Todo 展示。
2. 今日稍后开始、DDL 为未来日期的未完成 Todo 展示。
3. 明日 00:00 开始的未完成 Todo 不展示。
4. DDL 为昨日最后一刻的未完成 Todo 不展示。
5. 今日完成项保留，昨日完成项排除。
6. Supabase 请求使用 `planned_start_at < 次日 00:00` 与 `due_at >= 今日 00:00`。
7. 畸形计划开始时间或 DDL 不进入“今日”；查询测试锁定两个条件属于同一未完成项分支。
8. 合成 Preview 固定包含一条昨日开始、未来截止的未完成 Todo，供浏览器直接验收跨日展示。

## 执行顺序

1. 定向 Vitest 红灯：投影遗漏跨日 Todo，Repository 查询遗漏 `due_at` 下界。
2. 最小实现后定向绿灯。
3. `npm test` 完整 Node / Life Console Python 回归。
4. `npm run build`、工作区 Python、治理、隐私、历史隐私和差异检查。
5. 工程候选通过后创建 Draft PR；Preview、合并和 Production 分别记录独立证据。

## Preview 执行结果

- 2026-08-31 合成 Preview 为 Ready，部署仅含静态文件，没有 Functions 或 Cron。
- 浏览器切换“全部 → 今日”后，昨日开始、未来截止的跨日样本仍显示在“今日”。
- 页面没有错误覆盖层，控制台错误为空；Preview 通过，Production 尚未验收。

## Production 执行结果

- 准确合并提交使用显式 `supabase-production` 配置完成远端构建，130 个模块转换，最终 deployment 为 Ready。
- 稳定域名 `/` 与 manifest 为 200，`service-worker.js` 为 404；严格 CSP 与安全头保持。
- Owner 只读验收确认目标跨日 Todo 已在“今日”显示；未执行任何 Todo 或其他 Owner 数据写入。
