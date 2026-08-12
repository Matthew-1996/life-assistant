# 技术方案 - 生活助手 - Life Console - 2.2.0

> 状态：Gate 2 已确认 / 阶段 A、B 通过 / 阶段 C 目标、每日状态与日记 CRUD 合成实现完成
> 范围：允许通用代码、生产 migration 草案和合成测试；不创建 Supabase/Vercel 资源，不连接真实项目

## 1. 技术结论摘要

推荐保留 React 19 + Vite 7 + TypeScript 5 的 Vercel 前端，以 `@supabase/supabase-js` 接入 Supabase Auth 与 Data API。普通 CRUD 直接在 RLS 下运行，一致性快照使用 `security invoker` 数据库 RPC；只有隐藏第三方 secret 或服务端编排才进入受用户 JWT 保护的 Edge Function。浏览器只持有项目 URL 与 publishable key，任何 secret/service-role key 都不得进入 Vite 构建。

## 2. 总体架构

```mermaid
flowchart TB
  U["Owner 浏览器"] --> V["Vercel: React/Vite"]
  V --> A["Supabase Auth"]
  V --> D["Supabase Data API"]
  D --> P["Postgres + RLS"]
  V --> R["security invoker 备份 RPC"]
  R --> P
  R --> X["版本化用户导出"]
  V --> F["受 JWT 保护的 Edge Function"]
  F --> P
  X --> L["本机 Agent 原子写入 iCloud 最新备份"]
  L -. "真实迁移前" .-> I["iCloud 私人真相源"]
```

边界：Vercel 负责静态前端和安全响应头；Supabase 负责身份、数据库、Data API 和少量受保护函数；iCloud/Agent 负责用户可迁移备份及当前私人真相源。

## 3. 前端模块

| 模块 | 职责 |
|---|---|
| `auth` | OTP 请求、验证、会话恢复、登出、过期处理 |
| `supabase-client` | 只用 URL + publishable key 建立浏览器客户端 |
| `repository` | 将现有 `LifeConsoleClient` 映射到 Supabase 表/RPC，隔离页面与供应商细节 |
| `query-state` | loading/error/empty/refetch；不缓存正式个人数据到构建产物 |
| `draft-storage` | 仅短期失败保护，设大小/有效期并允许清除 |
| `backup-status` | 展示用户语义状态，不直接接触本机文件系统 |

Vercel Preview、Production 与本地开发使用独立环境变量。`VITE_` 变量会进入客户端包，因此只允许 URL、publishable key 和非敏感开关。环境值不进入 Git；变更只对新部署生效。

## 4. 数据模型草案

所有业务表包含 `id`、`user_id`、`created_at timestamptz`、`updated_at timestamptz`、`revision bigint`。首版单用户仍按 `user_id uuid references auth.users(id)` 隔离。

| 表 | 核心字段 | 约束/用途 |
|---|---|---|
| `profiles` | `user_id`, `display_name`, `status` | 每个 Auth 用户一行；不以邮箱作为业务主键 |
| `goals` | `title`, `domain`, `status`, `priority`, `start_date`, `target_date` | 长期/阶段目标；目标正文与状态分离 |
| `journals` | `event_date`, `title`, `content`, `tags`, `deleted_at` | 日记当前版本；敏感字段加密方案待 D3 |
| `journal_revisions` | `journal_id`, `revision`, `snapshot`, `reason` | 更正/撤回证据；append-only |
| `daily_checkins` | `date`, 四项主观分数, `anchors`, `notes` | `unique(user_id,date)`，未知字段为 null |
| `weekly_reviews` | `week_start`, `content`, `revision` | `unique(user_id,week_start)` |
| `phase_reviews` | `period_start`, `period_end`, `content` | 阶段复盘 |
| `health_days` | `date`, `summary`, `source_revision` | Apple Health 日级派生；真实导入另设门禁 |
| `health_segments` | `health_day_id`, `start_at`, `end_at`, `source` | 跨日睡眠明细；外键建索引 |
| `idempotency_keys` | `user_id`, `key`, `operation`, `result_ref`, `expires_at` | 唯一 `(user_id,key)`，防重复写 |
| `backup_runs` | `status`, `manifest_version`, `record_counts`, `content_digest` | 只存去敏运行状态，不存本机路径或正文 |
| `audit_events` | `action`, `entity_type`, `entity_id`, `result`, `created_at` | 最小审计；不复制敏感内容 |

