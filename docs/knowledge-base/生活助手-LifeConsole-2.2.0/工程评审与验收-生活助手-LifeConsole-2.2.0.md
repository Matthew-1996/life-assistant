# 工程评审与验收 - 生活助手 - Life Console - 2.2.0

> 状态：Gate 2 已确认 / 阶段 A-E 候选验收通过 / PR #40 已合并 / 阶段 G Production 部署与登录后 E2E 通过，真实数据迁移门禁待执行
> 当前证据：本地纯合成 PGlite/supabase-js、东京测试项目 migration/seed/权限矩阵/Advisors、新版 Vercel Preview 的邮箱密码登录、四页只读 E2E 与恢复路由；东京 Production 空库已应用 `0001`-`0004`，唯一已确认 Owner 与 profile 已建立，回滚型托管权限矩阵 13/13 通过，正式 Site URL 与精确 recovery redirect 已保存并刷新读回；独立 Vercel Production 已使用 Production-only 公开变量部署并 READY，稳定 alias、未登录密码 Gate、恢复路由 rewrite、精确 CSP 与安全头已读回；Production Owner 登录后四页访问、目标 CRUD（create→read-after-refresh→update标题→archive→持久化）、logout 功能均已通过；窄屏（<720px）响应式布局触发 `overflow-x: clip`，无横向滚动；372 个 JS/TS Vitest + Python 测试全部通过，隐私扫描与 `git diff --check` 通过；密码恢复改密流程实际走通（发送重置邮件→Recovery 会话→设置新密码→新密码登录）；恢复邮件 token 全链路未单独重测、真实迁移/回滚演练/最终切源仍待独立门禁

## 1. 工程评审结论

PO 已确认 Gate 1 的 PRD/D1-D8，以及 Gate 2 的 O1-O5、Q1-Q7、本测试矩阵和 A-G 阶段计划，并于 2026-08-12 单独授权阶段 E 的独立 Supabase 测试资源、纯合成 migration/seed 与 Vercel Preview。托管数据库、Vercel Preview 技术链路和 Owner Magic Link 会话先完成历史验证；原登录后页面因错误使用第二套 CRUD 测试壳而不符合既定设计，产品 UI 验收记为失败。后续已改为邮箱密码 Owner 登录并完成单界面纠偏，新版 Preview 四页只读 E2E 与恢复路由通过；双账号浏览器、恢复邮件和移动端专项仍不冒充完成。

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
- D3 已选择仅依赖 RLS，区域与 Free `US$0` 套餐已确认；若精确私有来源清单、真实读取/上传、最终切源或资源删除尚未获 PO 当次确认，则阻断对应步骤。

## 7. 本轮验收

| 项目 | 状态 | 说明 |
|---|---|---|
| PRD/需求/设计/技术/测试草案 | 通过 | 已形成 2.2.0 唯一版本知识库 |
| 官方兼容性核对 | 通过 | 已核对 Supabase changelog、RLS、Data API、Auth、Edge Function、备份及 Vercel Vite/环境文档 |
| Supabase 资源 | 通过 | 独立东京测试项目已创建并保持纯合成；未记录项目 ID 或凭据 |
| 托管数据库 migration、seed 与测试 | 通过 | 三个 migration、两名不可登录占位身份、幂等 seed 与 13/13 权限矩阵完成 |
| Vercel Preview | 通过 | 隔离 Preview READY、安全头、Owner 邮箱密码登录、单界面四页只读 E2E 与恢复路由通过；业务写入、恢复邮件、双账号浏览器和移动端专项仍延期 |
| 真实数据、切源、删除 | 未执行 | 明确禁止 |
| 本地 PostgreSQL/RLS 合成 POC | 通过 | 7 项；Owner/非 Owner/anon、upsert、调用者权限 RPC |
| supabase-js 浏览器契约 POC | 通过 | 4 项；OTP、publishable key、重试关闭、CSP 阻塞识别 |
| `life-console-backup/1` 合成 POC | 通过 | 八类业务资源、canonical NDJSON/manifest、摘要/计数、ZIP 与既有 Agent 原子恢复 round-trip |
| 完整本地 Supabase 栈 | 阻塞 | 本机无 Docker；未安装机器级依赖 |
| 托管候选与大陆网络 | 条件通过 | 东京 migration、权限矩阵与 Preview 完成；当前网络可打开 Auth Gate，登录后分时网络样本待补 |

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

