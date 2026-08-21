# 项目管理：Life Console 2.5.0

## 1. 当前状态

- 主阶段：2.5.0 已上线；PR #71 已合并并重新发布，Production READY，但 Owner 完成退出和重新登录后仍未发出 `/api/daily-news` 请求。后端 Cron、当日 Runtime Cache 与运行收据继续为成功，故新闻上线验收仍未完成。
- 子状态：连续 token 状态机热修复没有关闭真实链路。PO 已确认进入 PR #72 架构修复：删除应用级 token cache，以 Supabase provider 当前 Session 作为唯一认证真相源，并为新闻面板增加去敏闭集加载状态。
- 分支：`agent/life-console-news-auth-single-source` 独立 worktree；基线全量 Vitest 606/606、Python 93/93 已通过。
- PR：PR #72 本地 TDD 与完整门禁已完成，正在提交 Draft PR 与纯合成 Preview；远程 CI/Preview 完成后，仍需 PO 新的当次确认才能合并和重新发布 Production。
- 数据库：两个加法 migration 保持已应用，不回滚或删除用户数据；本次不改 Supabase schema 或 Owner 数据。

## 2. 阶段计划

每个连续工作块不超过 4 小时：

1. 基线收口：#56 合并、Production CSP 复验、热修复分支/worktree 清理。已完成。
2. 立项：2.5.0 worktree、完整文档、Draft PR。已完成。
3. Gate 2：Visual Companion 桌面/移动视觉、设计与技术评审。已完成。
4. 数据能力：migration 文件、RLS、RPC、Repository、backup v3。已完成实现、Production schema 应用与只读后验验证。
5. 页面与算法：工作台、记录、进展、样式拆分。已完成本地实现与测试。
6. 内容服务：寄语展示、新闻 API、Runtime Cache、降级。已完成本地实现与测试。
7. 测试与 Preview：记录页反馈与更新后的纯静态合成 Preview 已完成；锁文件可移植性和 Runner UTC 时区确定性补丁均已由 GitHub Actions 复验，privacy、Python、Node 三项全绿。
8. 上线：原 2.5.0 migration、Owner Preview、自动化、PR 合并、Production 发布与首跑验收均已完成。
9. 新闻可靠性快速维护：正式设计补充、TDD、独立代码评审、全量门禁、PR #63、Production 与手动生成今日新闻均已完成；服务端结果和运行收据成功。
10. 新闻展示启动竞态热修复：PR #64 已合并发布；后端和控制面复验通过，但真实 Owner 浏览器仍为空态，第一版修复未覆盖实际认证时序。
11. 认证生命周期统一：PO 已确认进入 PR #65 开发；TDD、全量门禁、独立复审与 Draft PR 已完成。PO 确认合成 Preview 应展示新闻上线效果，并授权 Agent 代替手工验收；Production 发布仍保持独立门禁。
12. Cron 注册与 Production 诊断：PR #68 已合并发布并关闭“Cron 未注册”；Owner 页面仍为空后，按 TDD 增加闭集去敏完成日志，准备以已验证 Key 轮换、手动触发和 Owner 页面五条摘要作为最终验收。
13. Production 诊断与 Owner token 恢复：PR #69 已合并发布，Key 轮换与手动 Cron 证明后端当日缓存成功；TDD 修复“已认证 Session 缺少内存 access token 时不再回读”的客户端恢复缺口，等待独立 PR 与发布门禁。
14. Owner 有效 token 保留：PR #70 已合并发布但页面仍无 API 请求；TDD 修复同一 Owner tokenless 事件清空既有有效 token，退出和用户切换继续失败关闭。
15. 认证单一真相源架构修复：PR #71 发布和 Owner 重新登录仍未触发新闻 API；PO 已确认进入 PR #72，按 provider Session 真相源、请求时取 token、闭集加载状态和全量门禁执行。

## 3. 门禁与恢复条件

