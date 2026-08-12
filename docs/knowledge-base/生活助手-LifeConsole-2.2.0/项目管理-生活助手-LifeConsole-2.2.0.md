# 项目管理 - 生活助手 - Life Console - 2.2.0

> PMO：Agent
> 主阶段：待验收
> 子状态：Gate 1 / Gate 2 已确认 / 阶段 A-D 通过 / 阶段 E 远端候选条件通过，OTP/UI 待 PO 补验
> 当前分支：`agent/life-console-220-supabase`
> 当前 worktree：`.worktrees/life-console-220-supabase`
> 当前 Draft PR：[#40](https://github.com/Matthew-1996/life-assistant/pull/40)
> 最后更新：2026-08-12

## 1. 唯一主项

完成阶段 E 的最后验收：PO 在 READY 的 Vercel Preview 内完成可收件 OTP、登录后纯合成 CRUD、冲突/失败和退出；Agent 补齐治理检查、去敏文档、提交、推送与 Draft PR CI。不接真实 iCloud，不读取或生成真实生活数据，不修改 Production，不切源、不永久删除资源、不把 PR #40 转 Ready 或合并。

## 2. 版本收口与分支关系

| 对象 | 状态 | 处置 |
|---|---|---|
| PR #39 / 2.1.0 | 已 squash 合并 | 远端与本地分支、worktree 已清理 |
| PR #35 / 1.1.0 Sites 草案 | 已关闭 | 已被 2.x 主线取代；活动分支/worktree 已清理，关闭记录保留 |
| `main` | 2.1.0 最新基线 | 2.2.0 从合并提交创建 |
| `agent/life-console-220-supabase` | 唯一 2.2.0 活动分支 | 只承载本版本评审与后续获批实现 |
| PR #40 / 2.2.0 Draft PR | Draft | 不转 Ready、不合并，等待阶段 E 补验与后续 PO 门禁 |

## 3. 当前进度

| 阶段 | 状态 | 完成条件 |
|---|---|---|
| 项目立项 | 已完成 | PO 明确 2.2.0 与 Vercel + Supabase 方向 |
| 需求评审 | 已完成 | PO 已确认 PRD draft.1、D1-D8 与“有条件通过”结论 |
| 设计方案评审 | 已完成 | PO 已确认 O1-O5 |
| 技术/测试评审 | 已完成 | PO 已确认 Q1-Q7、测试矩阵和阶段计划 |
| 开发与联调 | 合成阶段完成 | 阶段 A-D 通用合成实现已通过本地全量验证和 PR CI |
| 测试资源与候选部署 | 条件通过 | migration、纯合成 seed、托管权限矩阵、Advisor、精确 CSP 与 Vercel Preview 已完成；OTP/UI 待补验 |
| 真实数据与上线 | 待开始 | 独立迁移、切源、验收和上线门禁 |

## 4. 当前卡点与恢复条件

| 卡点 | 恢复条件 |
|---|---|
| 敏感字段加密边界未定 | 真实数据前完成威胁模型与 D3 决策 |
| 双浏览器 Auth 非 Owner 证据 | 托管 SQL A/B 隔离 13/13 已通过；两个可登录账号 E2E 仍延期，不得冒充完成 |
| 候选会话与登录后 UI | 当前默认 SMTP 发 Magic Link，内置配额 2 封/小时已被邀请与首次链接占满；候选页已修复为登录链接流程和 429 专用提示，配额恢复后 PO 只发送一次，完成后 Agent 验证 CRUD、冲突、失败与退出 |
| 六位 OTP 模板 | 未配置自有 SMTP时控制台锁定模板编辑；Magic Link 只验证候选会话，不冒充六位 OTP；真实使用前评审自有 SMTP |

## 5. 风险与依赖

- 高：RLS 或高权限凭据配置错误；以默认拒绝、自动权限测试和服务端隔离缓解。
- 高：真实日记/健康数据上云；以合成先行、字段加密决策和独立真实迁移门禁缓解。
- 中：Vercel/Supabase 双平台配置漂移；以环境分离、可重复检查和无凭据 Git 基线缓解。
- 中：平台备份与 iCloud 用户备份语义混淆；产品和技术文档均明确分层。
- 依赖：阶段 E 专项授权已取得；剩余依赖只有 PO 的网页内 Magic Link/UI 验收、最终治理检查与 PR CI；六位 OTP 单独延期。

## 6. 决策日志

| 日期 | 决策 | 决策者 | 状态 |
|---|---|---|---|
| 2026-08-12 | PR #39 转可评审并 squash 合并；随后清理对应分支/worktree | PO / Agent | 已完成 |
| 2026-08-12 | 历史 PR #35 已被 2.x 主线取代，为恢复单一活动分支关闭并清理；未删除线上资源 | PMO / Agent | 已完成 |
| 2026-08-12 | 从最新 main 创建唯一 2.2.0 分支与 Draft PR #40 | PO / Agent | 已完成 |
| 2026-08-12 | 2.2.0 先完成 Vercel + Supabase 的 PRD、需求、设计、技术和测试方案评审 | PO | 预评审已完成，待双 Gate |
| 2026-08-12 | 阶段 E 前不包含 Supabase 资源、真实数据、部署、切源或资源删除 | PO | 对真实数据、切源、Production 和未专项授权删除持续生效；资源与 Preview 部分已被后续阶段 E 授权取代 |
| 2026-08-12 | 先执行必要的 Supabase 调研和本地纯合成 POC，避免开发后期才暴露平台卡点 | PO | 已完成；11 项测试通过 |
| 2026-08-12 | 将调研结论纳入唯一技术方案；清除 lockfile 的字节内网下载地址，统一使用 npm 官方 Registry | PO / Agent | 已完成；PR #40 Node/Python/privacy CI 全通过 |
| 2026-08-12 | Gate 1：确认 PRD draft.1、D1-D8，并接受需求评审“有条件通过”结论 | PO | 已确认；进入 Gate 2 定稿，不含实现、资源、部署、真实数据、切源、删除或合并授权 |
| 2026-08-12 | Gate 2：确认 O1-O5、Q1-Q7、测试矩阵和 A-G 阶段计划 | PO | 已确认；允许不含远端资源的通用合成实现，首块为生产 migration 草案与 RLS/权限测试 |
| 2026-08-12 | 阶段 A 首个开发块完成本地验证 | Agent | 生产 migration、纯合成 seed、PGlite Auth shim 与权限测试 9/9 通过；未创建资源、部署或接触真实数据 |
| 2026-08-12 | 阶段 A 首个开发块通过 PR #40 CI | Agent | Life Console 151/151、Python 90/90、工具 333 项通过且 1 项跳过；`node`、`python`、`privacy` 全部成功 |
| 2026-08-12 | 阶段 B Auth 与 Repository 完成合成验证与 PR #40 CI | Agent | 聚焦测试 23/23、Life Console 174/174、应用 Python 90/90、工具 333 项通过且 1 项跳过、生产构建通过；实现提交 `5dade35` 的 `node`、`python`、`privacy` 全部成功 |
| 2026-08-12 | 阶段 C 目标 CRUD 完成合成验证与 PR #40 CI | Agent | 聚焦 34/34、Life Console 191/191、应用 Python 90/90、工具 333 项通过且 1 项跳过、生产构建通过；实现提交 `5100b7b` 的 `node`、`python`、`privacy` 全部成功 |
| 2026-08-12 | 阶段 C 每日状态 CRUD 完成本地全量合成验证与 PR #40 CI | Agent | 聚焦 49/49、Life Console 211/211、应用 Python 90/90、工具 333 项通过且 1 项跳过、公开 Registry 审计 0、生产构建通过；实现提交 `07ef944` 的 `node`、`python`、`privacy` 全部成功 |
| 2026-08-12 | 日记撤回范围决策 | PO | 本轮暂不做撤回、恢复、删除计划或永久删除；先完成创建、读取、分页和原子修订 |
| 2026-08-12 | 阶段 C 日记 CRUD 完成本地全量合成验证与 PR #40 CI | Agent | 聚焦 45/45、Life Console 228/228、应用 Python 90/90、工具 333 项通过且 1 项跳过、公开 Registry 审计 0、生产构建通过；实现提交 `2bdc307` 的 `node`、`python`、`privacy` 全部成功 |
| 2026-08-12 | 阶段 C 复盘 CRUD 完成本地全量合成验证与 PR #40 CI | Agent | 聚焦 46/46、Life Console 242/242、应用 Python 90/90、工具 333 项通过且 1 项跳过、公开 Registry 审计 0、生产构建通过；实现提交 `158a576` 的 `node`、`python`、`privacy` 全部成功 |
| 2026-08-12 | 阶段 D 合成备份 POC 完成本地验证与 PR #40 CI | Agent | 保持 `life-console-backup/1`；八类资源 canonical 打包与既有 Agent 原子恢复 round-trip 通过；Life Console 252/252、应用 Python 92/92、工具 329/329、公开 Registry 审计 0；修复提交 `80a478a` 的 `node`、`python`、`privacy` 全部成功；未接真实 iCloud、资源或部署 |
| 2026-08-12 | 授权阶段 E 的独立 Supabase 测试资源、纯合成 migration/seed 与 Vercel Preview | PO | 已确认；仍禁止真实数据、Production、切源、PR Ready/合并及未单独授权的资源删除 |
| 2026-08-12 | Supabase 测试区域与费用 | PO / Agent | 选择东京 `ap-northeast-1`；免费组织创建费用为每月 0 美元，PO 已确认 |
| 2026-08-12 | 误建空白悉尼测试项目的处置 | PO / Agent | PO 明确授权后已删除；既有暂停项目未修改 |
| 2026-08-12 | 东京 Supabase 空白测试项目创建 | Agent | `life-console-220-synthetic-test` 已创建；Data API 开启、自动暴露新表关闭、自动 RLS 开启；未记录项目 ID、密码、密钥或连接串 |
| 2026-08-12 | 阶段 E 工作交接 | PO | 当前 Agent 停止 migration、seed 与部署；由后续 Agent 从资源复核开始接力 |
| 2026-08-12 | 阶段 E 托管数据库验证 | Agent | 三个 migration 已应用；两个无密码 A/B 占位身份与纯合成 seed 成功；托管权限矩阵 13/13，测试回滚后计数不变 |
| 2026-08-12 | 阶段 E Advisor 复核 | Agent | Security 无 error，保留 1 条无密码邮件登录场景非阻断 password warning；Performance 仅新项目未使用索引 info |
| 2026-08-12 | 阶段 E Vercel Preview | Agent | 两项环境变量仅作用于 Preview；候选 READY、首页 200、精确 HTTPS/WSS CSP 与安全头读回通过；Production 未替换 |
| 2026-08-12 | 阶段 E 浏览器验收边界 | PO / Agent | 邮箱与 OTP 只在网页内输入；当前未登录 Gate 已通过，登录后 UI 流程待 PO 补验 |
| 2026-08-12 | 默认 SMTP 与六位 OTP 结论 | Agent | Auth 日志确认默认模板发送 Magic Link；托管控制台要求自有 SMTP 后才可改为六位 `Token`，候选 Site URL 已修正到 Preview；六位 OTP 延期且不得冒充通过 |
| 2026-08-12 | 候选认证错误提示修复 | Agent | Auth 日志确认 429 发信限额与旧链接失效；仅候选入口切换为 Magic Link 文案，429 明示额度和禁止重复点击；修复版 Preview READY、Site URL 同步、Production 未替换 |

## 7. 下一步（最多三项）

1. 配额窗口恢复后，PO 在修复版 Preview 只发送一次登录链接，点击最新邮件，并用纯合成内容验收读写、冲突、失败与退出；六位 OTP 另行评审自有 SMTP，不把邮箱、链接或验证码发到聊天。
2. Agent 更新最终证据，运行治理、隐私、项目、测试和构建门禁，提交并推送唯一分支，等待 PR #40 Draft CI。
3. 真实数据、D3、托管容量、双浏览器 Auth、切源、Production、资源删除、PR Ready/合并继续延后，分别走独立门禁。
