# 上线证据：Life Console 2.8.2

状态：已上线。PO 于 2026-08-31 明确日期区间规则并授权完成本次修复；PR [#88](https://github.com/Matthew-1996/life-assistant/pull/88) 已 squash 合并，准确 `main` 为 `dab7609ef8a000fed4da237880182d79b85c014a`。

## 1. 发布范围

- 仅修正未完成 Todo 的“今日”日期区间：`计划开始日期 ≤ 今天 ≤ DDL 日期`，小时不参与筛选。
- 时间戳查询等价为 `planned_start_at < 次日 00:00` 且 `due_at >= 今日 00:00`。
- 不改 Supabase Schema、RPC、RLS、Owner 数据、备份、Cron、模型调用或迁移。

## 2. Vercel Production

- 稳定域名：[Life Console Production](https://project-wpabq.vercel.app)。
- Deployment：`dpl_F9VDefC7sQzgbnb6J2zMA3vPXJ6A`；Target 为 Production，状态为 Ready。
- 使用准确合并提交的干净 worktree 与不含密钥的既有 Production 配置，执行 Vercel 远端构建；远端命令为 `npm run build:supabase-production`，130 个模块完成，资源为 `index-D--cfyY8.js`。
- 首次远端部署未显式带入 Production 构建配置，页面落入 local 模式；发现后立即回滚至上一健康部署。随后使用经语义比对的 Production 配置重发，确认 Supabase Production 模式后才提升到稳定域名。错误部署未作为最终发布证据。

## 3. 只读 HTTP 验收

| 检查 | 结果 |
|---|---|
| `/` | 200；资源哈希与本轮 `supabase-production` 构建一致；严格 CSP 保持 `script-src 'self'`，同时具有 `nosniff`、`DENY` 与 `no-referrer` |
| `/manifest.webmanifest` | 200，类型为 `application/manifest+json` |
| `/service-worker.js` | 404；未新增 Service Worker、离线缓存或 Android 范围 |

## 4. Owner 浏览器验收

- 稳定域名显示 `Life Console · Online` 与 `Supabase · 在线`，无错误覆盖层，也未进入 local 或私有工作台错误空态。
- 保持“今日”Tab 与既有状态筛选，只读确认 Owner 提供的目标跨日 Todo 已显示；其计划开始为较早日期、DDL 为今日，直接覆盖本次规则。
- 验收未创建、编辑、改状态或删除任何 Todo，也未写入其他 Owner 数据。

## 5. 结论

Life Console 2.8.2 的规则确认、实现、测试、Preview、PR 合并、Production 发布和 Owner 只读验收均已完成。发布期间发现的构建模式错误已回滚并纠正，最终稳定域名指向正确的 Supabase Production 构建。
