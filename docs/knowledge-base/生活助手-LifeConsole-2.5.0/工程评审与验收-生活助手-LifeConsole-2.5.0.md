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

正式站点横幅快速维护验收项：Production 模式不渲染“线上唯一真相源”状态组件及其两段内部治理文案；`Life Console · Online` 顶部品牌状态与系统页数据治理说明保留。组件测试必须先在旧实现上失败、最小移除后通过；完整 Vitest、Python、build、Playwright、Preview 1440px/390px、严格 CSP 与 console 仍为发布门禁。本次不改数据库 schema、RLS、Owner 数据或寄语自动化。

每次验收只记录去敏结论、合成 fixture、命令、计数和提交，不记录真实日记、健康值、Owner 标识、项目 ID、部署 ID、Secret 或自动化内部凭据。
