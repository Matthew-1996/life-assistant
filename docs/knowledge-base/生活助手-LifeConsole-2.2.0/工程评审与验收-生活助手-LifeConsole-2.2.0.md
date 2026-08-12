# 工程评审与验收 - 生活助手 - Life Console - 2.2.0

> 状态：Gate 2 已确认 / 阶段 A、B 通过 / 阶段 C 复盘 CRUD 聚焦验证通过
> 当前证据：官方资料、现有代码基线和本地纯合成 PGlite/supabase-js POC；没有 Supabase 资源、托管迁移、部署或真实数据证据

## 1. 工程评审结论

PO 已确认 Gate 1 的 PRD/D1-D8，以及 Gate 2 的 O1-O5、Q1-Q7、本测试矩阵和 A-G 阶段计划。当前只允许阶段 A-D 的通用合成实现，不得把本地测试写成托管后端或线上验证通过。

## 2. 测试分层

| 层级 | 目标 | 关键用例 |
|---|---|---|
| 治理与隐私 | 分支、门禁、凭据与真实数据不越界 | 历史扫描、绝对路径、密钥模式、唯一规范 |
| Schema 静态 | 迁移可重复、表/约束/索引完整 | 主键、外键索引、唯一键、时区类型、down/forward 策略 |
| RLS 数据库 | 三种身份隔离 | anon 拒绝、Owner 仅本人、非 Owner 403/0 行；UPDATE WITH CHECK |
| Auth | OTP、会话和退出 | 禁止自动注册、重发限制、过期、跨环境 redirect、登出 |
| Repository/Contract | 页面与 Supabase 解耦 | CRUD 映射、null 保留、revision 冲突、错误归一化 |
| 前端 UI | 状态与移动端体验 | loading/empty/success/conflict/failure/session expired |
| Edge Function | 高权限流程最小化 | JWT 必需、用户作用域、无 secret 泄露、超限与超时 |
| 备份 | 用户可迁移性 | 合成全量导出、摘要、计数、原子覆盖、失败保留旧备份、恢复 round-trip |
| Vercel Preview | 跨域/CSP/环境隔离 | Preview 只连测试资源、Production 未变、安全头、无 source map 泄露 |
| 真实迁移 | 后续独立门禁 | dry-run、条数/摘要、抽样、回滚窗口、双写禁止、PO 验收 |

## 3. 强制权限矩阵

| 操作 | 未登录 | 已登录非 Owner | Owner |
|---|---:|---:|---:|
| 登录页 | 允许 | 允许 | 允许 |
| 读取任意个人表 | 拒绝 | 仅自己的合成行；对 Owner 行拒绝 | 仅自己的行 |
| 新建/更新 | 拒绝 | 只能写自己的合成行 | 只能写自己的行 |
| 修改 `user_id` | 拒绝 | 拒绝 | 拒绝 |
| 物理删除 | 拒绝 | 拒绝 | 首版也拒绝 |
| 备份导出 | 拒绝 | 只能导出自己的合成数据 | 只能导出自己的数据 |
| 服务端 admin 操作 | 不可达 | 不可达 | 仅经受控函数与额外校验 |

非 Owner 测试必须使用第二个合成账号。RLS 下越权 SELECT 可能以 200 + 空结果表达行不可见，越权写入才返回权限/策略拒绝；未登录 401 不能冒充已登录非 Owner 的隔离证据，也不把空结果冒充成 403。

## 4. 合成验收数据

- 两个无真实关联的测试用户 A/B。
- 日记包含普通文本、Unicode、空字段、跨日日期和最大允许长度，不含真实生活内容。
- 状态记录覆盖 null、0/边界分值、同日 upsert 和 revision 冲突。
- 健康段覆盖跨日、重叠、非法区间和 18 小时上限边界。
- 备份覆盖空库、小/中/大合成规模、摘要错误、截断、重复文件和路径穿越。

## 5. 分阶段计划（每块不超过 4 小时）