主键策略在 POC 中比较 `bigint identity` 与时间有序 UUID；不为小规模首版引入非必要扩展。时间统一使用 `timestamptz`，业务日期使用 `date`。RLS 和常用排序采用复合索引，如 `(user_id, event_date desc, id desc)`；分页使用游标而非深 OFFSET。

## 5. 权限与 RLS

1. 暴露 schema 的每张表显式 `enable row level security`，迁移中同时声明最小 GRANT。
2. `anon` 对个人业务表没有权限；`authenticated` 仅获得所需 SELECT/INSERT/UPDATE，DELETE 默认不授予。
3. 每张表按 `(select auth.uid()) = user_id` 校验；UPDATE 同时有 `USING` 与 `WITH CHECK`，且需要 SELECT policy。
4. 所有 `user_id`、外键和高频过滤列建索引。
5. View 必须使用调用者权限（`security_invoker`）或放在不暴露 schema；避免 `security definer`。
6. 如确需 `security definer`，只能位于非暴露 schema、固定 `search_path`、函数内再次校验 `auth.uid()`，并撤销公开执行权限。
7. Owner 判定不使用可由用户修改的 `user_metadata`；首版以行所有权为主，需要角色时才评审 `app_metadata`。
8. service-role/secret key 仅可在受控服务端使用，并视为可绕过 RLS 的高风险凭据。

## 6. API 与写入语义

### 6.1 普通 CRUD

- 浏览器使用 Supabase Data API，在 RLS 下查询本人的行。
- 创建：客户端生成幂等键，服务端以唯一约束 + `on conflict` 原子处理。
- 更新：携带期望 `revision`，条件更新成功后 revision +1；0 行更新映射为冲突。
- 删除：首版只创建 `deleted_at`/删除计划，不开放物理 DELETE。
- 列表：Data API 默认最多返回 1,000 行，使用 `(event_date,id)` 或 `(created_at,id)` 游标分页。
- SDK：客户端显式设置 `db.retry=false`，由 repository 决定只读查询是否重试；写入依赖幂等键和 revision，不做不可见重试。

### 6.2 Edge Function

仅用于隐藏第三方 secret、服务端编排或未来受控批处理。函数保持 JWT 验证，使用调用者 JWT 创建受 RLS 限制的客户端；如需 admin 客户端，必须先验证用户身份和精确操作范围。公开 `auth:none` 不用于任何个人数据路由。跨表快照首选单条 `security invoker` 数据库 RPC，避免多次 Data API 请求产生非一致读。

## 7. Auth 方案

- 首选 Email OTP：`signInWithOtp` + `shouldCreateUser=false`。
- Supabase Site URL 和允许的 redirect URL 分环境配置；Preview 不复用 Production 白名单。
- 前端订阅会话变化并在过期时清理内存态；不要把 access/refresh token 写入日志或知识库。
- 合成验收至少准备 Owner 与非 Owner 两个测试用户：Owner 行可见；非 Owner SELECT 返回空结果、越权写入返回拒绝。未登录 401 不能替代已登录非 Owner 的行隔离证据，也不把 Data API 的空结果冒充为 403。
- 默认 SMTP 仅供演示且只发送到项目团队预授权邮箱；正式 OTP 必须配置自有 SMTP 并验证大陆邮箱到达率。

## 8. 备份与恢复

Supabase 平台备份是平台灾难恢复能力，不等于用户可迁移备份：免费项目需要主动逻辑导出；物理备份/PITR 可能不可下载，Storage 对象也不随数据库备份恢复。

