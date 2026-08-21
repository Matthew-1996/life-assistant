# 上线证据：Life Console 2.5.0

## 1. 当前结论

2.5.0 已上线，内容自动化后端与手动 Cron 已完成验收。PR #58、PR #59、PR #60、PR #62 与 PR #63 均已合并；Production Supabase、Owner Preview、桌面/移动页面、严格 CSP、DeepSeek 合成健康探针、每日新闻 Cron 与每周寄语运行实例均已验收。PR #63 发布后发现 Owner 登录恢复阶段的新闻展示启动竞态，最小热修复正在独立 Draft PR 门禁内，未在本文中提前标记为已发布。

## 2. 已验证基线

- PR #56 已合并，`main` 严格 CSP 与真实浏览器启动正常。
- 2.5.0 分支创建时 Vitest 464 项、Python 92 项与 Git 隐私检查通过。
- Production favicon、四页渲染、严格 CSP、鉴权端点与稳定正式别名均已完成验证。

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
- Supabase、GitHub 与 Vercel 的 Production 账号/项目绑定已在发布前复核。
- migration、Owner Preview、自动化创建、PR 合并与 Production 的逐项门禁均已取得并执行。

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
- 热修复 Draft PR #59 已创建；独立合成 Preview READY。真实浏览器在 1440px 与 390px 下验证四页均无根页面横向溢出，console error 为 0；受保护首页 200、未知 API 404，严格 CSP 通过。Preview 不连接 Owner 数据且未变更任何 Production 别名；远端 privacy、Python、Node CI 全绿。

## 9. PR #59 重新上线证据

- PO 当次确认合并 PR #59 与重新发布 Production；`main` 合并后 privacy、Python、Node CI 全绿。
- Production 构建 READY 并切换正式别名；首页 200，两个新闻端点无鉴权 401，严格 CSP 不含 `unsafe-eval` 且保留 Unsplash 图片域。
- Owner 登录后以 1440px/390px 复验工作台、记录、进展、系统四页，根页面均无横向溢出；记录原始回退内容断行正常，console error 与可见错误提示均为 0。
- Todo 删除入口、日记编辑/删除/已删除列表/恢复入口可用；顶部旧“数据已迁移”提示不再展示。验证只输出控件计数与布尔结果，未记录真实内容。

## 10. 正式站点横幅快速维护

- PO 明确要求正式站点不展示“Supabase 唯一真相源 / iCloud 单向备份”状态组件，并确认轮换 `CRON_SECRET`、重新部署与手动触发新闻 Cron。
- 该改动与 PRD 已确认的全局顶部减法一致；TDD 回归测试在旧实现上明确失败，最小移除 Production 渲染分支后通过。
- TDD 后完整本地门禁通过：Vitest 75 文件 / 543 项、应用 Python 93 项、根工具 Python 369 项（1 项跳过）、Production build、Playwright 9/9、治理、当前差异隐私与 `git diff --check`。受限沙箱内回环监听被权限拒绝；沙箱外原套件通过，没有放宽超时或测试口径。
- Draft PR #60 已创建。独立合成 Preview READY；1440px/390px 均未渲染目标状态组件或文案，根页面无横向溢出、无错误覆盖层；首页 200、未知新闻 API 404，严格 CSP 使用 `connect-src 'none'` 且不含 `unsafe-eval`。该 Preview 不连接 Owner 数据、不含 Functions/Cron、不修改 Production。
- PR #60 与合并后 `main` 的 privacy、Python、Node CI 全绿。Production 远端构建 READY，稳定正式别名已确认指向新部署；首页 200，Owner 新闻与 Cron 端点无鉴权均为 401，严格 CSP 不含 `unsafe-eval`。
- `CRON_SECRET` 首次交互式轮换发生终端逐字符回显，因此该值立即视为泄露并被第二个全新随机值覆盖；第二次使用关闭回显的内存输入，Vercel 只读确认最终变量仍为 Sensitive。两个值均未写入文件、Git 或证据，运行后内存引用已清除。
- 使用最终密钥手动触发 Cron 两次，均通过鉴权并返回 `503 / empty / retryable`；公开只读探测确认 GDELT 三类查询均在产品规定的 8 秒窗口内超时。没有持续重试、没有伪造摘要；正式 UI 显示“暂时没有可用摘要”和重试入口，符合无缓存降级方案。
- Owner 登录后的正式站点在 1440px/390px 逐页复验工作台、记录、进展、系统：目标横幅与文案计数均为 0，根页面横向溢出为 0，可见错误提示为 0；品牌状态、四页导航与新闻区域保留。最近 15 分钟 Production error 级别日志为 0。
- 回滚锚点在发布前私下记录并在发布成功后清除；未删除用户数据或数据库对象。不得在 Git 中记录 Secret、Owner 标识或精确部署资源 ID。