| 阶段 | 工作块 | 产物 | 前置门禁 |
|---|---|---|---|
| A | 本地 Schema/RLS POC（≤3h） | 版本化迁移草案、pgTAP/本地权限测试、合成 seed | Gate 1 + Gate 2 |
| B | Auth 与 Repository（≤4h） | OTP UI、Supabase client、契约适配、单元测试 | A 通过 |
| C | 核心 CRUD（每模块 ≤4h） | 日记/状态/目标/复盘按模块独立验收 | B 通过 |
| D | 备份 POC（≤4h） | 合成导出、manifest、Agent 原子恢复 round-trip | C 核心通过 |
| E | 独立测试资源（≤3h） | Supabase 测试项目/分支、Vercel Preview、两用户权限证据 | 单独资源与部署授权 |
| F | 候选验收（≤3h） | 移动端、故障、配额、安全顾问和 PO 验收 | E 通过 |
| G | 真实迁移与上线（拆分） | dry-run、备份、迁移、切源、回滚、资源处置 | 每项独立 PO 门禁 |

## 6. 发布阻断条件

- 任一暴露表缺 RLS、必要 GRANT 或 `user_id` 索引。
- 浏览器包、日志、Git 或 PR 出现 secret/service-role key、真实项目标识或真实个人数据。
- 非 Owner 越权测试未执行或失败。
- revision/幂等/失败保留输入任一关键路径失败。
- 合成备份不能完成独立解包、摘要校验和恢复 round-trip。
- Preview 与 Production 使用同一测试配置或未能证明正式环境未受影响。
- 字段加密 D3、区域/套餐 D6、真实迁移或切源尚未获 PO 当次确认。

## 7. 本轮验收

| 项目 | 状态 | 说明 |
|---|---|---|
| PRD/需求/设计/技术/测试草案 | 通过 | 已形成 2.2.0 唯一版本知识库 |
| 官方兼容性核对 | 通过 | 已核对 Supabase changelog、RLS、Data API、Auth、Edge Function、备份及 Vercel Vite/环境文档 |
| Supabase 资源 | 未执行 | 不在授权范围 |
| 托管数据库正式迁移与测试 | 未执行 | Gate 2 与独立资源授权后才允许 |
| Vercel/Supabase 部署 | 未执行 | 不在授权范围 |
| 真实数据、切源、删除 | 未执行 | 明确禁止 |
| 本地 PostgreSQL/RLS 合成 POC | 通过 | 7 项；Owner/非 Owner/anon、upsert、调用者权限 RPC |
| supabase-js 浏览器契约 POC | 通过 | 4 项；OTP、publishable key、重试关闭、CSP 阻塞识别 |
| 完整本地 Supabase 栈 | 阻塞 | 本机无 Docker；未安装机器级依赖 |
| 托管候选与大陆网络 | 延期 | 需要独立资源与部署授权，不能由 PGlite 替代 |

## 8. 阶段 A 首个开发块证据

| 项目 | 结果 | 边界 |
|---|---|---|
| 生产 migration 草案 | 通过 | 12 张表、约束、索引、GRANT、RLS 和导出 RPC；尚未应用到托管 Supabase |
| 合成 Auth 兼容层 | 通过 | 仅供 PGlite 模拟 Supabase 已提供的角色和 `auth.uid()` |
| 纯合成 seed | 通过 | 两名无真实关联用户，覆盖 12 表最小关系数据 |
| 聚焦权限测试 | 9/9 通过 | Owner A/B、anon、换绑、删除、null/小数、revision 和 RPC 隔离 |
| Life Console 全量 | 151/151 通过 | 21 个 Vitest 文件；Python 90/90；生产构建通过 |
| 项目级验证 | 通过 | 工具测试 333 项通过、1 项跳过；治理、隐私、历史扫描与便携性通过 |
| PR #40 CI | 通过 | `node`、`python`、`privacy` 全部成功；PR 保持 Draft |
| 远端资源与部署 | 未执行 | 未创建 Supabase/Vercel 资源，未部署 |
| 私人数据 | 未接触 | 未读取、上传或迁移 iCloud、日记或健康数据 |

本地 PGlite 证据不替代托管 Supabase 的 Auth、PostgREST、Advisors、网络、OTP 和 Vercel Preview 验收。

## 9. 阶段 B Auth 与 Repository 证据

