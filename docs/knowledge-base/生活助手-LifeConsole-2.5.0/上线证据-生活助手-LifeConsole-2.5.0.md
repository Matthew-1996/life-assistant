# 上线证据：Life Console 2.5.0

## 1. 当前结论

2.5.0 尚未上线。本文只记录已验证事实，不使用计划或 Preview 冒充 Production 证据。

## 2. 已验证基线

- PR #56 已合并，`main` 严格 CSP 与真实浏览器启动正常。
- 2.5.0 分支创建时 Vitest 464 项、Python 92 项与 Git 隐私检查通过。
- Production 当前基线曾有缺失 favicon；2.5.0 分支已提供本地 SVG，尚待 Preview/Production 验证。

## 3. 2.5.0 本地分支证据

- Node 24 使用公共 npm Registry 和空缓存执行 `npm ci` 通过；Vitest 74 文件 / 539 项、Python 93 项、Playwright 8 项通过。
- 锁文件 tarball 全部来自 `registry.npmjs.org`，回归测试会拒绝非公共 host；`npm audit` 为 0 个已知漏洞。
- Supabase Production 构建通过；严格 CSP 保持 `script-src 'self'`，只新增 `images.unsplash.com` 图片域。
- 390/1024/1280/1440 四页无根页面横向溢出；甘特和睡眠表保持内部滚动。
- 每日新闻使用公开合成 fixture 验证 401、可信来源、24 小时窗口、固定 Schema、Runtime Cache 与降级；未调用真实外部服务。
- 本节不是 Preview 或 Production 证据，不包含部署、Owner 写入、migration 或自动化结果。

## 4. 合成 Preview 证据

以下为记录页反馈合入后的最新合成 Preview 证据；只记录去敏结果，不记录项目或部署资源 ID。

- 使用独立合成项目创建 Preview target，状态 READY；未修改 Production 或稳定正式别名。
- 上传制品与本地已验收静态构建逐文件一致，包含 4 个静态文件、0 个 Functions、0 个 Cron，没有 Owner 数据或后端运行材料。
- 首页和 SVG favicon 为 200，未知 API 为 404；CSP 使用 `connect-src 'none'`、`script-src 'self'`，不含 `unsafe-eval`。
- 记录页语义卡已移除，日记标题/原文与编辑、删除、恢复入口可见；编辑只在页面内存生效，刷新后恢复公开合成 fixture。
- 最终 Preview 的桌面/移动记录页无根页面横向溢出，console error 为 0；本地 1440px/390px 全四页 Playwright 为 8/8。
- `/api/*` 404 已由受版本控制的路由配置与回归测试锁定在 SPA fallback 前；首次发现的错误 200 制品没有晋升 Production。
- Draft PR privacy/Python 已通过，Node 的公共依赖安装也已通过；随后三个 Todo 用例因 Runner 默认 UTC 与上海自然日 fixture 不一致而失败。该环境差异已在本地 `TZ=UTC` 下复现并修复，定向 13/13、完整 74/539、Python 93 和 build 通过；待补丁推送并重跑远端 CI 后才能记为全绿。

## 5. 正式发布门禁

- 正式视觉、设计和技术已由 PO 确认。
- migration、Repository、UI、内容服务、备份和降级测试完成。
- 合成 Preview 已完成；经授权 Owner Preview 待执行。
- GitHub、Vercel、Supabase 账号与项目绑定须在获批正式发布前重新核对。
- PO 明确确认 migration、自动化、PR 合并和 Production。

## 6. 待上线后补齐

只记录去敏的 merge commit、CI 计数、Production 状态、Cron/自动化上海时间、桌面/移动浏览器结果、CSP/console 结论和回滚可用性。不得写入真实记录内容、Owner 标识、资源 ID 或 Secret。