## 14. 阶段 D 合成备份 POC 证据

| 项目 | 结果 | 边界 |
|---|---|---|
| 一致性快照读取 | 通过 | 单次调用现有 invoker RPC；非法 schema/资源 fail closed；只读瞬时失败最多额外尝试一次 |
| 兼容资源集合 | 通过 | 固定八类业务资源；排除 `profiles`、`backup_runs`、审计、幂等、认证和会话状态 |
| NDJSON 与 manifest | 通过 | UTF-8、递归键排序、紧凑 JSON、LF 结尾、逐资源 count/SHA-256 和 canonical content digest |
| ZIP 安全边界 | 通过 | 固定成员路径与 STORE 模式；合法高重复正文可恢复，既有 Agent 仍拒绝截断、重复成员、路径穿越、符号链接、摘要/计数错误和外部超限压缩包 |
| 原子恢复 round-trip | 通过 | TypeScript 生成包由既有 Python Agent 在显式临时目录安装，字节一致；失败保留旧备份 |
| 规模档位 | 通过 | 空资源、小规模与单资源 2,000 条纯合成记录均完成打包与校验 |
| 聚焦回归 | 通过 | backup + production migration 35/35；Local Agent 9/9 |
| Life Console 全量 | 通过 | 34 个 Vitest 文件、252/252；应用 Python 92/92；生产构建通过 |
| 项目级验证 | 通过 | 根工具测试 329/329；公开 Registry 安装审计 0；项目、diff 与隐私检查通过 |
| PR #40 CI | 通过 | 修复提交 `80a478a` 的 `node`、`python`、`privacy` 全部成功；PR 保持 Draft |
| UI/远端/真实路径 | 未执行 | 未接正式入口、下载、CSP、Supabase/Vercel 资源、部署或真实 iCloud |
| 私人数据与 D3 | 未执行 | 仅合成记录；未读取、生成、上传或迁移真实日记/健康数据；字段加密仍是独立门禁 |

阶段 D 证明用户可迁移包的本地格式兼容与恢复安全边界，不证明托管 RPC/PostgREST、浏览器真实下载、Vercel 响应头、桌面 Agent 探测、真实 iCloud 权限或真实数据恢复。

## 15. 阶段 E 远端候选验收

