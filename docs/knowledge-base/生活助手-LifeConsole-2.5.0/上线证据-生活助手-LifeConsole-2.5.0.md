# 上线证据：Life Console 2.5.0

## 1. 当前结论

2.5.0 尚未上线。本文只记录已验证事实，不使用计划或 Preview 冒充 Production 证据。

## 2. 已验证基线

- PR #56 已合并，`main` 严格 CSP 与真实浏览器启动正常。
- 2.5.0 分支创建时 Vitest 464 项、Python 92 项与 Git 隐私检查通过。
- Production 当前基线曾有缺失 favicon；2.5.0 分支已提供本地 SVG，尚待 Preview/Production 验证。

## 3. 2.5.0 本地分支证据

- Vitest 72 文件 / 534 项、Python 93 项、Playwright 8 项通过。
- Supabase Production 构建通过；严格 CSP 保持 `script-src 'self'`，只新增 `images.unsplash.com` 图片域。
- 390/1024/1280/1440 四页无根页面横向溢出；甘特和睡眠表保持内部滚动。
- 每日新闻使用公开合成 fixture 验证 401、可信来源、24 小时窗口、固定 Schema、Runtime Cache 与降级；未调用真实外部服务。
- 本节不是 Preview 或 Production 证据，不包含部署、Owner 写入、migration 或自动化结果。

## 4. 正式发布门禁

- 正式视觉、设计和技术已由 PO 确认。
- migration、Repository、UI、内容服务、备份和降级测试完成。
- 合成 Preview 与经授权 Owner Preview 完成。
- GitHub、Vercel、Supabase 账号与项目绑定已重新核对。
- PO 明确确认 migration、自动化、PR 合并和 Production。

## 5. 待上线后补齐

只记录去敏的 merge commit、CI 计数、Production 状态、Cron/自动化上海时间、桌面/移动浏览器结果、CSP/console 结论和回滚可用性。不得写入真实记录内容、Owner 标识、资源 ID 或 Secret。
