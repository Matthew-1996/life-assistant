# 工程评审与验收：Life Console 2.5.0

## 1. 当前状态

- 主阶段：PR #58、Supabase migration、Owner Preview、PR #59 热修复与 2.5.0 Production 重新发布已完成；当前执行 PRD 既有顶部减法的快速维护。
- 生产功能：Supabase 日记契约未变；Todo 为 revision-safe 软删除。回滚只恢复 Vercel Production，不删除用户数据或回滚加法数据库对象。
- 基线：2.5.0 Production 已经 1440px/390px 四页、严格 CSP 与 console 复验。
- 热修复：实际溢出节点为无结构化投影时的 review-reading__raw；长不可断行合成原文在修复前稳定失败，补充 overflow-wrap 后通过。

## 2. 已有基线证据

| 门禁 | 结果 |
|---|---|
| Git 隐私与 hooks | 通过 |
| npm 安装 | 锁文件安装成功，0 个已知漏洞 |
| Vitest | 54 文件 / 464 项通过 |
| Python | 75 + 7 + 9 + 1 = 92 项通过 |
| Production build | 通过 |
| 严格 CSP Playwright / 真实浏览器 | 通过 |

这些证据只证明 2.5.0 开发前基线，不得冒充 2.5.0 功能验收。

## 3. Gate 2 验收

结论：PO 于 2026-08-20 明确确认 Gate 2 v2 通过。以下视觉、设计与技术约束成为实现基线：

- 1440px 工作台、记录、进展、Todo 甘特；1280px/1024px 画板和组件不越出屏幕，空间不足时双栏转单栏。
- 390px 工作台、记录、进展。
- 今日锚点复用 2.4.0 四项、四种语义、填写进展与修改入口。
- 日记删除确认、已删除和恢复。
- 新闻陈旧/空态、趋势数据不足、寄语渐变降级。
- PRD、需求评审、设计、技术和测试计划无冲突或未决项。

## 4. 功能验收矩阵

| 域 | 必须通过 |
|---|---|
| 数据 | 双 Owner RLS、幂等、revision、原子时间、软删除/恢复、v2/v3 备份 |
| 工作台 | Todo 创建/编辑/状态/软删除全链路、甘特、新闻、寄语、今日锚点、移除旧区块与顶部环境提示 |
| 记录 | 无语义卡；对话式记录下显示日记标题/原文；编辑、折叠、删除确认、恢复、复盘长文本 |
| 进展 | 14 天趋势、样本不足、4 个健康指标、7 天睡眠时刻 |
| 安全 | 401、Secret 隔离、外部文本不可信、严格 CSP、隐私/历史隐私 |
| 响应式 | 390px/1440px 无页面横向溢出，键盘和 Reduced Motion |

## 5. 本地合成验收证据

验收基线：提交 `008c765` 之后完成 Task 8；所有外部服务继续使用公开合成 fixture 或注入式响应，没有读取或写入真实 Owner 数据。

| 门禁 | 结果 |
|---|---|
| 需求/设计/技术治理 | 通过；PO 规范原文与 Gate 2 v2 状态一致 |
| Git 协作与隐私 | hooks、当前差异与凭据检查通过 |
| 公共 Registry 空缓存安装 | Node 24 `npm ci` 通过；未使用本机旧缓存，0 个已知漏洞 |
| Vitest | 74 文件 / 540 项通过；新增锁文件 tarball host 与寄语同-key事务锁防回归测试 |
| Python | 75 + 7 + 10 + 1 = 93 项通过 |
| Supabase Production build | 通过；严格 CSP 不含 `unsafe-eval` |
| Playwright | 8/8 通过；真实 Chrome 无错误覆盖层、console error 或 page error |
| npm audit | 0 info / low / moderate / high / critical |
| UTC Runner 等价复验 | 外层 `TZ=UTC` 下定向 Todo 13/13、当时全量 Vitest 74/539、Python 93 和默认 build 通过；Vitest 内明确使用 `Asia/Shanghai` |
| GitHub Actions | privacy、Python、Node 三项通过；Node 包含公共 `npm ci`、生成契约、完整测试和 build |
| 响应式 | 390/1024/1280/1440 根页面无横向溢出；不足 1180px 自动单列 |
| 内部滚动 | 仅 Todo 甘特与 7 天睡眠表在窄屏内部横向滚动 |
| 日记删除/恢复 | React 组件级确认弹窗、取消、软删除与恢复通过；Owner 浏览器写验收等待独立门禁 |
| 新闻 | 401、白名单、24 小时窗口、去重配比、模型 Schema、体积/超时、单飞缓存与陈旧降级通过 |
| favicon | 本地 SVG 已进入构建产物，浏览器返回 `image/svg+xml` |