| 项目 | 当前状态 | 验收证据或剩余条件 |
|---|---|---|
| 独立 Supabase 测试项目 | 条件通过 | 东京 `ap-northeast-1`、健康状态、Data API 开启、自动暴露新表关闭与自动 RLS 启用已复核；当前树已去敏，但早期活动分支提交中的非秘密资源显示名仍待 PO 确认历史处置 |
| Production migration | 通过 | 三个版本化 migration 已应用；12 表、14 个契约索引、GRANT、RLS、trigger 与 authenticated-only RPC 和本地契约一致 |
| 纯合成身份与 seed | 通过 | 两个无密码且不可登录的 A/B 占位身份继续用于权限矩阵；另由 Dashboard 官方路径预创建并自动确认一个邮箱密码 Owner，仅用于浏览器候选验收；未使用真实生活数据 |
| 托管权限矩阵 | 通过 | 13/13：anon、Owner、非 Owner、换绑、物理删除、revision、幂等、trigger 与导出 RPC；事务回滚后计数不变 |
| Supabase Advisors | 条件通过 | 无 security error；Performance 只有新项目 `unused_index` info；公开注册已关闭，Owner 通过邮箱密码登录 |
| Supabase Candidate 构建 | 通过 | 邮箱密码 Gate、忘记密码/恢复路由、四类 Repository 与既有四页产品界面已合并；最新全量 Vitest 39 文件 328/328、应用 Python 92/92，常规构建通过 |
| CSP/CORS | 通过 | Preview 响应头只放行精确 Supabase HTTPS/WSS Origin，无通配符；`no-referrer`、`nosniff`、`DENY` 与 `noindex` 读回通过 |
| Owner 浏览器认证 | 通过 | 公开注册关闭；Dashboard 预创建并自动确认 Owner。密码 API 与浏览器登录成功，工作台、记录、进展、系统四页正常加载；凭据未进入 Git |
| 原 Preview 产品 UI | 失败 | 登录后错误渲染独立 CRUD 技术壳，未复用 2.1.0 四页产品；只认可 Auth/Repository 技术链路，不认可产品 UI |
| 单界面纠偏 | 通过 | 删除独立产品壳与死代码面板，四页复用既有 App；覆盖真实空态、写后刷新、历史日期 revision、幂等重试、跨午夜、会话草稿与退出确认；新版 Preview 四页只读 E2E 已通过 |
| 新版 Vercel Preview | 通过 | 最新候选部署 READY；Site URL 与 recovery allowlist 已同步。邮箱密码登录、四页只读 Supabase REST 请求和 `/auth/recovery` SPA rewrite 通过；Production 未变化 |
| 忘记密码邮件 | 延期 | `/auth/recovery` 页面可达；PO 明确选择本轮暂不发送恢复邮件，因此不把邮件投递、回跳 Token 或实际改密冒充为已验收 |
| PR CI | 通过 | 提交 `4914800` 后 `privacy`、`node`、`python` 全部成功；PO 已授权 PR #40 转 Ready，合并状态 CLEAN |
| Production、真实数据与切源 | 阶段 G 进行中 | PR #40 已合并；PO 已确认新建东京 Free `US$0` Production、D3 仅依赖 RLS 和完整迁移切源目标。精确私有来源清单、真实读取/上传、最终切源和资源删除仍待分步证据与门禁 |

PO 于 2026-08-13 明确确认 2.2.0 候选验收通过，随后授权 squash 合并 PR #40；PR 已合并为 `bdfbf79e5d37aae65d7513ba9ef162a07bfb5f3e`。PO 同日确认新建东京 Free `US$0` Production Supabase、D3 仅依赖 RLS 和完整迁移切源目标；这些决策允许阶段 G 规划和逐门禁执行，不替代精确私有来源清单、真实读取/上传、最终切源和资源删除确认。

### 阶段 G 上线验收矩阵