2.2.0 延续版本化 `life-console-backup`：单条调用者权限 RPC 一致性读取 → 规范化 NDJSON/manifest → 计数与摘要 → 浏览器返回 → 本机 Agent 校验并原子替换 iCloud 最新备份。首轮只用合成数据验证，不接触真实 iCloud。

## 9. Supabase 技术调研结论与实施约束

### 9.1 可行性结论

Supabase 可以继续作为 2.2.0 唯一新后端候选，但本地 POC 不能替代托管候选验收。当前没有发现必须放弃该方案的技术卡点；已用纯合成数据证明 PostgreSQL 所有权模型、RLS、调用者权限 View/RPC、同日原子 upsert 和浏览器 SDK 请求契约可行。

| 调研项 | 当前结论 | 实施约束 |
|---|---|---|
| 本地运行环境 | 本机没有 Docker、Supabase CLI 或 `psql`，无法运行完整 Auth/PostgREST/Postgres 栈 | 不在即将归还的工作电脑安装 Docker；用独立托管候选补齐验证 |
| RLS 与权限 | PGlite 合成测试已证明 Owner 隔离、非 Owner 空结果、anon 拒绝、禁止换绑和禁止物理删除 | 正式迁移仍需在 Supabase Postgres 重跑 anon/A/B 三身份矩阵和 Advisors |
| 一致性备份 | 多次 Data API 请求不共享单一事务；单条 `security invoker` RPC 可形成一致性快照 | RPC 固定空 `search_path`、撤销 PUBLIC 执行权、只授予 `authenticated`，不得改成 `security definer` |
| Auth 邮件 | 默认 SMTP 仅供演示，只向团队预授权邮箱发送且限流低、无 SLA | 候选可用合成团队邮箱；正式 OTP 前必须配置自有 SMTP 并验证大陆邮箱到达率 |
| 区域 | Supabase 项目创建后不能原地更换区域 | 创建资源前比较东京、新加坡、首尔等候选的大陆网络、成本和数据驻留 |
| Data API | 默认最多返回 1,000 行 | 所有列表使用游标分页；备份不得依赖一次普通列表请求 |
| SDK 重试 | `supabase-js >=2.102` 只自动重试 GET/HEAD 的部分瞬时错误，不自动重试写方法 | 客户端仍显式设置 `db.retry=false`，由 repository 区分只读重试、revision 冲突与幂等写入 |
| Vercel 集成 | Marketplace 处于 Public Alpha，并会同步数据库密码、secret key、JWT secret 等不必要变量 | 不使用 Marketplace；手工按环境只配置 URL 与 publishable key |
| CSP | 当前 `connect-src 'none'` 会阻止 Supabase | 接入时只放行候选/正式项目各自精确 HTTPS/WSS Origin，不使用通配符 |
| Edge Function | 普通 CRUD 和备份首版不需要 Edge Function；托管函数有内存、CPU 和时长限制 | 只用于隐藏第三方 secret 或服务端编排，不在函数内缓冲大型全量备份 |

### 9.2 已验证证据

本地 POC 固定使用 `@supabase/supabase-js 2.112.3` 与仅供测试的 `@electric-sql/pglite 0.5.4`。合成 SQL 不是生产 migration，未包含项目标识、真实邮箱或个人数据。

- PostgreSQL/RLS：7 项通过，包括复合索引、Owner/非 Owner/anon、UPDATE `WITH CHECK`、原子 upsert 和单事务导出 RPC。
- 浏览器 SDK：4 项通过，包括 `shouldCreateUser=false`、仅 publishable key、关闭 Data API 自动重试和 CSP 阻塞识别。
- 当前全量本地回归：Life Console 29 个 Vitest 文件、211 项测试通过；应用 Python 90 项测试通过。
- 尚未验证：大陆到真实项目端点的网络、真实 OTP、托管 RLS/GRANT、Vercel Preview CORS/CSP、1k/10k 容量、平台 Advisors/备份和第二个 Auth 用户端到端隔离。