`tools/validate_project.py` 在隔离 worktree 中仍会报告 Git 排除的私人真相源/派生文件缺失，以及一个既有失效研究链接；未复制私人数据来伪造通过。新增代码导致的日记契约绑定与 Secret 误报已修复。

## 6. 合成 Preview 验收证据

更新后的验收制品来自本次记录页反馈提交的 `candidate-preview` 静态构建；使用既有独立合成项目，只创建 Preview deployment，不变更 Production 别名。

| 项目 | 结果 |
|---|---|
| 制品边界 | 与本地已验收静态构建逐文件一致；没有 `functions/`、Owner 数据或 Supabase/DeepSeek/Cron/OIDC 运行材料 |
| 远端状态 | Vercel target=`preview`、状态 READY；Deployment Protection 保持开启 |
| HTTP 与安全头 | `/` 200、`/favicon.svg` 200 且为 SVG、未知 `/api/daily-news` 404；严格 CSP 为 `connect-src 'none'` 且不含 `unsafe-eval` |
| 桌面/移动 | 最终 Preview 的工作台、记录、进展、系统在 1440px 与 390px 均无根页面横向溢出 |
| 响应式 | 工作台桌面双栏、移动单栏；移动甘特和睡眠表仅在组件内部横向滚动 |
| 浏览器 | 无 Vite 错误覆盖层，console error 为 0 |
| 数据与发布 | 未调用 API、未写 Owner 数据、未执行 migration、未修改 Production |

记录页更新后的专项验收：定向 4 个文件 / 24 项通过；本次 CI 可移植性修复后的全量 Vitest 为 74 个文件 / 539 项，Python 为 93 项。受保护 Preview 中语义卡计数为 0，合成日记标题与原文可见，编辑只在当前页面内存生效且刷新重置，删除/恢复入口可见；远端桌面与移动布局无页面横向溢出，console error 为 0。软删除、二次确认和恢复的实际状态变化已由本地真实浏览器与组件测试覆盖，远端未写任何数据。

发布前 HTTP 验收曾发现 SPA fallback 会抢先把 `/api/*` 返回为首页 200；已增加受版本控制的合成 Preview 配置和回归测试，将 API 404 路由置于 fallback 前。最终制品逐文件匹配本地静态构建，包含 4 个静态文件、0 个 Functions、0 个 Cron；远端 `/` 与 `/favicon.svg` 为 200，`/api/daily-news` 为 404，严格 CSP 仍为 `connect-src 'none'` 且不含 `unsafe-eval`。

远端 CI 首轮曾因 25 个 tarball 指向本机镜像而无法安装；公共 Registry 规范化与回归测试推送后，GitHub Runner 的 `npm ci` 已通过。Node 随后暴露 Runner 默认 UTC 与上海自然日 fixture 的差异；本地以 `TZ=UTC` 精确复现相同三项失败后，仅在 Vitest 配置固定 `Asia/Shanghai`。最终 GitHub Actions 的 privacy、Python、Node 三项均通过，Node 完成公共安装、生成契约、完整测试和 build。上游 actions 的 Node 20 弃用注解为非阻断警告。

Supabase 首次上线前只读核对曾因账号不匹配而失败关闭；重新连接后，唯一健康东京项目的 API URL 与 Life Console Production 本地绑定精确匹配。Vercel 拉取文件对敏感 publishable key 使用遮罩，因此未尝试输出或比对密钥明文；项目身份以 URL 与插件可见项目状态复核，Owner 鉴权链路留在受保护 Preview 门禁验证。

## 7. Production Supabase 主 migration 证据