| 门禁 | 当前状态 | 恢复条件 |
|---|---|---|
| 正式视觉/设计/技术 | approved | PO 于 2026-08-20 明确确认 Gate 2 v2 通过 |
| Supabase migration | completed | PO 于 2026-08-20 当次确认；Production URL 绑定、迁移历史、RLS、权限、RPC、Advisor 与事务锁均已验证 |
| Owner Preview 写入 | completed | PO 已授权；Todo、日记与远期寄语仅用合成标记记录完成验收 |
| 寄语自动化创建 | completed | PO 于 2026-08-20 明确要求创建；规范 Prompt/私有注册表/运行实例一致，ACTIVE，下一次运行落在周一 12:00 上海时间允许抖动内 |
| 2.5.0 PR #58 合并 | completed | PO 已确认并 squash merge 到 main |
| 新闻可靠性设计补充 | approved | PO 于 2026-08-21 确认官方备用源与 Runtime Cache 7 天运维记录方向；不新增 Supabase 表或密钥 |
| 新闻可靠性 Preview/验收 | completed | PO 于 2026-08-21 当次确认验收 PR #63 |
| 新闻可靠性 Production | completed | PR #63 已合并，Production READY；Cron 已手动触发并成功生成 2026-08-21 摘要及运行收据 |
| Owner 新闻展示 PR #64 | completed_with_followup | PO 已确认合并和发布；Production 后端今日摘要成功，但浏览器没有发起新闻请求，需 PR #65 收口 |
| Owner 认证生命周期 PR #65 | agent_acceptance_in_progress | PO 已授权 Agent 代替用户手工验收；必须完成合成新闻 Preview、远程 CI 和去敏浏览器验收。Production 合并发布仍需当次确认 |
| Cron 注册 PR #68 | completed | PR 已合并；Production 重新发布后控制面存在且启用 `/api/cron/daily-news`，手动调用进入函数；该结果不替代摘要成功和 Owner 页面可见性 |
| Production 新闻诊断热修复 PR #69 | completed | PO 已确认 Key 轮换、合并、重新发布与手动触发；去敏日志为 success/cache，收据可用，未输出新闻正文或凭据 |
| Owner 新闻 token 恢复热修复 PR #70 | completed_with_followup | PR 已合并发布且 Production READY；真实浏览器仍无 API 请求，继续由同 Owner token 保留热修复收口 |
| Owner 有效 token 保留热修复 | implementation_in_progress | 同一 Owner tokenless 事件、跨用户与退出测试及完整门禁通过后进入 Draft PR；Production 合并发布需新的当次确认 |
| Owner 认证单一真相源 PR #72 | draft_pr_in_progress | provider 当前 Session、无隐藏 token cache、去敏闭集状态与本地全量门禁已通过；Draft PR、远程 CI 与合成 Preview通过后再申请 Production 当次确认 |

## 4. 开放风险

- 新闻源可用性和 GDELT 结果质量不稳定：GDELT 保持主源，新华网/BBC 官方公开源按需降级，最终仍执行白名单、24 小时、动态配比和最近成功缓存降级。
- 新华网当前频道 HTML 结构可能变化，BBC RSS 也可能单入口异常：解析器固定入口、体积/超时、严格字段和失败隔离；任何不足不得放宽可信域名或伪造时间。
- Runtime Cache 运行记录可跨部署但属于可逐出的 7 天运维状态；若未来要求永久审计，再单独评审 Supabase 表与服务器凭据，不在本次静默扩展。
- Runtime Cache 区域一致性：两个端点固定同区并测试缓存命中。
- Owner 登录恢复与页面数据请求时序：PR #64 的第二套 token provider 在真实启动中与 AuthGate 生命周期分叉。PR #65 改为由同一个认证服务在 Session、认证事件和显式登录时更新内存 Token；正式发布前仍需 Preview，发布后必须看到 Owner 浏览器实际请求和新闻渲染。
- 多次热修复仍存在双状态：应用自建 token cache 与 Supabase provider Session 可在真实恢复时序中分叉。PR #72 直接移除 cache/revision/waiter，所有 Owner API 在请求时读取 provider 当前 Session，并用闭集状态暴露 fetch 前失败。
- Production 内容链路可观测性：HTTP 空态会吞掉真实失败阶段。快速维护只允许记录闭集状态、来源、失败阶段、稳定错误码、摘要日期和收据可用性；未知字符串统一降级，不记录标题、摘要、URL、JWT、Secret 或供应商响应体。
- 已认证事件缺少 access token：AuthGate 可凭用户字段渲染 Owner UI，但旧 `getAccessToken()` 因 `hasAuthState` 直接返回 null。恢复只允许在 `currentSession` 非空且 token 缺失时重读存储 Session；明确退出仍保持 null，不得复活旧会话。
- Unsplash Key 可能不存在：Preview 使用合成元数据，Production 使用渐变。
- 当前 bundle 大于 500 kB：样式/组件拆分时观察，不为追求指标引入无关架构。
- iCloud worktree 偶发 interrupted syscall：每次创建后验证对象、HEAD 和工作树完整性。
- GitHub Actions 上游 actions 仍报告 Node 20 弃用警告，但当前被 Runner 强制使用 Node 24 且三项门禁通过；该警告不阻塞 2.5.0，后续跟随上游 action 主版本维护。
- Supabase Security Advisor 会按规则提示 6 个 authenticated 可调用的 `SECURITY DEFINER` RPC；这是已确认的受控写入设计。六个函数均固定空 `search_path`、先校验 `auth.uid()`、仅处理 Owner 行，并已撤销 public/anon execute；后续若改变调用模型必须重新评审。
- 新表尚无真实使用统计，Performance Advisor 的新索引未使用提示属于预期；Owner Preview 后继续观察，不因空表提示删除必要索引。

