# 上线证据：Life Console 2.5.0

## 1. 当前结论

2.5.0 尚未完整上线。PR #58 已合并，Production Supabase 与 Owner Preview 验收已完成。PO 确认后曾创建 READY 的 2.5.0 Production 并切换正式别名，但真实浏览器发现记录页宽度阻断后已立即回滚至上一健康 Production；未删除用户数据或回滚加法数据库对象。本文只记录已验证事实，不用构建成功冒充上线完成。

## 2. 已验证基线

- PR #56 已合并，`main` 严格 CSP 与真实浏览器启动正常。
- 2.5.0 分支创建时 Vitest 464 项、Python 92 项与 Git 隐私检查通过。
- Production 当前基线曾有缺失 favicon；2.5.0 分支已提供本地 SVG，尚待 Preview/Production 验证。

## 3. 2.5.0 本地分支证据

- Node 24 使用公共 npm Registry 和空缓存执行 `npm ci` 通过；当前 Vitest 74 文件 / 540 项、Python 93 项、Playwright 8 项通过。
- 锁文件 tarball 全部来自 `registry.npmjs.org`，回归测试会拒绝非公共 host；`npm audit` 为 0 个已知漏洞。
- Supabase Production 构建通过；严格 CSP 保持 `script-src 'self'`，只新增 `images.unsplash.com` 图片域。
- 390/1024/1280/1440 四页无根页面横向溢出；甘特和睡眠表保持内部滚动。
- 每日新闻使用公开合成 fixture 验证 401、可信来源、24 小时窗口、固定 Schema、Runtime Cache 与降级；未调用真实外部服务。
- 本节只记录本地证据；不包含 Preview、Owner 写入、migration 或自动化结果。

## 4. 合成 Preview 证据

以下为记录页反馈合入后的最新合成 Preview 证据；只记录去敏结果，不记录项目或部署资源 ID。

- 使用独立合成项目创建 Preview target，状态 READY；未修改 Production 或稳定正式别名。
- 上传制品与本地已验收静态构建逐文件一致，包含 4 个静态文件、0 个 Functions、0 个 Cron，没有 Owner 数据或后端运行材料。
- 首页和 SVG favicon 为 200，未知 API 为 404；CSP 使用 `connect-src 'none'`、`script-src 'self'`，不含 `unsafe-eval`。
- 记录页语义卡已移除，日记标题/原文与编辑、删除、恢复入口可见；编辑只在页面内存生效，刷新后恢复公开合成 fixture。
- 最终 Preview 的桌面/移动记录页无根页面横向溢出，console error 为 0；本地 1440px/390px 全四页 Playwright 为 8/8。
- `/api/*` 404 已由受版本控制的路由配置与回归测试锁定在 SPA fallback 前；首次发现的错误 200 制品没有晋升 Production。
- Draft PR 初始 privacy、Python、Node 三项 CI 已全绿；Node 已通过公共依赖安装、生成契约、完整测试和 build。上游 actions 的 Node 20 弃用注解为非阻断警告。新增并发修复提交后的远端状态以 Draft PR #58 当前 checks 为准，未用 migration 本身替代 CI。
- Supabase 首次只读绑定复核因账号不匹配而失败关闭；重新连接后，唯一健康项目的 API URL 与 Life Console Production 绑定精确匹配。

## 5. Production Supabase 主 migration 证据

- PO 当次确认后，通过正式 migration runner 应用 2.5.0 migration 一次；迁移历史只存在一个目标记录。
- 应用前修复寄语同-key并发 revision 竞态；事务锁回归测试、完整 2.4→2.5 migration 测试、全量 Vitest 540/540 与 Python 93/93 通过。
- 后验验证确认 3 张目标表、3 条 Owner SELECT 策略、主 migration 的 6 个受控写 RPC、backup v3 导出、RLS、GRANT/REVOKE 和空 `search_path` 均符合技术方案；Todo 软删除第七个写 RPC 的增量证据记录在 Owner Preview 章节。
- 双数据库调用的只读 transaction-scoped advisory lock 竞争与释放通过；未调用业务写 RPC，未写或读取真实 Owner 记录。
- 新增 Security Advisor 提示仅对应 6 个已评审的 authenticated `SECURITY DEFINER` RPC；没有目标表意外安全提示。Performance Advisor 的新索引未使用提示发生在空表阶段，暂不删除必要索引。
- 证据不包含 Owner 标识、项目/迁移资源 ID、SQL 结果内容或 Secret。

