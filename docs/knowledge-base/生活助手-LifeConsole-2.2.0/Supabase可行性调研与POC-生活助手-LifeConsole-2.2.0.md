# Supabase 可行性调研与 POC - 生活助手 - Life Console - 2.2.0

> 状态：本地合成 POC 与东京托管权限验证通过 / Vercel Preview READY / OTP/UI 待 PO 补验
> 日期：2026-08-12
> 边界：独立东京 Supabase 项目只含 migration 与纯合成数据；未读取 iCloud、未上传真实生活记录、未部署 Production、未切源

## 1. 结论

Supabase 作为 Life Console 2.2.0 后端候选 **可继续推进，但仍不能直接进入真实迁移**。本地与托管证据已证明数据模型、RLS、调用者权限 View/RPC、同日原子 upsert、浏览器 SDK 契约、托管 Data API 权限和 Vercel 精确 CSP 可行；可收件 OTP、登录后浏览器 CRUD、大陆分时网络、1k/10k 托管容量与真实敏感字段加密仍需独立门禁。

没有发现必须放弃 Supabase 的技术卡点，已发现六项必须提前处理的工程约束：

1. 本机没有 Docker、Supabase CLI 或 `psql`，不能运行完整本地 Auth/PostgREST/Postgres 栈；本轮以 PGlite 验证 PostgreSQL 核心语义，不冒充托管环境。
2. 默认 SMTP 只适合演示，只向 Supabase 团队内预授权邮箱发送，当前限额很低且无 SLA；正式 OTP 必须配置自有 SMTP。
3. 项目区域创建后不能原地变更；中国大陆网络质量必须在选区前用真实候选端点测试。
4. Data API 默认最多返回 1,000 行；列表必须游标分页，备份不得依赖一次普通列表请求。
5. `supabase-js >=2.102` 会自动重试 GET/HEAD 的部分瞬时错误，不会自动重试写方法。Life Console 仍显式关闭数据库自动重试，由 repository 区分查询重试、revision 冲突和幂等写入。
6. 当前 Vercel CSP 为 `connect-src 'none'`，会阻止 Supabase；接入时必须只放行精确项目 Origin，不使用通配符。

## 2. 本地环境与依赖结论

| 项目 | 结果 | 影响 |
|---|---|---|
| Node.js | 25.9.0 | 满足 Supabase JS 当前 Node 22+ 基线 |
| npm | 11.12.1 | 可运行当前测试 |
| Docker 兼容运行时 | 不存在 | 无法启动完整 Supabase 本地栈 |
| Supabase CLI | 不存在 | 本轮不安装；即使安装也缺 Docker |
| `psql` | 不存在 | 不影响 PGlite 合成 POC |
| `@supabase/supabase-js` | 固定 2.112.3 | 验证浏览器请求契约 |
| `@electric-sql/pglite` | 固定 0.5.4 | 只用于本地 PostgreSQL 语义测试，不进生产包 |

不建议为了本轮 POC 在即将归还的工作电脑上安装 Docker Desktop。完整托管能力通过后续独立候选项目验证，减少机器级依赖和迁移负担。

## 3. 已执行的合成验证

测试入口：`apps/life-console/tests/supabase/`。SQL fixture 明确不是生产迁移，测试数据均为无真实关联的 UUID、邮箱和文本。

| 验证项 | 结果 | 证据含义 |
|---|---|---|
| 所有权列 RLS 与复合索引 | 通过 | 两张 POC 表启用 RLS，所有权过滤有索引 |
| Owner 直接查询 | 通过 | 只返回本人的合成行 |
| `security_invoker` View | 通过 | View 不绕过底表 RLS |
| 已登录非 Owner | 通过 | 查询 Owner A 行返回空集合 |
| 未登录/anon | 通过 | 个人表读取被拒绝 |
| 修改 `user_id` | 通过 | UPDATE `WITH CHECK` 拒绝换绑 |
| 物理 DELETE | 通过 | 未授予删除权限 |
| 同日状态原子 upsert | 通过 | 小数分值保真，revision 原子递增 |
| 一致性备份 RPC | 通过 | 单条 `security invoker` SQL 聚合本人跨表快照；固定空 `search_path` |
| OTP 请求契约 | 通过 | `shouldCreateUser=false`，未知邮箱不自动注册 |
| 浏览器凭据契约 | 通过 | 请求仅包含 publishable 测试 key，无 secret/service-role |
| SDK 自动重试开关 | 通过 | `db.retry=false` 时一次失败只发送一次请求 |
| 当前 CSP 兼容性 | 阻塞已确认 | `connect-src 'none'` 必须在接入实现中调整 |

执行结果：2 个测试文件，11 个测试全部通过。

## 4. 关键方案修正

### 4.1 备份一致性

多次 Data API 请求不自动共享同一个数据库事务，因此不能用浏览器依次读取多张表来宣称“一致性快照”。首版改为一个 `security invoker` 数据库函数，在一个 SQL 语句中按 `auth.uid()` 和 RLS 聚合版本化 JSON。浏览器调用 RPC 后生成 manifest、计数和摘要；Edge Function 不是首版必需依赖。

该函数必须：