详细可复现方法和远端待测矩阵见 [Supabase 可行性调研与 POC](Supabase可行性调研与POC-生活助手-LifeConsole-2.2.0.md)。

### 9.3 进入实现前的阻断条件

Gate 2 之外，创建独立 Supabase 候选资源前还需 PO 单独确认区域候选、套餐成本、测试邮箱和资源生命周期。正式个人数据前必须另行完成字段加密威胁模型、自有 SMTP、备份恢复演练、真实迁移和切源门禁。本节不构成资源创建、部署或真实数据授权。

### 9.4 阶段 A 生产 migration 草案

首个 Gate 2 开发块新增 `supabase/migrations/0001_life_console.sql`，生产 SQL 不包含测试角色、合成用户或平台资源标识。独立 `auth-shim.sql` 只为 PGlite 提供 Supabase 托管环境原本具有的 `auth.users`、`auth.uid()`、`anon` 和 `authenticated`；`seed.synthetic.sql` 只含两名无真实关联的测试用户和合成记录。

聚焦测试 9 项通过，覆盖 12 张表、RLS、所有权/外键索引、最小 GRANT、UPDATE `USING` + `WITH CHECK`、无物理 DELETE、Owner A/B 隔离、anon 拒绝、换绑拒绝、null 与小数保真、revision 冲突和 `security invoker` 导出 RPC。该证据只证明 PostgreSQL/PGlite 语义，不替代托管 Supabase 的 Auth、PostgREST、Advisors 或真实网络验证。

### 9.5 阶段 B Auth 与 Repository 合成实现

阶段 B 在未配置 Supabase URL、publishable key、SMTP 或远端资源的前提下新增以下通用边界：

- `supabase/client.ts`：浏览器配置只接受精确项目 Origin 与 publishable key；缺项、secret/service-role 变量或 `sb_secret_` key 均 fail closed；`db.retry=false`。
- `supabase/auth.ts`：使用窄 Auth port 请求 Email OTP，固定 `shouldCreateUser=false`；只向应用暴露 `userId`、`email` 与 `expiresAt`，不返回 access/refresh token。
- `SupabaseAuthGate.tsx`：可注入的 loading、OTP、6 位验证码、会话过期和登出状态机；发送反馈为中性文案和局部遮罩邮箱；未接入 `main.tsx`。
- `supabase/repository.ts`：只允许已批准表名/排序列，列表使用 `(event_date,id)` 或 `(created_at,id)` 降序游标；页长限制为 1-100；瞬时只读失败最多额外尝试一次；更新固定使用 `id + revision` 条件，零行映射 409；写入不做隐式重试。

聚焦合成测试 23/23 通过，其中 browser client 4 项、Auth 5 项、OTP Gate 6 项、Repository 8 项。Repository 测试使用真实 `supabase-js` 查询构造器与合成 fetch transport，证明本地请求契约、错误归一化和重试边界；它不证明托管 Auth、PostgREST、SMTP、CORS/CSP、RLS 或真实网络行为。正式启动入口、精确 CSP Origin、远端资源和部署仍需后续独立授权。

### 9.6 阶段 C 目标 CRUD 合成实现

阶段 C 首个独立模块选择目标，避免在日记修订原子性尚未单独实现前混合多个业务域：

- `create_goal` 是 `security invoker`、空 `search_path` 的 authenticated-only RPC；使用 `auth.uid()`、现有 `(user_id,key)` 唯一约束和请求指纹，在同一事务内创建目标、记录幂等结果和写入不含正文的最小审计事件。
- 目标列表固定使用 `(created_at,id)` 降序游标和 `deleted_at is null` 谓词，不接受调用方传入任意表、排序列或过滤片段。
- `GoalRepository` 负责输入归一化、幂等创建、revision 条件更新、归档和恢复；所有写调用只执行一次，网络失败不做不可见重试。
- `SupabaseGoalsPanel` 通过依赖注入展示 loading、真实空态、创建、修订、冲突、失败重试和归档；失败时保留输入及同一幂等键，未接入 `App.tsx` 或 `main.tsx`。
- TypeScript 配置显式限定全局 types，避免 iCloud 生成的重复 `@types/* 2` 目录被自动发现；不改变运行时依赖与产品行为。

