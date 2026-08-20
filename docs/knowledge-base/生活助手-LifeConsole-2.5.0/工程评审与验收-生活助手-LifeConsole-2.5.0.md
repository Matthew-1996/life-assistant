# 工程评审与验收：Life Console 2.5.0

## 1. 当前状态

- 主阶段：PO 记录页反馈、全量门禁与更新后的受保护合成 Preview 均已通过；Draft PR #58 的公共依赖安装已由 GitHub Runner 验证，Runner UTC 导致的三个 Todo 测试环境差异已在本地修复并复验。Owner Preview 写入仍等待独立确认。
- 生产功能：Supabase 日记契约未变；纯合成 Preview 新增内存日记演示。远程 migration、Owner Preview、自动化与 Production 均未执行。
- 基线：PR #56 已 squash merge；本地 `main` 与 `origin/main` 一致。
- Production 只读复验：HTTP 200、严格 `script-src 'self'`、页面有内容、无错误覆盖层、无 page error/`unsafe-eval`。`/favicon.ico` 404 为非阻断项，纳入 2.5.0。

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
| 工作台 | Todo 全链路、甘特、新闻、寄语、今日锚点、移除旧区块 |
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
| Vitest | 74 文件 / 539 项通过；新增锁文件 tarball host 防回归测试 |
| Python | 75 + 7 + 10 + 1 = 93 项通过 |
| Supabase Production build | 通过；严格 CSP 不含 `unsafe-eval` |
| Playwright | 8/8 通过；真实 Chrome 无错误覆盖层、console error 或 page error |
| npm audit | 0 info / low / moderate / high / critical |
| UTC Runner 等价复验 | 外层 `TZ=UTC` 下定向 Todo 13/13、全量 Vitest 74/539、Python 93 和默认 build 通过；Vitest 内明确使用 `Asia/Shanghai` |
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

远端 CI 中 privacy 与 Python 已通过；原 Node 安装失败在锁文件修复推送后已越过，证明 25 个公共包 tarball 地址规范化有效。Node 随后在三个 Todo 用例失败：Runner 默认 UTC 将“今日”和 `datetime-local` fixture 按 UTC 解释，而产品与测试期望为上海自然日。本地以 `TZ=UTC` 精确复现相同三项失败后，仅在 Vitest 配置固定 `Asia/Shanghai`；同一 UTC 外层环境下定向 13/13、完整 Vitest 74/539、Python 93 和默认 build 均通过。远端 CI 仍须在该补丁推送后重跑通过才可记为全绿。

## 7. 阶段证据记录规则

每次验收只记录去敏结论、合成 fixture、命令、计数和提交，不记录真实日记、健康值、Owner 标识、项目 ID、部署 ID、Secret 或自动化内部凭据。
