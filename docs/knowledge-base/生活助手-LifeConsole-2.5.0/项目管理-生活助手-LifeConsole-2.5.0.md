# 项目管理：Life Console 2.5.0

## 1. 当前状态

- 主阶段：PO 记录页反馈、本地/合成 Preview 与受保护 Owner Preview 合成写入均已通过；Draft PR #58 的 privacy、Python、Node 三项 CI 已全绿。Supabase 2.5.0 主 migration 与 Todo 软删除增量 migration 已分别按确认应用并完成去敏后验验证。
- 子状态：语义卡与顶部环境提示已移除；对话记录下已恢复日记标题、原文、编辑、软删除与恢复；Todo 新增二次确认软删除；并发寄语更新增加 Owner+幂等键事务锁。
- 分支：`agent/life-console-250`，独立 worktree。
- PR：[Draft PR #58](https://github.com/Matthew-1996/life-assistant/pull/58)，保持 Draft 至全量验收与合并门禁。
- 数据库：2.5.0 两个加法 migration 已应用；只写入明确合成标记的 Owner 验收记录。自动化、PR 合并与 Vercel Production 均未变更。

## 2. 阶段计划

每个连续工作块不超过 4 小时：

1. 基线收口：#56 合并、Production CSP 复验、热修复分支/worktree 清理。已完成。
2. 立项：2.5.0 worktree、完整文档、Draft PR。已完成。
3. Gate 2：Visual Companion 桌面/移动视觉、设计与技术评审。已完成。
4. 数据能力：migration 文件、RLS、RPC、Repository、backup v3。已完成实现、Production schema 应用与只读后验验证。
5. 页面与算法：工作台、记录、进展、样式拆分。已完成本地实现与测试。
6. 内容服务：寄语展示、新闻 API、Runtime Cache、降级。已完成本地实现与测试。
7. 测试与 Preview：记录页反馈与更新后的纯静态合成 Preview 已完成；锁文件可移植性和 Runner UTC 时区确定性补丁均已由 GitHub Actions 复验，privacy、Python、Node 三项全绿。
8. 上线：migration 与 Owner Preview 已按独立确认完成；自动化、PR 合并和 Production 继续逐项确认。

## 3. 门禁与恢复条件

| 门禁 | 当前状态 | 恢复条件 |
|---|---|---|
| 正式视觉/设计/技术 | approved | PO 于 2026-08-20 明确确认 Gate 2 v2 通过 |
| Supabase migration | completed | PO 于 2026-08-20 当次确认；Production URL 绑定、迁移历史、RLS、权限、RPC、Advisor 与事务锁均已验证 |
| Owner Preview 写入 | completed | PO 已授权；Todo、日记与远期寄语仅用合成标记记录完成验收 |
| 寄语自动化创建 | pending | Preview 通过，PO 确认 Prompt、RRULE 和权限 |
| 2.5.0 PR 合并 | pending | 全量 CI、独立复审、PO 验收通过并确认 |
| Production | pending | 账号/项目绑定复核、回滚方案和 PO 上线确认 |

## 4. 开放风险

- 新闻源可用性和 GDELT 结果质量不稳定：白名单、动态配比、最近成功缓存降级。
- Runtime Cache 区域一致性：两个端点固定同区并测试缓存命中。
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
| 2026-08-19 | 视觉、设计、技术确认前不写生产功能 | Gate 2 v2 后已满足 |