## 6. 正式发布门禁

- 正式视觉、设计和技术已由 PO 确认。
- migration 已应用并验证；Repository、UI、内容服务、备份和降级测试完成。
- 合成 Preview 与经授权的受保护 Owner Preview 均已完成。
- Supabase 账号和 Production URL 绑定已复核；GitHub/Vercel 绑定仍须在正式发布前复核。
- PO 仍需分别确认自动化、PR 合并和 Production。

## 7. Owner Preview 合成写入证据

- PO 明确授权合成 Owner 写入后，只操作带固定合成标记的新建记录，没有读取、编辑或删除真实日记与真实 Todo。
- Todo 验收覆盖创建、状态流转、完成、误建 Todo 二次确认软删除、列表/甘特同步移除和既有完成 Todo 保留；数据库聚合复核为目标软删除 1、活动误建项 0、保留完成项 1、目标审计事件 1。
- 日记验收覆盖创建、软删除、恢复及最终软删除；远期寄语仅写入 2099 测试周，数据库聚合复核为 1 条，不覆盖当前周寄语。
- Todo 软删除增量 migration 后验确认 `deleted_at`、活动项部分索引、空 `search_path` 与 Owner-scoped RPC 就绪；authenticated 可调用，anon/public 不可调用。Security Advisor 的 authenticated `SECURITY DEFINER` 警告属于已评审的预期调用面；新索引未使用为刚创建阶段的 INFO。
- Owner Preview 为受保护 Preview target，状态 READY；没有更新 Production alias。仅用于远期寄语的临时验收控件未进入正式提交，并在验收后从工作区移除。

## 8. Production 尝试、阻断与回滚

- 上线前重新核对 GitHub、Vercel、Supabase 账号与项目绑定；main、CI、迁移历史和 Production 环境变量名称符合方案。缺失的 CRON_SECRET 以随机高强度 Sensitive 变量补齐，值未落盘、未输出、未进入 Git。
- Production 远端构建成功并达到 READY；正式首页 200，新闻 Owner/Cron 端点无鉴权均为 401，严格 CSP 不含 unsafe-eval。
- 1440px 登录后四页实测中，工作台、进展、系统无根页面溢出；记录页文档宽度超出视口。尺寸扫描仅记录标签与 CSS 类名，定位到无结构化投影时的 review-reading__raw 原文撑开复盘列表；未输出真实复盘内容。
- 按既定回滚方案将正式别名恢复到上一健康 Production，浏览器确认旧版工作台重新可用。2.5.0 数据库表保持休眠，未删除用户数据；新闻 Cron 未手动触发，寄语自动化未创建。
- 热修复按 TDD 增加长不可断行原文浏览器用例：修复前 body 宽度 13724px、视口 1440px；为原始复盘回退分支补充断行规则后同一用例通过，完整 Playwright 9/9 通过。
- 热修复分支本地全量门禁通过：Vitest 75 文件 / 543 项、应用 Python 75 + 7 + 10 + 1 = 93 项、根工具 Python 369 项（1 项跳过）、Production build、治理与当前差异隐私检查；Miniflare 在受限沙箱内无法初始化，经允许在沙箱外专项复跑 26/26 并随完整套件通过。
- 热修复 Draft PR #59 已创建；独立合成 Preview READY。真实浏览器在 1440px 与 390px 下验证四页均无根页面横向溢出，console error 为 0；受保护首页 200、未知 API 404，严格 CSP 通过。Preview 不连接 Owner 数据且未变更任何 Production 别名。

## 9. 待重新上线后补齐

只记录去敏的 merge commit、CI 计数、Production 状态、Cron/自动化上海时间、桌面/移动浏览器结果、CSP/console 结论和回滚可用性。不得写入真实记录内容、Owner 标识、资源 ID 或 Secret。
