# Supabase 可行性调研与 POC - 生活助手 - Life Console - 2.2.0

> 状态：本地合成 POC 通过 / 远端候选验证待单独授权
> 日期：2026-08-12
> 边界：未创建 Supabase 资源，未部署，未读取 iCloud，未使用真实数据或真实身份

## 1. 结论

Supabase 作为 Life Console 2.2.0 后端候选 **可继续推进，但不能仅凭本地 POC 进入真实迁移**。当前已证明数据模型、RLS、调用者权限 View/RPC、同日原子 upsert 和浏览器 SDK 契约可行；区域网络、真实 OTP 邮件、托管 Data API、Vercel 跨域及两账号隔离必须在独立私有候选项目验证。

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

## 5. 尚未验证且不可在本机替代的项目

| 项目 | 原因 | 下一步验收 |
|---|---|---|
| 中国大陆到 Supabase 的延迟和稳定性 | 没有真实项目端点，公共官网不代表项目链路 | 选定候选区域后，上海网络分时测 Auth/Data API/RPC |
| 区域选择 | 创建后不能原地更换 | 创建前比较东京、新加坡、首尔等候选的合规和网络 |
| OTP 实际到达 | 本地没有 GoTrue/SMTP | 候选项目使用合成邮箱；正式前测试自有 SMTP |
| 托管 Postgres RLS/GRANT | PGlite 只覆盖核心 PostgreSQL 语义 | 应用正式 migration，运行 anon/A/B 三身份矩阵 |
| Vercel Preview CORS/CSP | 本轮不部署 | 精确 Origin、安全头、无 secret/source map 检查 |
| 1,000 行以上分页与备份容量 | 无托管端点和目标容量基线 | 合成 1k/10k/目标上限，测 RPC 大小、耗时和内存 |
| 平台 Advisors/备份/暂停恢复 | 依赖托管项目及套餐 | 读取 Security/Performance Advisor，验证导出与恢复演练 |
| 已登录非 Owner 端到端证据 | 需要第二个合成 Auth 用户 | 不得用未登录 401 代替 |

## 6. 进入实现前建议门禁

当前可以继续 Gate 1/2 方案确认和本地通用代码，但创建 Supabase 项目前需 PO 另行确认：区域候选、Free/Pro 成本、自有 SMTP 是否本版本必需、独立测试邮箱、资源生命周期和删除审批人。

独立私有候选 POC 建议控制在一个 ≤3 小时工作块，只放合成数据，完成后输出去敏证据；未经新授权不部署、不读取 iCloud、不接入真实日记/健康数据、不切换真相源。

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