只记录去敏的 merge commit、CI 计数、Production 状态、Cron/自动化上海时间、桌面/移动浏览器结果、CSP/console 结论和回滚可用性。不得写入真实记录内容、Owner 标识、资源 ID 或 Secret。

## 11. 内容自动化最终上线证据

- DeepSeek Production Owner 合成健康探针返回 `HTTP 200 / provider_ok / no-store`；请求只含代码内置合成文本，不读取或写入真实日记，不记录模型正文。
- PR #62 修复项目自身对 GDELT 的三并发违规，改为三类请求至少间隔 5 秒，并将两个重建 Function 上限调整为 60 秒。完整本地门禁与远端 privacy、Python、Node CI 均通过。
- 合并后的 Production 构建达到 READY，随后按 staged 发布流程提升并切换稳定正式别名；首页 200，稳定域名与验收部署资产一致，严格 CSP 不含 `unsafe-eval`。
- Vercel Cron Jobs 显示任务 Enabled，路径为 `/api/cron/daily-news`，计划为 `23:00 UTC` 日运行，对应上海次日名义 07:00；当前 Hobby 调度允许在 07:00–07:59 内弹性触发。未带凭据请求返回 `401 / no-store`，请求落在预定区域。
- 控制台 Run 首跑通过鉴权并进入新部署函数，最终为 `503 / retryable empty`；这是 GDELT 共享出口持续限流下的已设计降级。没有持续重试、没有绕过白名单，也没有伪造摘要。
- 每周寄语私有规范 Prompt、注册表摘要与运行实例一致；实例状态 ACTIVE，每周一 12:00 上海时间运行，最近一次只读核对的下一次运行落在允许抖动内。未手动触发当前周写入，未读取或记录 Owner 内容。
- 回滚点保留为上一健康 Production；如内容服务异常，可恢复上一部署并停用两项自动化。加法数据库对象继续保留，不删除用户数据。

## 12. 新闻可靠性发布前证据

- 已实现 GDELT 主源失败或候选不足时切换新华网/BBC 官方公开源，并保留可信域名、24 小时、去重与分类配比门槛；各外部请求具备流式响应体上限和贯穿完整读取阶段的超时控制，总外部等待预算低于 Function 上限。
- 每次 Cron 使用独立 Runtime Cache key 写入去敏运行收据，并维护最近 7 天索引；即使索引更新失败，单次收据仍可按运行 ID 查询。Owner 鉴权运行记录接口、401/200、并发实例和部分缓存故障均有合成回归测试。
- 精确内容服务测试 6 文件 / 55 项，全量 Vitest 78 文件 / 582 项、应用 Python 93 项、根工具 Python 372 项（1 项跳过）、Production build、Playwright 9/9、治理与隐私门禁均通过；独立代码评审无 Critical 或 Important 阻断项。
- Draft PR #63 的 privacy、Python、Node 三项远端 CI 全绿，PR 仍为 Draft。纯静态合成 Preview READY：首页 200、新闻 API 404、严格 CSP `connect-src 'none'` 且不含 `unsafe-eval`，制品含 0 个 Functions、0 个 Cron、无 Owner 连接或 Production Secret。
- 1440px/390px 四页均有有效内容、无根页面横向溢出或错误覆盖层。唯一 console 异常来自 Vercel Preview Protection 工具栏对 `vercel.com/api/jwt` 的 403 及其 Google Provider/FedCM 提示，不属于应用自身请求。
- PO 已于 2026-08-21 当次确认验收、合并、发布和手动触发今日新闻 Cron；执行结果见第 13 节。

