# 上线证据：Life Console 2.8.0

状态：已上线。PO 于 2026-08-31 完成产品验收并当次授权合并上线；PR #84 已 squash 合并，准确 `main` 为 `5150f96dd80c71ec4a20509bd83c2a797f4831fa`。

## 1. 发布边界

- 发布范围仅为 iPhone / iOS PWA 底部一级导航视觉与布局：62px 高、31px 圆角、左右各 20px，导航常驻且不随向下滚动收起。
- 不改 Supabase schema、Owner 数据、API 契约、备份、Cron、模型调用或迁移。
- Production 使用 Vercel 远端构建，未部署本地 `--prebuilt` 产物。远端执行 `npm run build:supabase-production`，Production 守卫与 Vite 构建通过，完成 130 个模块转换。
- 部署前应用与 2.8.0 文档范围工作树干净；Vercel Git 元数据确认 `main` 与上述完整提交一致。

## 2. Vercel Production

- 稳定域名：[Life Console Production](https://project-wpabq.vercel.app)。
- Target：Production；状态：READY；框架：Vite；Node.js：24.x；远端构建约 35 秒。
- 稳定域名与本轮 READY 部署指向一致，未沿用旧回滚别名。
- 最近一小时 Vercel `error` 级别日志扫描为 0；未新增或改动日志 Drains、第三方监控与告警配置。

## 3. 只读 HTTP 验收

| 检查 | 结果 |
|---|---|
| `/` | 200；严格 CSP 保持 `script-src 'self'`，同时具有 `nosniff`、`DENY` 与 `no-referrer` |
| `/manifest.webmanifest` | 200，类型为 `application/manifest+json` |
| `/service-worker.js` | 404，未扩展 Service Worker、离线缓存或 Android 范围 |
| `POST /api/journal-normalize-health`，空请求且未认证 | 401、`cache-control: no-store`；在模型与数据访问前拒绝 |

上述检查未读取或写入真实日记、健康数据或其他 Owner 内容，也未触发模型、Cron、迁移或数据库写入。

## 4. Production 浏览器验收

- 在稳定域名以 402×874 视口验证：导航高 62px、圆角 31px、左右各 20px、无安全区 token 时底距 8px，文档宽度 402px，无根级横向溢出。
- 四个导航点击区均为 85×52px；工作台、记录、进展、系统逐项切换后仅当前入口具有 `aria-current="page"`。
- 内容滚动后导航保持 `position: fixed`、底距 8px、`transform: none`，没有自动收起。
- 浏览器控制台无 error / warning。
- 每日新闻卡片仍显示 2.5.0 已知读取失败状态；本版本未修改该链路，不将其误记为 2.8.0 回归或已修复。

## 5. 验收结论

Life Console 2.8.0 的产品、合并、Production 发布与只读上线验收均已完成。活动实现分支与 worktree 可按 Git 协作规范清理；后续视觉调整需进入新的维护任务，不在本次发布中继续扩展。