- PO 于 2026-08-20 明确确认执行本次 migration；该确认不跨 Owner Preview、自动化、PR 合并或 Vercel Production 门禁复用。
- 应用前独立审查发现 `upsert_dashboard_message` 对既有周寄语的同-key并发重试可能先触发 revision 冲突。先以失败测试复现缺少事务锁，再按 Owner UUID + 幂等键增加 transaction-scoped advisory lock；定向数据库测试 13/13 通过。
- 专门的 migration 测试从完整 2.4 schema 应用 2.5 migration并重复执行；Vitest worker 固定为 3 后，在不放宽原 5/10 秒超时的情况下全量 74 文件 / 540 项、Python 93 项通过。
- migration 通过正式 Supabase migration runner 应用一次。后验 catalog 核对确认 3 张目标表启用 RLS，恰有 3 条 authenticated Owner SELECT 策略；anon 无 SELECT，authenticated 有 SELECT 但无直接 INSERT/UPDATE/DELETE。
- 主 migration 的六个写 RPC 均为 `SECURITY DEFINER`、空 `search_path`、authenticated 可执行、public/anon 不可执行；backup v3 导出继续为 `SECURITY INVOKER`。函数定义中事务锁先于幂等键读取。Todo 软删除第七个写 RPC 的增量验证记录在下一节。
- 两个独立数据库调用以只读事务竞争同一 advisory lock：等待方仅在持锁方事务结束后返回，两次调用无错误，结束后 advisory lock 计数为 0。该验证不调用业务 RPC、不写 Owner 记录。
- Security Advisor 新增的 6 条提示只对应上述 authenticated `SECURITY DEFINER` RPC，已逐个审查 `auth.uid()`、Owner 条件、空 `search_path` 与 execute grants；目标表没有意外安全提示。[Supabase Database Functions](https://supabase.com/docs/guides/database/functions)、[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- Performance Advisor 对新索引的未使用提示发生在空表阶段，保留至 Owner Preview 后观察；未因提示删除 Owner/FK/查询路径索引。
- 全程未读取真实记录内容、未输出 Owner 标识、项目 ID、Secret 或数据库资源 ID。

## 8. Owner Preview 验收

- 受保护 Preview 以 Owner 会话完成合成 Todo 创建、状态流转与完成；另建一条明确标记的错误 Todo，经二次确认调用 `soft_delete_todo` 后同时从活动列表和甘特移除，既有完成 Todo 保留。
- 合成日记完成创建、软删除、恢复与最终软删除；远期寄语仅写入 2099 测试周，不覆盖当前周内容。
- 去敏数据库聚合复核确认：远期寄语 1、错误 Todo 软删除 1、活动错误 Todo 0、保留完成 Todo 1、目标删除审计 1。
- 增量改动的本地门禁为非集成 Vitest 71 文件 / 517 项、Miniflare 4 文件 / 26 项、Python 92 项、Candidate/Production build、治理与 Git 隐私/历史隐私全部通过。
- 增量提交后的 Node CI 连续两次只在同一 NodeNext 类型检查触发默认 5 秒超时；最近成功基线该测试已耗时 4.919 秒，新增 PGlite 文件并行后升至约 5.95 秒，其余 542 项通过。将 Vitest worker 从 3 降为 2、保持原超时后，本地 UTC 完整套件 75 文件 / 543 项通过，该类型检查约 1.0 秒；最新远端 privacy、Python、Node 三项均已通过。
- 临时寄语验收控件只存在于该 Preview 制品，未提交至 Draft PR；验收后本地工作树已恢复到正式提交并清理预览环境缓存。

## 9. Production 尝试与热修复验证

- 首轮 2.5.0 Production 远端构建 READY，首页 200、两个新闻端点无鉴权 401、严格 CSP 正常。
- 1440px 登录后实测记录页产生根页面横向溢出；尺寸诊断只采集元素类名和宽度，未输出真实内容。
- 回滚至上一健康 Production 后浏览器确认旧版工作台恢复；新闻 Cron 未触发、寄语自动化未创建。
- 热修复回归测试修复前失败、修复后通过；完整 Playwright 9/9、Vitest 75 文件 / 543 项、应用 Python 93 项、根工具 Python 369 项（1 项跳过）与 Production build 均通过，治理与当前/历史隐私检查通过。Draft PR #59 的远端 privacy、Python、Node CI 全绿。
- 独立合成 Preview READY；真实浏览器在 1440px 与 390px 下验证工作台、记录、进展、系统均无根页面横向溢出，console error 为 0。受保护请求首页 200、未知 API 404，严格 CSP 不含 unsafe-eval。

## 10. 阶段证据记录规则

### 新闻可靠性补充验收（2026-08-21）

- GDELT 失败/结果不足时切换新华网与 BBC 官方公开源、逐次 Cron 运行收据及 Owner 鉴权查询接口已按 TDD 完成；独立代码评审最终未发现 Critical 或 Important 阻断项。
- 精确内容服务测试为 6 文件 / 55 项；全量 Vitest 78 文件 / 582 项、应用 Python 93 项、根工具 Python 372 项（1 项跳过）、Production build 与 Playwright 9/9 均通过。治理、当前/历史隐私、差异和浏览器 bundle 泄漏检查通过。
- Draft PR #63 保持 Draft，privacy、Python、Node 三项远端 CI 全绿；尚未合并或发布 Production。
- 受保护纯静态合成 Preview 状态 READY：首页 200，两个新闻 API 均为 404，CSP 使用 `connect-src 'none'` 且不含 `unsafe-eval`；制品含 0 个 Functions、0 个 Cron，不含 Production Secret、Owner 连接或私人数据。
- 真实浏览器在 1440px 与 390px 下验证工作台、记录、进展、系统均有有效内容、无根页面横向溢出、无错误覆盖层。console 仅出现 Vercel Preview Protection 工具栏请求 `vercel.com/api/jwt` 的 403 及其 Google Provider/FedCM 提示，不是应用自身资源或业务请求失败。
- Owner 鉴权接口的 401/200、运行收据写入/索引异常降级和跨实例查询由受版本控制的 handler/store 合成测试验证；静态 Preview 刻意不部署 Functions。浏览器验收临时保护 Cookie 已删除。

正式站点横幅快速维护已验收：Production 模式不渲染“线上唯一真相源”状态组件及其两段内部治理文案；`Life Console · Online` 顶部品牌状态与系统页数据治理说明保留。组件测试在旧实现上失败、最小移除后通过；完整 Vitest 543/543、应用 Python 93 项、根工具 Python 369 项（1 项跳过）、Production build、Playwright 9/9、Preview 与 Production 1440px/390px、严格 CSP、main CI 与运行日志均通过。本次未改数据库 schema、RLS、Owner 数据或寄语自动化。

每次验收只记录去敏结论、合成 fixture、命令、计数和提交，不记录真实日记、健康值、Owner 标识、项目 ID、部署 ID、Secret 或自动化内部凭据。

### PR #72 Production 最终工程结论与搁置

- PO 明确确认合并、重新发布和 Owner 只读复验，并声明这是每日新闻的最后一次修复；失败后只留档，不再继续改代码。
- PR #72 合并前 GitHub 3/3 CI 全绿、无冲突；本轮补跑非回环 Vitest 571 项、Miniflare 26 项、应用 Python 93 项与 Production build，全部通过。
- 发布制品来自合并后的 `main`。Production READY；资源页确认三个新闻 Functions，Cron 为 Enabled、`0 23 * * *`。临时发布配置不含 env 或 Secret，使用后已删除。
- 已登录 Owner 页面无登录表单，新闻面板 `data-news-load-state=error`、0 条、1 个重试入口；console error/warning 为 0。同期 Vercel 没有 `/api/daily-news` 请求或该路由运行错误。
- 验收结论：工程发布通过，Owner 新闻展示失败，失败边界仍在 Function fetch 前。每日新闻前端展示标记为 shelved；完整时间线与恢复门禁见“每日新闻搁置与接力”。

### PR #72 认证单一真相源本地工程证据

- 线上只读边界保持为：Owner 完成退出重登后，页面仍未触发 `/api/daily-news`；服务端 Cron、缓存和响应契约此前已有成功证据，因此 PR #72 只修改浏览器认证读取与面板状态，不改数据库、Cron、DeepSeek、新闻正文或 Owner 数据。
- TDD 红灯精确覆盖三项缺口：第二次 Owner API 请求仍返回旧内存 token；认证失败无 `auth-unavailable` 闭集状态；普通失败无 `error` 闭集状态。红灯均在修改生产代码前观察到。
- 最小实现删除 `currentAccessToken`、`authRevision`、`tokenWaiters`、`hasAuthState` 与 `commitSession`。`session()` 与 `getAccessToken()` 每次读取 Supabase provider 当前 Session；认证事件只投影去敏用户字段。新闻面板只保存闭集状态，不保存异常对象或正文，显式重试可从认证不可用恢复为成功。
- 定向 4 文件 / 31 项、全量 Vitest 80 文件 / 597 项、应用 Python 93 项、根工具 Python 372 项（1 项跳过）、默认/Production/候选 Preview build 与 Playwright 9/9 通过；治理和 Git 隐私检查通过。根工具测试在沙箱内仅因 4 项 loopback bind `EPERM` 失败，沙箱外同一套 372 项通过。
- `validate_project.py` 在独立 worktree 会因刻意不检出私人真相源而失败，在私人根目录也存在本 PR 之前的绝对路径、私有职业资料和本地制品告警；本 PR 未修改这些范围。可提交边界继续由 `check_project_governance.py`、`check_git_privacy.sh`、差异与历史扫描负责。
- Draft PR #72 已创建并保持 Draft，privacy、Python、Node 三项远程 CI 全绿。合格纯静态 Preview 为 READY、0 Functions、0 Cron；首页 200、新闻 API 404，CSP 为 `connect-src 'none'` 且不含 `unsafe-eval`，远端资产与本地 Playwright 9/9 验证的候选构建一致。
- 首个源码 Preview 仍被 Vercel 自动发现并打包 5 个 API Functions，发现后未交付且已精确删除；随后改用本地 Build Output API。临时 OIDC 文件、项目链接和 Build Output 目录已清理。PO 合并发布确认及 Production Owner 只读复验仍是独立门禁。

## 11. 内容自动化收口证据

- DeepSeek Production Owner 合成健康探针返回 `HTTP 200 / provider_ok / no-store`；请求只含代码内置合成日记，不读写任何日记表，响应不含模型正文。
- GDELT 三分类公开探针稳定复现上游 429，并返回“每 5 秒最多一次”的节流要求；原实现同时开始三类请求，是本项目可修复的直接原因。回归测试在旧实现上得到三个相同起始时刻，修复后为 0/5/10 秒。
- 两个新闻重建 Function 的 60 秒上限符合 Vercel 当前配置范围；定向新闻/配置测试 3 文件 / 17 项通过。共享出口仍被上游限制时继续返回最近成功缓存或可重试空态，不返回半成品。
- Owner-scoped 每周寄语工具以失败测试起步，验证最小四次读取、P0/P1/active/deleted 过滤、周复盘只选 `structured_data`、当周 revision 和去敏写入收据；定向 Python 测试通过。
- 私有规范 Prompt、注册表 SHA-256 与运行实例 Prompt 完全一致；实例状态 ACTIVE，RRULE 为每周一 12:00 上海本地时间，调度库的下一次运行换算为周一 12:01:43 上海 / 04:01:43 UTC，在 300 秒允许抖动内。未记录自动化 ID、目标线程 ID 或 Owner 数据。
- PR #62 已 squash 合并，privacy、Python、Node 三项远端 CI 全绿。合并后的 Production 制品构建为 READY 并完成稳定正式别名切换；稳定域名与验收部署使用相同 JS/CSS 资产，首页 200，严格 CSP 保持 `script-src 'self'` 且不含 `unsafe-eval`。
- 每日新闻 Cron 在 Vercel 设置中为 Enabled，路径与 `23:00 UTC` 日计划匹配上海次日名义 07:00；当前 Hobby 调度允许在该小时内弹性触发。未带凭据请求返回 `401 / no-store`，函数请求落在预定区域。控制台 Run 首跑通过鉴权并进入函数，因 GDELT 共享出口限流返回 `503 / retryable empty`，没有半成品或伪造摘要。

## 12. PR #64 发布复验与 PR #65 开发证据

- PR #64 已按 PO 当次确认合并并发布。Production 为 READY，稳定别名、合并提交和 Cron 定义一致；首页 200，严格 CSP 不含 `unsafe-eval`，新闻、运行记录和 Cron 三个匿名请求均为 `401 / no-store`。
- 使用既有 Owner 会话只读调用正式新闻接口返回 `success`，日期为 2026-08-21，共 5 条，且响应为 `no-store`；未输出新闻正文、Owner 标识或任何个人记录。
- 真实 Owner 浏览器加载了 PR #64 新资产，但新闻区仍为空，且 Production 日志没有对应 `/api/daily-news` 请求。由此排除缓存缺失和旧资产，失败边界位于浏览器调用 `fetch` 之前的独立 Token 获取生命周期。
- PR #65 按 PO 确认进入 TDD：红灯分别证明同一个认证服务尚不能复用 Session、认证事件和显式登录产生的 Token，以及退出后必须清理 Token。最小实现将 Token 保留在 `LifeConsoleAuthService` 内存闭包，新闻客户端直接复用该服务，并删除第二套订阅/provider。
- 首轮独立审查发现迟到 `getSession()` 可能覆盖或复活更新认证事件的 Important 竞态；新增 `SIGNED_IN`、`TOKEN_REFRESHED`、`SIGNED_OUT` 三组红灯后，以 service revision 和 Token waiter 修复。另新增真实 `AuthGate → DailyNewsClient → /api/daily-news` 组合测试；复审无 Critical 或 Important 遗留。
- 定向 4 个测试文件 / 28 项、全量 Vitest 79 文件 / 589 项、应用 Python 93 项、根工具 Python 372 项（1 项跳过）、默认与 Supabase Production build、Playwright 9/9、治理及隐私门禁均通过。最终结论仍等待 PO 验收和新的 Production 当次确认；本节不把 Owner 页面新闻展示标记为完成。
- Draft PR #65 已创建并保持 Draft。最终合成 Preview 由本地 candidate-preview 静态制品通过 Vercel Build Output 部署：状态 READY，0 Functions、0 Cron，首页 200，`/api/daily-news` 404，严格 CSP 为 `connect-src 'none'` 且不含 `unsafe-eval`。
- 首次从源码根部署时，Vercel 自动识别 `api/` 并打包 5 个 Functions；该制品不符合 Preview 边界，未交付且已精确删除。最终合格制品不含 Owner 连接、Functions、Cron 或 Production Secret；本地 OIDC、项目配置和临时目录已清理。
- PO 确认合成 Preview 必须可见展示每日新闻上线效果，并授权 Agent 代替用户手工 Preview 验收。TDD 红灯在旧实现上只看到未连接空态；最小实现后候选工作台显示 6 条明确标注的合成新闻，覆盖三类与国内/国际，不连接 API 或 Owner 数据。
- 首次实现虽只在候选模式渲染，但静态 import 仍把合成字符串带入 Production bundle；以真实 Vite `supabase-production` 构建红灯复现后，改为候选分支动态加载，并将 Production 制品不含两个合成标记纳入回归测试。
- 本地 Chrome 在 1440px/390px 下均渲染 6 条，空态不存在、根页面无横向溢出、console error 为 0。单 worker 全量 Vitest 80 文件 / 591 项、应用 Python 93 项、Candidate/Production build 与 Playwright 9/9 通过；并行首轮的 3 个无断言资源超时在不放宽超时后以单 worker 全量通过收口。Production 发布后仍必须验证真实 Owner 请求与页面渲染，合成验收不替代该结论。

## 13. 2026-08-26 记录与进展快速维护

- Production 只读复现确认：主观信号前一窗口始终为 0，睡眠时刻表有已保存记录但睡眠趋势为 0，活动最近窗口无可渲染记录；诊断只记录结构与计数，不把真实日记或健康值写入 Git。
- 主观信号根因是 Dashboard 只把 `daily_checkins` 投影到当前自然周，随后 14 天趋势组件只能得到 7 天输入。修复后趋势固定返回截至当天的连续 14 天；工作台当前自然周样本计数仍按 7 天计算，不改变既有口径。
- 睡眠时长根因是趋势只读取 `health_days.summary`，没有复用同页睡眠时刻表的 `daily_checkins.sleep_time/wake_time`。修复后优先使用明确的健康摘要时长，缺失时再按保存时刻确定性计算；跨午夜按次日处理，异常格式与超过 18 小时继续保留未知。
- 活动卡片直接读取 `health_days`；当前链路没有最近窗口数据，且本机最小健康摘要源同期也没有新归档。此项不是图表漏画，不从睡眠、主观状态或旧日期推断活动值；若要恢复连续活动趋势，需另行确认 Apple Health 采集和 Owner-scoped 云端写入范围。
- 日记 raw-first 保存按设计成功，但 Production 客户端没有注入自动 normalization provider。真实日记经 Vercel Function 发送 DeepSeek 的长期外发授权此前未成立；本轮不静默开启，也未用管理权限绕过 Owner 会话回写当前日记。
- TDD 红灯在生产代码修改前覆盖了 7 天输入、前一窗口丢失、睡眠查询拒绝 14 天、睡眠时刻未派生四项；最小修复后定向 3 文件 / 24 项、应用 Python 93 项、根工具 Python 372 项（1 项跳过）与 Production build 通过。沙箱外全量 Vitest 为 80 文件中 79 通过、1 失败，合计 598 项通过、1 项失败；唯一失败是修改前已复现的 Todo `DDL` 与计划开始日期约束，本次未触碰该范围。治理与当前 Git 隐私检查通过；隔离 worktree 的便携性验证仍因刻意不检出的私人真相源和既存告警失败，不复制私人文件伪造通过。
- 当前只完成本地修复与证据记录；Draft PR、合成 Preview、PO 验收、Production 合并发布和发布后 Owner 只读复验仍是独立门禁。