## 5. 决策日志

| 日期 | 决定 | 状态 |
|---|---|---|
| 2026-08-19 | 2.5.0 一个版本分阶段完成 | PO 已确认 |
| 2026-08-19 | Todo DDL 不自动延后，逾期派生 | PO 已确认 |
| 2026-08-19 | 日记只软删除并可恢复 | PO 已确认 |
| 2026-08-19 | 寄语每周更新，读取最小 Owner 上下文 | PO 已确认 |
| 2026-08-19 | 新闻使用 GDELT + 白名单 + DeepSeek 公开摘要 + Runtime Cache | PO 已确认 |
| 2026-08-19 | #56 Ready、合并与基线清理 | PO 已确认并完成 |
| 2026-08-20 | 固定 1440px 评审画板按可用宽度缩放；实际双栏在不足 1180px 时转单栏 | PO 反馈，draft.2 已修订 |
| 2026-08-20 | 今日锚点复用 2.4.0 四项、四状态、进展与修改链路 | PO 反馈，draft.2 已修订 |
| 2026-08-20 | Gate 2 v2 正式视觉、设计与技术方案 | PO 已确认，进入 TDD 开发 |
| 2026-08-20 | Tasks 1–8 本地实现、390/1440 响应式与全量合成门禁 | 已通过 |
| 2026-08-20 | 独立纯静态合成 Preview、严格 CSP、未知 API 404 与 390/1440 四页验收 | 已通过；未触达 Owner 数据或 Production |
| 2026-08-20 | Draft PR 远端 privacy/Python 通过，Node 安装被锁文件内网镜像地址阻断 | 待规范化锁文件并重跑 |
| 2026-08-20 | 记录页移除语义卡，对话记录下恢复日记标题/原文及编辑、软删除、恢复 | PO 已确认设计并进入开发 |
| 2026-08-20 | 更新纯静态合成 Preview，并将 `/api/*` 404 置于 SPA fallback 前 | 已通过；0 Functions、0 Cron，未触达 Owner 数据或 Production |
| 2026-08-20 | PO 确认继续开发 | 用于收口 CI 并准备下一阶段；不替代 Supabase migration 或 Owner Preview 写入的独立确认 |
| 2026-08-20 | 将 25 个私有镜像 tarball 地址规范化到公共 npm Registry，并增加真实锁文件可移植性测试 | GitHub Runner `npm ci` 已通过；安装根因已关闭 |
| 2026-08-20 | GitHub Runner UTC 下三个 Todo 测试暴露隐式本机时区依赖 | 已用 `TZ=UTC` 本地精确复现；Vitest 固定 `Asia/Shanghai` 后本地全量与 GitHub Actions 均通过 |
| 2026-08-20 | Draft PR #58 privacy、Python、Node 三项远端 CI | 全绿；保持 Draft，未执行 migration、Owner 写入或 Production |
| 2026-08-20 | 上线前 Supabase 账号/项目只读绑定核对 | 当前连接无匹配项目，migration 失败关闭；未恢复项目、未执行 SQL、未读取真实记录 |
| 2026-08-20 | Supabase 插件重新连接并复核 Production URL | 已匹配唯一健康东京项目；Vercel 敏感 Key 保持遮罩，不输出项目 ID 或凭据 |
| 2026-08-20 | PO 当次确认执行 Supabase migration | 已确认并执行；不替代 Owner Preview、自动化、PR 合并或 Production 门禁 |
| 2026-08-20 | 应用前独立审查发现寄语同-key并发 revision 竞态 | TDD 增加 Owner+幂等键事务锁，完整 2.4→2.5 migration 测试与双会话只读锁验证通过 |
| 2026-08-20 | 2.5.0 Production Supabase migration | 已应用一次；3 表、3 Owner 策略、6 写 RPC、backup v3 导出和权限矩阵后验通过，未写 Owner 记录 |
| 2026-08-20 | 全量测试资源竞争 | 保留原 5/10 秒超时，Vitest worker 固定为 3；全量 74 文件 / 540 项和 Python 93 项通过 |
| 2026-08-20 | Todo 误建删除与顶部环境提示移除 | PO 已确认设计；Todo 使用 revision-safe 软删除和二次确认，不提供永久删除或恢复界面；顶部候选环境提示已移除 |
| 2026-08-20 | Todo 软删除增量 migration 与 Owner Preview | migration 已应用；受保护 Preview 中合成错误 Todo 删除、既有完成 Todo 保留、日记删除/恢复和远期寄语写入均通过；未触碰真实记录 |
| 2026-08-20 | 增量 PGlite 测试后 NodeNext 类型检查连续两次超过默认 5 秒 | 根因是 3 worker 下 Runner 资源竞争；不放宽测试超时，将 Vitest worker 降为 2，本地 UTC 全量 75 文件 / 543 项通过，远端 privacy、Python、Node 三项复验全绿 |
| 2026-08-20 | PR #58 合并与首次 Production 发布 | PO 分别确认；Production READY 后 1440px 登录实测发现记录页横向溢出，立即回滚至上一健康版本 |
| 2026-08-20 | 记录页 Production 溢出根因 | 原始复盘回退分支缺少不可断行文本换行规则；TDD 红灯复现并以最小 CSS 修复，未读取或输出真实复盘内容 |
| 2026-08-20 | 热修复 Draft PR #59 与合成 Preview | Preview READY；1440px/390px 四页无根页面横向溢出、console error 0、首页 200、未知 API 404、严格 CSP 与远端 privacy、Python、Node CI 通过 |
| 2026-08-20 | PR #59 合并与 2.5.0 Production 重新发布 | PO 已确认并完成；正式别名指向新部署，四页桌面/移动、Todo 删除、日记编辑/删除/恢复、严格 CSP 与 console 已复验 |
| 2026-08-20 | 正式站点移除“Supabase 唯一真相源 / iCloud 单向备份”横幅 | PO 明确反馈；与 PRD 既有减法一致，按快速维护通道 TDD 实施；PO 同次确认轮换 `CRON_SECRET`、重新部署并触发新闻 Cron |
| 2026-08-20 | 横幅快速维护 Draft PR #60 与合成 Preview | Preview READY；1440px/390px 均无目标组件或文案、无根页面横向溢出，首页 200、未知 API 404，严格 CSP 通过；未连接 Owner 数据或修改 Production |
| 2026-08-20 | PR #60 合并、Production 重新发布与新闻 Cron | PR 与 main CI 全绿；正式站点四页桌面/移动复验通过，目标横幅为 0；Secret 首次交互输入发生回显后立即以第二个未回显随机值覆盖，最终值保持 Sensitive 且未留存；Cron 两次鉴权触发均因 GDELT 8 秒超时返回可重试空态，UI 降级正常 |
| 2026-08-20 | DeepSeek Production 纯合成复验 | Owner 健康探针返回 `HTTP 200 / provider_ok / no-store`；只发送内置合成文本，未读取或写入真实日记 |
| 2026-08-20 | GDELT 503 根因与兼容修复 | 公开探针证实 DOC API 要求每 5 秒最多一次请求；原三分类并发会共同触发 429。TDD 改为至少间隔 5 秒的顺序请求，并将两个重建 Function 上限调整为 60 秒 |
| 2026-08-20 | Life Console 每周寄语自动化 | PO 明确要求创建；Owner 最小投影与 revision-safe 写入工具完成 TDD，私有规范 Prompt/注册表/运行实例一致，下一次运行已核对上海与 UTC 时间 |
| 2026-08-21 | GDELT 失败备用源与 Cron 运行记录 | PO 确认采用新华网/BBC 官方公开源，并用同区域 Runtime Cache 保存最近 7 天去敏运维记录；不新增 Supabase schema/Secret |
| 2026-08-21 | PR #63 合并、Production 发布与今日新闻手动 Cron | PO 当次确认并完成；合并后 main CI 全绿，Cron Enabled 且手动运行 HTTP 200，当日运行收据成功并生成 5 条满足分类/地域最低配比的摘要 |
| 2026-08-21 | Owner 页面新闻未展示根因 | 服务端与正式客户端解析均成功，但浏览器登录恢复后没有发出 `/api/daily-news` 请求；定位为 `getSession()` 启动竞态，按 TDD 改为先订阅认证事件提供内存 token，等待新 Draft PR 和独立发布门禁 |
| 2026-08-21 | Draft PR #64 与认证热修复 Preview | 独立评审无 Critical/Important；纯合成 Preview READY，1440px/390px 四页无横向溢出、严格 CSP、runtime error 0，新闻 API 为 404；未连接 Owner 数据、Functions、Cron 或 Production Secret |
| 2026-08-21 | PR #64 合并、Production 发布与只读复验 | PO 当次确认并完成；发布、Cron、鉴权和 Owner API 当日 5 条摘要通过，但已登录浏览器未发出新闻请求，UI 仍为空态，未宣称新闻展示完成 |
| 2026-08-21 | PR #65 认证生命周期统一 | PO 已确认进入开发；删除独立 token provider，由 AuthGate 使用的认证服务持有内存 Token，TDD 覆盖 Session、认证事件、显式登录与退出清理；不改数据库、Cron 或新闻生成 |
| 2026-08-21 | PR #65 首轮独立代码审查 | 发现迟到 Session 可能覆盖或复活更新认证事件的 Important 竞态；以三组红灯、service revision、Token waiter 和真实 AuthGate→新闻请求组合测试修复，全量门禁通过 |
| 2026-08-21 | PR #65 代码复审 | 无 Critical 或 Important 遗留；唯一 Minor 为刷新事件后补充迟到 Session 不覆盖缓存 Token 的直接断言，已补充并定向复验 |
| 2026-08-21 | Draft PR #65 与合成 Preview | Draft PR 已创建；合格 Preview 为 READY、0 Functions、0 Cron、首页 200、新闻 API 404、严格 CSP。首个误带 5 个 Functions 的 Preview 未交付并已删除，本地 OIDC/配置已清理 |
| 2026-08-21 | PR #65 合成新闻可见验收 | PO 确认 Preview 需展示上线效果；仅在 `candidate-preview` 动态注入 6 条公开合成摘要，覆盖三类与国内/国际。Production bundle 黑盒回归确认不含两项候选标记。PO 同意 Agent 全量验收代替手工 Preview 验收；合成数据不得替代上线后 Owner 真实链路验证 |
| 2026-08-21 | PR #68 与 Production Cron 注册 | PO 选择方案 A；PR 合并后从项目根动态配置重新发布，Cron 已注册、Enabled 且手动进入 Production，匿名 401 与严格 CSP 保持；Owner 页面仍为空，因此不宣称每日新闻完成 |
| 2026-08-21 | Production 新闻空态分层诊断 | Keychain DeepSeek 纯合成连通测试 200；正确 TLS 条件下备用源 47 条、五条配比与五条摘要通过，GDELT 超时按设计降级。新增闭集去敏 Cron 完成日志，不改 Owner 数据或新闻正文 |
| 2026-08-22 | PR #72 认证单一真相源架构 | PR #71 发布及 Owner 退出重登后浏览器仍无新闻 API 请求；PO 确认删除内存 token 状态机，以 Supabase provider 当前 Session 为唯一真相源，并增加去敏闭集新闻加载状态；不改数据库、Cron 或新闻生成 |
| 2026-08-22 | PR #72 本地 TDD 与门禁 | 旧实现 3 个预期红灯后完成最小重构；定向 31 项、Vitest 597 项、应用 Python 93 项、根工具 Python 372 项（1 项跳过）、默认/Production/Preview build、Playwright 9/9、治理与 Git 隐私通过；全仓便携性脚本仍有既存私人文件/制品告警，不由本 PR 修改 |
| 2026-08-19 | 视觉、设计、技术确认前不写生产功能 | Gate 2 v2 后已满足 |
