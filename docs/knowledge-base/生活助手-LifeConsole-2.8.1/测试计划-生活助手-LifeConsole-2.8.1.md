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

## Preview 执行结果

- 应用内容提交 `4e0c307` 的纯静态合成 Preview 为 READY：10 个静态文件、0 Functions、0 Cron。
- 首页 / Manifest 200，`/api/daily-news` 404，严格 CSP 与安全响应头通过。
- 浏览器在“今日”Tab 验证同日未来 Todo 可见：当前 16:40，合成计划开始 20:19；列表与甘特均出现该项，控制台无 error / warning。

## Production 执行结果

- PR #86 已合并；准确 `main` 的远端 Production 构建守卫与 130 模块 Vite build 通过，状态 READY。
- 稳定域名首页 / Manifest 200、Service Worker 404、未认证空 POST 健康门禁 401 / `no-store`，安全头通过。
- Owner 浏览器显示 Supabase 在线、页面正常渲染且控制台无 error / warning；真实数据没有符合本缺陷条件的样本，未为验收创建或修改 Todo。
- 最近一小时 Vercel error 日志为 0；全程无模型、Cron、迁移或数据库写入。
