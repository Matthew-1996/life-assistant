# 上线证据：Life Console 2.8.1

状态：已上线。PO 于 2026-08-31 明确授权合成 Preview 验收、PR 合并和 Production 发布；PR [#86](https://github.com/Matthew-1996/life-assistant/pull/86) 已 squash 合并，应用发布提交为 `6a269934f1622fbfd1ffaaedc78a47a6fd7f20bc`。

## 1. 发布边界

- 仅修复工作台 Todo“今日”Tab 的读取语义：未完成 Todo 的 `planned_start_at` 落在本地今日自然日即展示，不再与当前时刻比较。
- 不改 Supabase Schema、RPC、RLS、Owner 数据、写入、备份、Cron、模型或迁移。
- Production 从准确、干净的 `main` 触发 Vercel 远端构建；未复用本地 Preview Build Output 或本地 Production prebuilt 制品。

## 2. Vercel Production

- 稳定域名：[Life Console Production](https://project-wpabq.vercel.app)。
- Target 为 Production，状态 READY；稳定域名与本轮部署指向一致。
- Vercel Git 元数据为 `main` 和上述完整提交；远端 Production 环境通过构建守卫，Vite 完成 130 个模块转换。
- 本机 Vercel 环境中的敏感值保持脱敏占位符，本地守卫按预期拒绝，未输出、伪造或上传这些值。
- 发布后一小时内 Vercel `error` 级别日志计数为 0。

## 3. 只读 HTTP 验收

| 检查 | 结果 |
|---|---|
| `/` | 200；严格 CSP 保持 `script-src 'self'`，同时具有 `nosniff`、`DENY` 与 `no-referrer` |
| `/manifest.webmanifest` | 200 |
| `/service-worker.js` | 404，未扩展 Service Worker 或离线缓存范围 |
| 未认证空 POST `/api/journal-normalize-health` | 401、`cache-control: no-store`；在模型与数据访问前拒绝 |

## 4. Production 浏览器验收

- 既有 Owner 会话可正常进入工作台，页面显示 Supabase 在线，有实际内容，无错误浮层；控制台无 error / warning。
- “今日”Tab 处于选中状态，Todo 列表与甘特正常渲染；只执行“今日 / 全部”本地范围切换，不操作表单、状态、编辑或删除。
- 验收时真实 Owner 数据中“全部”默认状态范围有 1 项、“今日”有 0 项，且没有计划开始时间晚于当前时刻的今日项；因此不把真实数据冒充为本缺陷条件的直接证据。该条件已由纯合成 Preview 验证：同日 20:19 计划开始的 Todo 在 16:40 已同时出现在今日列表与甘特。
- 每日新闻既有读取失败保持为 2.5.0 范围边界，本版本未修改或宣称修复。

上述验收未复制 Todo 标题等业务内容，未写入真实 Todo、日记或健康数据，也未触发模型、Cron、迁移或数据库写入。

## 5. 结论

Life Console 2.8.1 已完成需求修复、合成 Preview 验收、PR 合并、远端 Production 发布与只读上线验收。功能证据和真实环境 smoke 证据边界分开记录，未用缺失的真实样本替代合成验收结论。