## 13. PR #63 Production 与今日新闻 Cron 证据

- PR #63 已按 PO 当次确认 squash merge；合并后 `main` 的 privacy、Python、Node 三项 CI 全绿。发布制品来自同一合并提交，Production 达到 READY，稳定正式域名指向最终部署。
- 首次远端发布使用自定义本地配置路径时，部署 API 未保留 Cron 定义；在不含 Secret 的同一配置上复现并定位后，改用临时根 `vercel.json` 完成最终发布。最终部署包含 Cron，临时文件已删除且未进入 Git；没有读取、轮换或输出 Secret。
- 正式首页返回 200；新闻、运行收据和 Cron 三个端点在无凭据时均返回 401 与 `no-store`；严格 CSP 不含 `unsafe-eval`。
- Vercel 控制面确认 `/api/cron/daily-news` 为 Enabled，计划 `0 23 * * *`。通过控制面手动运行一次，Production 日志显示 Cron GET 返回 HTTP 200。
- Owner 只读核验显示最新运行收据为 `success`，发现来源为官方发布方备用源，日期为 2026-08-21；当日摘要为 5 条，覆盖科技、财经、政治最低配比及国内/国际范围。证据不记录标题、Owner 标识或任何私人记录。
- 同一成功响应通过正式 `DailyNewsClient` 解析契约，结果为 5 条；但已登录 Production 浏览器在登录恢复后未发出 `/api/daily-news` 请求，页面仍为空。该差异定位为认证启动竞态，不是新闻生成或缓存失败，因此本节不把 Owner 页面可见性标记为通过。
- 独立热修复以 TDD 新增应用级 access-token provider：在 AuthGate 挂载前订阅 Supabase 认证事件，认证事件可直接结束已挂起的会话读取，并用 revision 防止迟到会话覆盖刷新或退出；无事件 token 时保留 `getSession()` 回退。修复分支 Vitest 79 文件 / 587 项、应用 Python 93 项、Production build、Playwright 9/9、治理与隐私门禁全绿；独立代码评审无 Critical 或 Important 阻断项，仍需 Draft PR/Preview、PO 合并和 Production 当次确认。
- Draft PR #64 已创建并保持 Draft。纯合成 Preview READY；1440px 与 390px 四页均无根页面横向溢出，严格 CSP 不含 `unsafe-eval`，runtime error 为 0，`/api/daily-news` 为 404。Preview 使用静态候选模式，0 Functions、0 Cron，不连接 Owner 数据或 Production Secret；认证竞态的最终证据仍是发布后 Owner 浏览器确实发出新闻请求。

## 14. PR #64 发布结果与后续门禁

- PR #64 已按 PO 当次确认合并并重新发布 Production；发布状态、稳定别名、合并提交和新闻 Cron 配置一致，匿名鉴权与严格 CSP 通过。
- Owner 新闻接口只读复验返回 2026-08-21 成功摘要 5 条，但真实浏览器仍未发出新闻请求，页面保持空态。因此 PR #64 只记录为已发布，不记录为前端展示验收通过。
- PO 已确认进入 PR #65 开发。PR #65 只统一 AuthGate 与新闻客户端的内存 Token 生命周期，不改数据库、新闻内容、Cron、Secrets 或 Owner 数据；完成 Draft PR 和合成 Preview 后仍需新的验收与 Production 确认。