| 工作块 | 当前状态 | 通过条件 |
|---|---|---|
| 上线计划与决策落盘 | 进行中 | PR 合并、东京 Production、D3 仅 RLS、完整迁移切源目标及剩余门禁与事实一致 |
| Production 套餐与费用 | 已确认 | PO 选择 Free `US$0`，接受闲置暂停与无平台自动备份限制；Production 已创建，旧合成测试项目已提交暂停 |
| Production Supabase | 条件通过 | 东京项目健康；Data API 开启、自动暴露新表关闭、自动 RLS helper/event trigger 存在、公开注册关闭；`0001`-`0004` 已应用，12/12 表启用 RLS、31 条 policy、anon 表授权 0。已创建唯一且自动确认的 Owner，通用 `0004` 以 Auth 总数 1、确认数 1 为 fail-closed 门禁并建立唯一 active Owner profile。回滚型托管权限矩阵 13/13 通过，执行后仍为 Auth 1、确认用户 1、profile 1、业务行 0；正式 Site URL 与唯一精确 `/auth/recovery` redirect 已保存并刷新读回，无通配符。Advisors 仅有空库 `unused_index` 提示 |
| 迁移工具 | 待开发 | 显式 manifest、dry-run、canonical digest、幂等导入、回读校验和合成 TDD 全部通过 |
| 私有备份与 dry-run | 待独立门禁 | 来源范围获批；备份可验证；dry-run 不上传且 count/digest/错误报告完成 |
| 回滚演练 | 待执行 | 合成导入后只移除本次 migration run，远端恢复导入前计数，iCloud 保持不变 |
| 真实完整迁移 | 待独立门禁 | 冻结写入、禁止双写；所有批准资源的条数、ID、revision、关系和摘要核对通过 |
| Vercel Production | 通过 | 独立项目仅配置 Production 范围的 Supabase URL 与 Sensitive publishable key；经受测 JSON 配置生成、Production prebuild 与 prebuilt deploy 后 READY，稳定 alias 已切换为 `https://project-wpabq.vercel.app`。首页和 `/auth/recovery` 均 200，rewrite、精确 Supabase HTTPS/WSS CSP、`no-referrer`、`nosniff`、`DENY` 与 HSTS 已读回；未登录浏览器显示邮箱密码 Gate 且无 fatal console error。Owner 使用重置密码流程设置新密码后登录成功，四页（工作台/记录/进展/系统）正常加载；目标 CRUD 全链路验证通过（create→硬刷新 read-after-write 持久化→update 标题保存→archive→硬刷新归档持久化）；logout 功能验证通过；密码初始错误后重置邮件→Recovery 会话→设置新密码→新密码重登全流程实际走通。窄屏（<720px）响应式布局触发 `overflow-x: clip`，scrollWidth 等于 innerWidth 无横向滚动；390×844 因 Electron 浏览器限制无法精确 resize，但 720px 断点以下的响应式 CSS（min-width:0 + overflow-x:clip）已就位，633px 实际宽度验证无溢出。恢复邮件 token 从点击邮件链接到改密的全链路未单独重测（本轮实际通过用户手动点击邮件完成改密） |
| 最终切源 | 待再次确认 | 上述证据齐全并向 PO 展示后取得新的明确确认 |

阶段 G 任一工作块失败即停止后续步骤。最终切源前 iCloud 始终是唯一真相源；知识库只记录去敏结论，不记录真实项目标识、路径、凭据、记录内容或迁移报告原文。

首次候选发布因部署白名单漏含纯合成 fixture 且干净环境暴露 Vite/Vitest 配置类型问题而失败；补齐 fixture 并将 `defineConfig` 改从 `vitest/config` 导入后发布成功。修复 Auth 文案时第一次直接文件树仍漏带该 fixture，读取去敏构建日志后在第二次发布补齐。最终修复版 Preview READY，Supabase Site URL 已同步，Production 创建记录保持不变。失败部署只保留平台历史记录，本轮未获授权删除资源。

并行全量 Vitest 首轮有 Miniflare smoke 与跨语言备份回环各一项超过默认 5 秒；两项隔离复测均通过，随后单工作线程全量 36 个文件、260/260 通过，证明是本机并行资源争用而非断言失败。应用 Python 75+7+9+1=92 项通过，三类构建均通过；额外回归确认纯合成 seed 重放不会重复写入。

首次单界面纠偏基线的全量回归为 39 个 Vitest 文件、279/279，应用 Python 75+7+9+1=92 项，静态四页基线 Playwright 1/1。最终多轮审查关闭数据一致性、草稿耐久性、冲突比较、分页竞态、跨夜目标日期、乱序刷新和 pending 输入丢失等 P1，并删除不再接入生产树的旧每日状态面板。邮箱密码改造后，最新本地门禁为 39 个 Vitest 文件 328/328、应用 Python 92/92、常规构建、`git diff --check` 与隐私扫描通过；提交 `4914800` 的 Draft PR 标准 CI 也全部通过。浏览器证据覆盖新版 HTTPS Preview 的 Owner 密码登录、四页产品只读加载、Supabase token/REST 请求与恢复路由；未执行业务写入、恢复邮件、双账号浏览器或移动端尺寸专项，不冒充这些范围已验收。当前文件树已去敏；真实数据、Production、切源和资源处置仍需独立门禁。
