# 工程评审与验收 - 生活助手 - Life Console - 2.2.0

> 状态：Gate 2 已确认 / 阶段 A 首个开发块进行中
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