目标模块聚焦测试 34/34 通过，其中 migration 13 项、Repository foundation 9 项、Goal Repository 6 项、Goals Panel 6 项；本轮新增 17 项目标相关断言。该证据只覆盖 PGlite、真实 `supabase-js` 查询构造器、合成 fetch 和注入 UI，不替代托管 Postgres/PostgREST、两用户 Auth、CSP 或网络验收。

### 9.7 阶段 C 每日状态 CRUD 合成实现

每日状态模块以已批准的 OpenAPI 和趋势 UI 为真相源，将 migration 中偏离的 `0–10 numeric` 修正为 nullable `1–5 smallint`；合成 seed 与 PGlite POC 同步改为 1–5 整数。当前数据模型只包含四项评分、批准的四个 anchors 与 160 字 notes，不扩展未进入 2.2 技术方案的睡眠时刻字段。

- `create_daily_checkin` 是 authenticated-only、invoker、空 `search_path` RPC；以 `(user_id,key)` 和请求指纹实现幂等创建，以 `(user_id,checkin_date)` 阻止同日重复，并只写去敏审计元数据。
- `DailyCheckinRepository` 提供单日查询、`(checkin_date,id)` 最近列表、幂等创建和 revision 条件更新；评分小数/越界、非法日期、未知 anchor、超长 notes 和空创建在发请求前拒绝。
- `LifeConsoleRepository.executeRead` 统一只读瞬时失败的一次受控重试；任何每日状态写入仍只调用一次。
- `SupabaseDailyCheckinPanel` 只提交 dirty fields；未记录保持 null/未知，创建失败重试复用同一个 idempotency key，冲突和网络失败均保留输入；组件未接 `App.tsx` 或 `main.tsx`。

每日状态模块聚焦测试 49/49 通过，其中 migration 18 项、PGlite POC 7 项、Repository foundation 10 项、DailyCheckin Repository 7 项、Daily Check-in Panel 7 项；本轮新增 20 项状态相关断言。该证据不替代托管 RPC/PostgREST、两用户 Auth/RLS、CSP 或真实网络验证。

包含每日状态模块后的全量本地回归为 29 个 Vitest 文件、211/211，应用 Python 90/90，工具测试 333 项通过且 1 项跳过；公开 Registry 干净安装审计 0，生产构建通过。

### 9.8 阶段 C 日记 CRUD 合成实现

PO 已确认本轮只实现日记创建、读取、分页和修订，不实现撤回、恢复、删除计划或永久删除。D3 敏感字段加密仍是独立真实数据门禁；本模块只使用合成正文，不改变真实日记不得进入当前链路的约束。

- `journals` 保存当前版本；受限 `record_journal_revision` trigger 在每次 INSERT 或 revision +1 UPDATE 后，将写入后的完整版本追加到 `journal_revisions`。trigger 使用固定空 `search_path`，撤销 PUBLIC 执行权；authenticated 只有 revision SELECT 权限，不能直接伪造历史。
- `create_journal` 是 authenticated-only、invoker、空 `search_path` RPC；同一事务完成当前行创建、revision 1 自动快照、幂等回执与不含正文的最小审计。
- `JournalRepository` 固定使用 `(event_date,id)` 游标和 `deleted_at is null`，提供单条读取、revision 历史、幂等创建和 revision 条件更新；只读瞬时失败最多额外尝试一次，写入不隐式重试。
- `SupabaseJournalsPanel` 通过依赖注入展示真实 loading/empty、创建、编辑、冲突保留、同 key 重试和 revision 元数据；不渲染历史正文，不提供撤回/恢复/删除操作，也未接 `App.tsx`、`main.tsx` 或托管配置。

