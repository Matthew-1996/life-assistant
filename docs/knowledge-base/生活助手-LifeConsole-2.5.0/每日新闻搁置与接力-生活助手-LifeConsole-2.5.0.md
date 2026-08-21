# 每日新闻搁置与接力：Life Console 2.5.0

## 1. 当前结论

- 2026-08-22，PO 明确将 PR #72 设为每日新闻展示的最后一次修复。PR #72 已 squash merge，发布制品来自合并后的 `main`，Production 为 READY，稳定正式域名已切换。
- Vercel 控制面确认新闻三个 Functions 均存在于预定区域；每日 Cron 为 Enabled，路径 `/api/cron/daily-news`，计划 `0 23 * * *`。
- 已登录 Owner 正式页面刷新后，新闻面板闭集状态为 `error`、条目数为 0、存在重试按钮；页面没有登录表单，浏览器 console 的 error/warning 数为 0。
- 同期 Vercel 最近 15 分钟没有 `/api/daily-news` 请求，也没有该路由的运行错误。失败仍发生在浏览器发出新闻 Function 请求之前。
- 因最终只读复验失败，每日新闻前端展示自本记录起标记为 **shelved / 搁置**。不再创建热修复、不再触发模型或缓存写入；2.5.0 其余已上线能力不受影响。

## 2. 最后一次发布证据

- 合并前实时 GitHub 状态：3/3 CI 通过、无冲突、可自动合并。
- 本轮补充门禁：非回环 Vitest 571 项通过；沙箱外 Miniflare 4 文件 / 26 项通过；应用 Python 93 项通过；Supabase Production build 通过。
- 本地 `main` 与 `origin/main` 为 0/0，且与 PR #72 分支代码树一致。
- 发布前精确核对 Vercel 项目名、团队和本地链接；临时生成配置包含 3 个新闻 Functions、1 个 Cron、正确路径和计划，不含 env、Secret 或合成占位值。发布后临时配置已删除。
- Production 资源页确认 `/api/daily-news`、`/api/daily-news-runs`、`/api/cron/daily-news` 均为 Node.js Functions；本记录不保存部署 ID、项目 ID、Owner 标识或凭据。

## 3. 历史定位时间线

| PR | 已验证结论 | 未关闭问题 |
|---|---|---|
| #63 | GDELT 失败后官方公开备用源、运行收据、Runtime Cache 与五条摘要服务端链路成功 | Owner 浏览器没有发出新闻请求 |
| #64 | 增加认证启动事件优先与 Session 回退 | 真实浏览器仍停在 fetch 前 |
| #65 | AuthGate 与新闻客户端统一认证服务；修复迟到 Session 覆盖认证事件竞态 | Production 仍无新闻请求 |
| #66–#67 | 忽略陈旧认证事件并补充 transient Session 恢复 | 真实 Owner 链路未关闭 |
| #68 | Production Cron 正式注册并启用 | Cron 正常不等于前端展示正常 |
| #69 | DeepSeek 合成探针、去敏 Cron 诊断、缓存与运行收据成功 | 浏览器仍未调用 Owner API |
| #70–#71 | 缺失 token 回读、同 Owner tokenless 事件保留 | 多轮内存 token 状态机仍未关闭真实时序 |
| #72 | 删除应用级 token cache；请求时读取 Supabase provider 当前 Session；增加闭集加载状态 | 最终 Production 显示 `error`，且函数侧请求计数仍为 0 |

## 4. 已排除或已有正向证据

- 不是“Production 未发布旧代码”：发布源和正式域名均指向 PR #72 合并后的 `main`。
- 不是“新闻 Functions 或 Cron 未注册”：资源页和 Cron 控制面均已确认存在且启用。
- 不是页面无限 loading：PR #72 已把失败收敛为 `error`，用户可见且可重试。
- 未观察到 CSP、脚本崩溃或 console error/warning。
- 服务端候选发现、DeepSeek 合成调用、Runtime Cache、运行收据和正式客户端 Schema 解析均有此前成功证据；最终复验没有到达服务器，不能用本次结果推翻这些证据。
- 没有 Supabase schema、RLS、Owner 数据、新闻正文、Cron Secret 或模型配置变更。

## 5. 尚未证明的根因假设

1. `auth.getSession()` 在真实恢复会话中抛错，而 AuthGate 仍保留已渲染的去敏 Session；异常被新闻面板收敛为通用 `error`，因此没有发出 Function 请求。
2. Supabase SDK 的持久化 Session、自动刷新锁或浏览器存储恢复，在真实标签页生命周期中与测试替身不同。
3. 浏览器认证状态与新闻请求所需 access token 仍缺少可观测的单一原子边界；现有闭集只区分“无 token”和“其他异常”，不足以区分 provider 读取、刷新、网络或解析阶段。
4. 若未来继续，可能需要把 Owner 新闻鉴权改为独立、可验证的服务端会话边界，而不是继续叠加客户端 token 状态机；这属于新架构评审，不是 2.5.0 热修复。

以上均为待证假设，不得作为已确认根因传播。

## 6. 未来恢复门禁

- 只有 PO 新的当次明确确认才恢复每日新闻开发；恢复前先新建独立 PR/Preview，不直接修改 Production。
- 第一项红灯必须来自真实浏览器可复现链路，并只记录闭集阶段码：`provider_session_read`、`provider_refresh`、`token_missing`、`function_fetch`、`response_parse`。不得记录 JWT、邮箱、Owner ID、URL query、新闻正文或供应商响应体。
- 必须证明浏览器确实发出 `/api/daily-news`，再判断服务端 401/5xx/缓存；请求计数仍为 0 时不得继续修改 GDELT、DeepSeek、Cron 或 Runtime Cache。
- 未来方案需覆盖真实 Supabase SDK 的双连接/刷新/退出/跨用户测试，不能仅用同步替身证明时序。
- Preview 通过后仍需独立 PO Production 门禁；成功定义保持为 Owner 页面展示有效摘要、CSP/console 正常、无 Secret/私人数据泄漏。

## 7. 隐私与回滚

- 本接力记录仅保存闭集状态、测试计数、PR 编号和去敏控制面结论。
- 不保存新闻标题、摘要、Owner 标识、Supabase/Vercel 资源 ID、部署 ID、JWT、Secret、Keychain 内容或真实个人记录。
- 当前不回滚 2.5.0 主版本，不删除数据库对象或缓存；新闻面板保持失败关闭和重试入口。若未来内容服务出现安全问题，再按既有上线方案停用 Cron 或恢复上一 Production。