| 项目 | 结果 | 边界 |
|---|---|---|
| Browser client | 4/4 通过 | 只接受 URL + publishable key，拒绝 secret，`db.retry=false`；未配置真实 Origin |
| Token-safe Auth | 5/5 通过 | `shouldCreateUser=false`、6 位 OTP、会话去 Token、登出与订阅清理 |
| OTP Auth Gate | 6/6 通过 | loading、未登录、遮罩反馈、验证码、认证 children、过期、登出与初始化竞态；未接正式入口 |
| Repository | 8/8 通过 | 复合游标、页长校验、HTTP/网络只读瞬时重试、写入不重试、错误归一化、revision 冲突与幂等边界 |
| 聚焦测试 | 23/23 通过 | 真实 `supabase-js` 查询构造器 + 合成 fetch/Auth port，不含远端调用 |
| Life Console 全量 | 174/174 通过 | 25 个 Vitest 文件；应用 Python 90/90；生产构建通过 |
| PR #40 CI | 通过 | 实现提交 `5dade35` 的 `node`、`python`、`privacy` 全部成功；PR 保持 Draft |
| Supabase/Vercel 资源 | 未执行 | 未创建、绑定或修改任何远端资源 |
| 托管 Auth/PostgREST/SMTP/CSP | 未验证 | 必须在后续独立测试资源与候选部署门禁中验证 |
| 私人数据 | 未接触 | 未读取、上传、生成或迁移真实日记、健康和 iCloud 数据 |

阶段 B 目前只证明通用代码和合成契约可用。远端资源、候选部署、正式入口接线、精确 CSP 放行、真实 OTP、两用户托管 RLS 和大陆网络仍不得标记通过。

## 10. 阶段 C 目标 CRUD 证据

| 项目 | 结果 | 边界 |
|---|---|---|
| 目标创建 RPC | 通过 | invoker、空 `search_path`、authenticated-only、幂等重放、请求漂移拒绝、Owner 隔离与最小审计 |
| Goal Repository | 6/6 通过 | 固定 active list、RPC 映射、校验、revision 更新、归档/恢复、写入不重试 |
| Repository foundation | 9/9 通过 | 新增 goals 固定 `deleted_at is null` 与 `created_at/id` 游标约束 |
| Goals Panel | 6/6 通过 | loading、真实空态、创建、冲突保留、同 key 重试和显式归档 |
| 目标模块聚焦 | 34/34 通过 | migration 13 + foundation 9 + goals 6 + UI 6；新增 17 项目标相关断言 |
| Life Console 全量 | 191/191 通过 | 27 个 Vitest 文件；应用 Python 90/90；公开 Registry 安装审计 0；生产构建通过 |
| 项目级验证 | 通过 | 根项目校验、治理检查、工具测试 333 项通过且 1 项跳过 |
| PR #40 CI | 通过 | 实现提交 `5100b7b` 的 `node`、`python`、`privacy` 全部成功；PR 保持 Draft |
| 正式入口 | 未接入 | 未修改 `App.tsx`、`main.tsx`、CSP 或托管 URL |
| 远端与私人数据 | 未执行 | 未创建资源、部署或读取、生成、上传、迁移真实生活数据 |

目标 CRUD 聚焦证据不证明托管 Supabase RPC 暴露、PostgREST 错误映射、两用户 Auth/RLS 或 Vercel Preview 行为；这些继续由阶段 E 的独立资源和部署门禁验证。

## 11. 阶段 C 每日状态 CRUD 证据

| 项目 | 结果 | 边界 |
|---|---|---|
| 评分 schema | 通过 | 四项评分从偏离的 0–10 numeric 对齐到批准的 nullable 1–5 smallint；seed/POC 同步 |
| 状态创建 RPC | 通过 | invoker、空 `search_path`、authenticated-only、幂等重放、同日冲突、Owner 隔离、anchors 校验与最小审计 |
| DailyCheckin Repository | 7/7 通过 | 单日读取、日期游标、白名单校验、显式 null、partial revision 更新与写入不重试 |
| Repository foundation | 10/10 通过 | 增加统一只读重试边界和 `checkin_date/id` 批次游标 |
| Daily Check-in Panel | 7/7 通过 | loading、真实空态、显式字段、创建/更新、冲突、同 key 重试和未知值 |
| 每日状态聚焦 | 49/49 通过 | migration 18 + POC 7 + foundation 10 + domain 7 + UI 7；新增 20 项状态相关断言 |
| Life Console 全量 | 211/211 通过 | 29 个 Vitest 文件；应用 Python 90/90；公开 Registry 安装审计 0；生产构建通过 |
| 项目级验证 | 通过 | 根项目校验、治理检查、工具测试 333 项通过且 1 项跳过 |
| PR #40 CI | 通过 | 实现提交 `07ef944` 的 `node`、`python`、`privacy` 全部成功；PR 保持 Draft |
| 正式入口 | 未接入 | 未修改 `App.tsx`、`main.tsx`、CSP 或托管 URL |
| 远端与私人数据 | 未执行 | 未创建资源、部署或读取、生成、上传、迁移真实状态数据 |