日记模块聚焦回归 45/45 通过，其中 production migration 22 项、Repository foundation 10 项、Journal Repository 7 项、Journals Panel 6 项。该证据不替代 D3、托管 trigger/RPC/PostgREST、两用户 Auth/RLS、CSP 或真实网络验证。

包含日记模块后的全量本地回归为 31 个 Vitest 文件、228/228，应用 Python 90/90，工具测试 333 项通过且 1 项跳过；公开 Registry 干净安装审计 0，生产构建通过。

## 10. 近期兼容性检查

- 当前项目 Node `>=22.13`、TypeScript `5.9`，满足 Supabase JS 近期要求。
- 新表不假设自动暴露到 Data API；迁移显式配置 exposed schema、GRANT 与 RLS。
- 不依赖 GraphQL、Realtime schema 修改或扩展版本固定，规避 2026 年相关破坏性变更。
- Vercel 的 Vite 客户端变量会进入构建，禁止把 secret key 放入 `VITE_*`。
- 不使用 Public Alpha 的 Vercel Marketplace 自动集成；它会同步数据库密码和 secret 等本项目不需要的服务端变量。手工只配置 URL 与 publishable key。
- 当前 CSP `connect-src 'none'` 会阻止 Supabase；实现时只加入精确项目 Origin。
- Supabase 项目区域创建后不能原地变更；区域必须在资源创建前通过网络和数据驻留评审。

## 11. 技术评审结论与 Gate 2 决策

| 编号 | 建议 |
|---|---|
| Q1 | 保留 Vercel React/Vite，Supabase 作为唯一新后端候选 |
| Q2 | Email OTP + 禁止自动注册；数据按 `user_id` 隔离 |
| Q3 | 普通 CRUD 使用 Data API + RLS；一致性导出使用调用者权限 RPC；隐藏 secret 或服务端编排才用 Edge Function |
| Q4 | 显式 GRANT、RLS、索引、revision 和幂等键进入同一版本化迁移 |
| Q5 | 真实敏感数据前另做字段加密威胁模型，不在本轮默认弱化或沿用旧 KEK |
| Q6 | 用户可迁移备份与平台备份分层，合成 round-trip 先行 |
| Q7 | 先本地/合成实现，再申请独立 Supabase 测试资源和 Vercel Preview；每步单独门禁 |

PO 已于 2026-08-12 确认 Q1-Q7，允许从生产 migration 草案与合成 RLS/权限测试开始通用实现。Supabase/Vercel 资源、部署、真实数据、切源、资源删除和 PR 合并仍需分别取得当次授权。

## 12. 官方依据

- Supabase RLS：<https://supabase.com/docs/guides/database/postgres/row-level-security>
- Supabase Data API 安全：<https://supabase.com/docs/guides/api/securing-your-api>
- Supabase 无密码邮件登录：<https://supabase.com/docs/guides/auth/auth-email-passwordless>
- Supabase Edge Function 鉴权：<https://supabase.com/docs/guides/functions/auth>
- Supabase 数据库备份：<https://supabase.com/docs/guides/platform/backups>
- Supabase 自定义 SMTP：<https://supabase.com/docs/guides/auth/auth-smtp>
- Supabase Edge Function 限制：<https://supabase.com/docs/guides/functions/limits>
- Supabase Vercel Marketplace：<https://supabase.com/docs/guides/integrations/vercel-marketplace>
- Supabase 项目区域变更：<https://supabase.com/docs/guides/troubleshooting/change-project-region-eWJo5Z>
- Vercel 环境变量：<https://vercel.com/docs/environment-variables>
- Vercel Vite：<https://vercel.com/docs/frameworks/frontend/vite>
- [本版本 Supabase 可行性调研与 POC](Supabase可行性调研与POC-生活助手-LifeConsole-2.2.0.md)