- 使用调用者权限，不使用 `security definer`；
- 固定空 `search_path`，所有对象使用 schema 限定名；
- 撤销 public 执行权，只授予 `authenticated`；
- 返回版本、稳定排序和分页/容量保护；
- 后续在托管 Postgres 上验证事务一致性与大数据量表现。

### 4.2 Vercel 与 Supabase 连接

不采用当前处于 Public Alpha 的 Vercel Marketplace Supabase 集成。该集成会自动同步数据库密码、secret key、JWT secret 等大量服务端环境变量，与本项目“纯 Vite 浏览器只持有 URL + publishable key”的最小权限原则不符。

采用手工环境配置：Preview 与 Production 分离，只注入项目 URL、publishable key 和非敏感开关；CSP `connect-src` 只增加精确的 Supabase HTTPS/WSS Origin。

### 4.3 Auth 与邮件

候选 POC 可以使用默认 SMTP，但测试邮箱必须先加入 Supabase 组织团队；正式个人使用前必须选择并配置自有 SMTP，验证中国大陆邮箱到达率、延迟、垃圾邮件和限流。继续保持 `shouldCreateUser=false`，用户由受控管理流程预创建。

### 4.4 Edge Function 使用边界

普通 CRUD 和一致性导出优先使用 RLS + Data API/RPC。只有需要隐藏第三方 secret、服务端编排或超出数据库函数职责时才引入 Edge Function。托管限制当前包括 256MB 内存、每请求 2 秒 CPU、150 秒请求空闲超时；Free worker 最长 150 秒。大备份不得把完整数据长期缓存在 Edge Function 内存。

## 5. 托管候选验证与剩余项目

| 项目 | 当前结果 | 下一步验收 |
|---|---|---|
| 中国大陆到 Supabase 的延迟和稳定性 | 当前网络可加载 Vercel Preview 与 Auth Gate；尚无登录后分时样本 | 上海网络分时测 Auth、Data API 与 RPC |
| 区域选择 | 东京 `ap-northeast-1` 已创建并复核健康；区域不可原地变更 | 真实迁移前再确认数据驻留与网络 |
| OTP 实际到达 | Auth 日志确认默认 SMTP 已发送 Magic Link；控制台在未配置自有 SMTP 时锁定模板编辑，无法改成 `{{ .Token }}` 六位 OTP；内置 SMTP 固定为每小时 2 封，邀请与首次登录链接已触发 429 限流；候选 UI 已改为 Magic Link 和 429 专用提示 | 配额窗口恢复后只发送一次最新 Magic Link 验证会话；六位 OTP 延期到自有 SMTP 评审 |
| 托管 Postgres RLS/GRANT | 三个版本化迁移已应用；托管 anon/A/B 权限矩阵 13/13 通过 | 真实迁移前在最终项目重复执行 |
| Vercel Preview CORS/CSP | Preview READY、HTTP 200；只放行精确 Supabase HTTPS/WSS Origin，安全头读回通过 | 登录后验证 CRUD、冲突、失败与退出 |
| 1,000 行以上分页与备份容量 | 本地 2,000 条跨语言备份通过；托管 1k/10k 尚未执行 | 确定目标容量后测 RPC 大小、耗时和内存 |
| 平台 Advisors/备份/暂停恢复 | Security 无 error，1 条无密码邮件登录场景非阻断 password warning；Performance 仅新项目未使用索引 info | 真实上线前复核 Advisor；平台恢复演练另立门禁 |
| 非 Owner 隔离 | 托管 SQL 权限矩阵已验证 A/B 隔离；两个可登录 Auth 账号的浏览器 E2E 未执行 | 不得把 SQL 矩阵冒充双浏览器身份验证 |

## 6. 进入实现前建议门禁

阶段 E 专项资源与 Preview 授权已经使用；当前只等待 PO 完成网页内 Magic Link/UI 验收以及 Agent 补齐治理检查，六位 OTP 单独延期。任何真实数据、Production、切源、资源删除、PR Ready 或合并仍需新的明确授权。

候选资源继续只放合成数据并输出去敏证据；未经新授权不读取 iCloud、不接入真实日记/健康数据、不切换真相源，也不提升 Preview 到 Production。

## 7. 官方依据

- Local Development：<https://supabase.com/docs/guides/local-development>
- RLS：<https://supabase.com/docs/guides/database/postgres/row-level-security>
- Data API 安全：<https://supabase.com/docs/guides/api/securing-your-api>
- Data API 1,000 行默认上限：<https://supabase.com/docs/reference/javascript/select>
- Email OTP：<https://supabase.com/docs/guides/auth/auth-email-passwordless>
- Custom SMTP：<https://supabase.com/docs/guides/auth/auth-smtp>
- 项目区域迁移：<https://supabase.com/docs/guides/troubleshooting/change-project-region-eWJo5Z>
- Edge Function Limits：<https://supabase.com/docs/guides/functions/limits>
- 自动重试变更：<https://supabase.com/changelog/45071-automatic-postgrest-retries-for-transient-errors>
- Vercel Marketplace：<https://supabase.com/docs/guides/integrations/vercel-marketplace>
- Free 项目暂停：<https://supabase.com/docs/guides/platform/free-project-pausing>