每日状态本地证据不证明托管 Supabase 的函数暴露、PostgREST 数值转换、Auth/RLS 或 Preview 网络行为。

## 12. 阶段 C 日记 CRUD 证据

| 项目 | 结果 | 边界 |
|---|---|---|
| 日记创建 RPC | 通过 | invoker、空 `search_path`、authenticated-only、同 key 重放、请求漂移拒绝、Owner 隔离与最小审计 |
| 原子 revision | 通过 | trigger 只接受初始 revision 1 和连续 +1 更新；当前行与写入后完整快照同事务完成 |
| Revision 权限 | 通过 | authenticated 仅 SELECT；不能直接 INSERT/UPDATE/DELETE 历史 |
| Journal Repository | 7/7 通过 | 固定 active list、单条读取、revision 历史、输入校验、RPC 映射、revision 更新和写入不重试 |
| Journals Panel | 6/6 通过 | loading、真实空态、创建、冲突保留、同 key 重试、修订元数据和无撤回入口 |
| 日记聚焦回归 | 45/45 通过 | migration 22 + foundation 10 + domain 7 + UI 6 |
| Life Console 全量 | 228/228 通过 | 31 个 Vitest 文件；应用 Python 90/90；公开 Registry 安装审计 0；生产构建通过 |
| 项目级验证 | 通过 | 根项目校验、治理检查、工具测试 333 项通过且 1 项跳过 |
| PR #40 CI | 通过 | 实现提交 `2bdc307` 的 `node`、`python`、`privacy` 全部成功；PR 保持 Draft |
| 撤回与 D3 | 未实现 | PO 选择本轮不做撤回；字段加密仍需真实数据前独立确认 |
| 正式入口 | 未接入 | 未修改 `App.tsx`、`main.tsx`、CSP 或托管 URL |
| 远端与私人数据 | 未执行 | 未创建资源、部署或读取、生成、上传、迁移真实日记 |

日记聚焦证据不证明托管 Supabase trigger/RPC、PostgREST、Auth/RLS、字段加密或 Preview 网络行为。

## 13. 阶段 C 复盘 CRUD 证据

| 项目 | 结果 | 边界 |
|---|---|---|
| Review RPC | 通过 | weekly/phase 均为 invoker、空 `search_path`、authenticated-only、幂等重放、Owner 隔离与最小审计 |
| 日期约束 | 通过 | weekly 每用户/周起始日唯一；phase 只校验结束日不早于开始日，不推断重叠规则 |
| Review Repository | 5/5 通过 | 固定 active 日期游标、输入校验、RPC 映射、revision 更新和写入不重试 |
| Reviews Panel | 5/5 通过 | 双区块空态、weekly/phase 创建、冲突保留与同 key 重试 |
| 复盘聚焦回归 | 46/46 通过 | migration 25 + foundation 11 + domain 5 + UI 5 |
| Life Console 全量 | 242/242 通过 | 33 个 Vitest 文件；应用 Python 90/90；公开 Registry 安装审计 0；生产构建通过 |
| 项目级验证 | 通过 | 根项目校验、治理检查、工具测试 333 项通过且 1 项跳过 |
| PR #40 CI | 通过 | 实现提交 `158a576` 的 `node`、`python`、`privacy` 全部成功；PR 保持 Draft |
| 正式入口与远端 | 未执行 | 未接入口、创建资源、部署或接触真实复盘数据 |

复盘聚焦证据不证明托管 Supabase RPC/PostgREST、Auth/RLS 或 Preview 网络行为。
