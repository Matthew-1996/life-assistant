# 工程评审与验收 - 生活助手 - Life Console - 2.0.0

> 状态：技术方案评审已通过 / 阶段 A 通用开发、Miniflare 与 Playwright 合成验证完成 / 阶段 B 已由 PO 确认条件通过 / 阶段 C 已获 PO 授权并开始执行
>
> 适用范围：通用仓库代码、合成数据测试、治理与隐私检查；真实数据迁移与验收仅在 iCloud 私有环境 + Sites owner-only 会话执行，证据不复制到 Git。

## 1. 技术评审结论

| 评审项 | 当前结论（草稿） | 持续门禁 |
|---|---|---|
| 架构 | Sites Worker + D1/R2 单真相源架构符合 2.0.0 目标；iCloud 日常为单向冷备，区域故障时只承载应急追加事件 | 不允许 iCloud 成为临时真相源；应急事件恢复后必须受控导入 D1，冲突人工处理 |
| 数据模型 | 12 张表覆盖 goals/journals(+revisions)/daily/weekly/phase/health(days+segments)/idempotency/audit/backup/migration；统一 UUID+revision+soft-delete；命名、类型、索引设计完整 | 新增字段必须走 D1 迁移脚本版本化；禁止手工 ALTER |
| 加密 | AES-256-GCM + DEK/KEK 分层；恢复包 PBKDF2 1M 迭代；Worker 端不落地明文；符合最小明文索引原则 | 密钥轮换后必须验证旧 kid 数据全部重加密；审计 log 不含正文字段 |
| 身份与会话 | Owner-only ChatGPT Sites session + Worker CSRF + Origin 校验 + 限流/防重放；会话 15 分钟无操作自动登出 | 所有写 API 必须校验会话；OPTIONS 预检响应不过早放行 |
| 冲突、幂等与审计 | revision 单调 + 409 语义清晰；Idempotency-Key 24h；audit_events 追加式且不含正文 | 409 响应必须携带最新 revision；Idempotency Key 跨 owner 不共享 |
| 删除与迁移 | 7 天删除计划 + 硬删除二次确认；单向迁移 6 阶段状态机 + 7 天回滚窗口；VALIDATING 阶段五项强校验 | 切源必须 PO 当次明确确认；硬删除前审计事件必须写入成功 |
| 可恢复性 | R2 保留 3 份最新完整备份 + 月度归档；恢复包离线验证；Sites 版本历史可一键回滚 | 备份 ZIP 与恢复包均加密；SHA-256 校验记录在 R2 metadata |
| 隐私 | GitHub 仅保存通用代码与方案；恢复包口令、Sites Secret、真实数据不进 Git；日志仅记录 hash | 提交前必跑 `check_git_privacy.sh --history origin/main..HEAD` |

## 2. 测试方案

### 2.1 静态与治理检查（任何 PR 必须通过）

```bash
# 在 worktree 根目录执行
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH"
python3 tools/check_project_governance.py
python3 tools/validate_project.py
tools/check_git_privacy.sh
tools/check_git_privacy.sh --history origin/main..HEAD
git diff --check
```

### 2.2 Worker / 加密 / D1 单元测试

```bash
cd apps/life-console
npm run test:worker     # node:test 运行 worker/ 下的单元与合成夹具
# 覆盖：
#   1. AES-GCM 加解密 round-trip
#   2. DEK/KEK wrap/unwrap；不同 kid 不能互相解密
#   3. revision 校验：相同 revision 不更新；旧 revision 返回 409
#   4. Idempotency-Key：相同 Key 24h 内返回相同 cached_response
#   5. 审计事件：CREATE/UPDATE/DELETE/PURGE 均正确追加，不含正文字段
#   6. 迁移状态机：六阶段转换；非法转换返回 400
#   7. 删除计划：7 天内不可 purge，过期后可 purge，取消计划可撤销
```

### 2.3 合成数据集成测试（Miniflare）

```bash
cd apps/life-console
npm run test:integration:miniflare
# 步骤：
#   1. 用 Miniflare 启动本地 D1 + R2 + Worker 模拟
#   2. 执行 D1 迁移脚本建表
#   3. 注入合成 KEK（测试专用，与生产无关联）
#   4. 生成 200 journals / 180 health_days / 30 goals / 90 daily / 12 weekly / 4 phase
#   5. 跑以下链路：
#      - 正常 CRUD × 每类资源
#      - 并发写冲突：两个客户端同时更新同一 journal revision N → 一方 409
#      - 幂等：同一 POST /journals 重复 10 次 → 只有 1 条
#      - 删除计划：journals/1 删除 → 7 天后可 purge → 取消 → 再删 → purge
#      - 密钥轮换：注入 v2 KEK → 渐进重加密 → 验证 100% kid 变为 v2
#      - 搜索：tags/mood/date 范围搜索正确；搜索产生 audit SEARCH 事件
#      - 迁移模拟：从合成 iCloud JSON fixture 迁移到 D1 → VALIDATING 全通过
#      - 回滚模拟：SWITCHED 后写入新 journal → rollback → 验证回滚 JSON 导出
```

### 2.4 前端合成测试

```bash
cd apps/life-console
npm run test:ui            # Vitest + RTL
npm run test:e2e:synthetic # Playwright 合成端口
# 覆盖：
#   1. 四页导航与快照：视觉与 1.0.0 差异阈值 ≤ 0.5%（核心区域）
#   2. 写交互四态：草稿预览 → 保存中 → 成功 / 409 差异卡片 / 失败重试
#   3. 系统页六分区渲染：真相源、加密、冷备、迁移向导、审计摘要、系统信息
#   4. 恢复包流程 UI：至少16位口令 → 允许受信任密码管理器填充 → 生成 → 下载 → 验证
#   5. 系统页 footer 显示 revision + 同步状态
```

### 2.5 Life Console 构建 & Sites 预览

```bash
cd apps/life-console
npm run build:sites-200
# 产物必须：
#   1. dist/client/assets/index-*.js 存在
#   2. 不存在 life-console-snapshot.json（2.0.0 不再用只读快照）
#   3. worker/sites-200.js 入口引用正确
#   4. dist/server 包含 Worker 入口、lib 与 routes；2.0.0 不携带只读 snapshot
```

### 2.6 阶段 A 首个实现工作块证据（2026-08-11）

| 验证项 | 结果 |
|---|---|
| Sites Worker 安全壳测试 | 3/3 通过；SPA fallback、安全响应头、API 默认 `503 implementation_pending`、静态写方法拒绝 |
| D1 初始迁移结构测试 | 6/6 通过；12 张表、敏感密文字段、审计最小字段、初始真相源、外键和备份去重约束 |
| Vitest 全量 | 62/62 通过 |
| Python Hub | 75/75 通过 |
| macOS 打包测试 | 7/7 通过 |
| 合成 E2E | 1/1 通过 |
| 默认构建 | 通过 |
| Sites 2.0.0 构建 | 通过；生成 `dist/client` 与 `dist/server/index.js`，且不生成 1.1.0 `life-console-snapshot.json` |
| 治理 / 隐私 / diff | 全部通过 |

边界：本证据仅覆盖 IMPL-A1/A2，不代表 Worker API、加密、真实身份、D1 运行实例、R2、部署或迁移已经完成。

### 2.7 阶段 A 通用开发收口证据（2026-08-11）

| 验证项 | 结果 |
|---|---|
| Vitest 全量 | 85/85 通过；含 OpenAPI、隐私 fixture、Worker 安全壳、AES/恢复包、Sites API 与 React UI |
| Worker 合成链路 | 19 项通过；覆盖 Owner-only 失败关闭、CSRF/同源、幂等、revision 409、CRUD、Health segments、审计筛选、迁移/回滚、R2 完整备份、加密 ZIP 恢复包与预配置 v2 KEK 轮换 |
| D1 Schema / Hub Python | 75/75 通过；其中 D1 结构 6/6 |
| macOS 打包 / 既有合成 E2E | 7/7、1/1 通过 |
| Sites 本地工具 | 5/5 通过；应急 CREATE_ONLY 队列 3 项、版本化 iCloud 冷备代理 2 项 |
| 默认构建 | 通过 |
| Sites 2.0.0 构建 | 通过；生成 `dist/client` 与模块化 `dist/server`，不生成 `life-console-snapshot.json` |

已实现边界：通用 Worker/D1/R2 接口、合成密钥加密、前端双模式、加密草稿、系统管理 UI 和单向冷备代理。未执行边界：正式 Owner 会话、真实 D1/R2、真实 KEK、Sites 部署、真实 iCloud 读取/迁移、切源与删除真实数据。

测试策略差异：当前 Worker 集成测试使用 Node `node:sqlite` D1 适配器与 R2 mock，不伪造正式 Cloudflare 绑定；Miniflare、签名下载 URL 与浏览器级 Sites E2E 留到阶段 B/C 候选环境验证。因此阶段 A 通用开发完成，但阶段 A 最终验收清单仍不宣称全部完成。

### 2.8 阶段 B 本地候选预览证据（2026-08-11）

| 验证项 | 结果 |
|---|---|
| 候选模式 | 新增 `candidate-preview` 构建；仅加载仓库内合成投影，不构造 Local/Sites API client |
| 强制只读 | App 捕获写表单与写按钮，写控件显示只读样式，触发时只显示「只读预览模式：候选不可写」 |
| 静态 Worker | `/api/*` 恒定 403，非 GET/HEAD 静态请求恒定 405；CSP 为 `connect-src 'none'` |
| Vitest | 93/93 通过；新增候选 UI 2 项、候选 Worker 4 项（含旧 `dist/` 清理）、系统布局 2 项 |
| Python / 打包 / 合成 E2E | 75/75、7/7、1/1 通过 |
| 构建 | 默认构建、Sites 2.0.0 构建和候选构建全部通过 |
| 浏览器检查 | 四页导航通过；系统页显示 `mode=CANDIDATE_PREVIEW · 合成数据`；写动作仅显示只读提示；恢复包确认项为紧凑单行；迁移前置检查采用“标题+状态首行、说明独立次行”，5 项边界测量均无重叠；网络请求中没有 `/api/` |
| 治理 / 隐私 / diff | 全部通过 |

本节记录本地候选证据；线上部署与权限证据见 §2.10。

### 2.9 Miniflare 与 Playwright 合成验证证据（2026-08-11）

| 验证项 | 结果 |
|---|---|
| Miniflare | 26/26 通过；真实 workerd + D1 + R2 绑定，覆盖 Owner/CSRF/Origin、CRUD、密文落库、revision 409、幂等、审计、备份队列、完整备份、恢复包、KEK 轮换、迁移回滚与删除计划/purge |
| Playwright | 2/2 通过；真实 Chrome 加载 Sites 构建并通过 Miniflare Worker 写入 D1；覆盖目标保存后刷新读取，以及 journal 新建→编辑→409→删除计划→取消→再计划→提前 purge 409→计划到期→purge 成功 |
| Trace | `trace: on`；每次合成 E2E 生成本地 trace，`test-results/` 已忽略，不进入 Git |
| 浏览器兼容 | 优先读取 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`；macOS 可复用本机 Chrome，其他环境回退到 Playwright Chromium |
| 网络与数据边界 | 合成服务器仅监听 `127.0.0.1:47821`；使用临时 D1/R2、合成 KEK 与合成 Owner；未访问真实 Sites、Cloudflare、iCloud 或私人数据 |

### 2.10 阶段 B 私有 Sites 候选证据（2026-08-11）

| 验证项 | 结果 |
|---|---|
| 项目隔离 | 新建独立 Sites 候选项目并发布 version 1；正式项目版本号读回保持不变 |
| 源与构建 | 部署源提交与 Draft PR #37 的候选提交一致；归档仅含 `dist/client`、`dist/server`与当地 hosting 绑定 |
| Owner 访问 | Sites 权限读回为当前用户=Owner、白名单 1 人、0 组、0 外部访客；Owner 授权 `GET /` 返回 200 |
| 未登录访问 | `GET /` 返回 401，由 Sites SIWC 门禁拦截 |
| 已登录非 Owner | 当前没有第二个已登录、不在白名单的身份可供实测；不将未登录 401 冒充为非 Owner 403 |
| 候选 API 边界 | Owner 授权 `GET /api/v1/bootstrap` 返回 403 + `candidate_preview_read_only` |
| 环境变量 | Sites 生产环境变量为 0 项；未配置 KEK 或其他 Secret |
| D1/R2/iCloud | 候选 Worker 仅使用 `ASSETS`，不引用 D1/R2；前端仅加载合成 fixture，不构造 API client；本次未读取或迁移 iCloud 数据 |

精确 URL、响应码与时间戳保存在 iCloud 私有 `outputs/` 验收记录，不进入 Git。阶段 B 当前为「条件通过」：候选部署、Owner 可访问和无真实资源绑定已验证；尚待第二身份补验已登录非 Owner 403。

## 3. 六阶段交付验收方法

### 阶段 A：合成数据联调

验收人：QA + 前后端 Agent
证据：本地 Terminal 输出 + 合成 E2E 视频（不包含真实数据）
清单：
- [ ] Worker 单元测试（§2.2）全部通过（≥30 case，覆盖率 ≥ 85%）
- [x] Miniflare 集成测试（§2.3）全部通过（26 case，加密链路无失败）
- [ ] 前端合成测试（§2.4）全部通过（≥40 case，409 差异卡片有截图）
- [x] 合成 E2E 链路：新建→编辑→冲突→删除计划→取消→再删→purge 有 Playwright trace
- [ ] 隐私检查：合成 D1 导出 JSON 中 `content_encrypted` 无法肉眼阅读
- [ ] 治理检查：§2.1 全部通过

### 阶段 B：候选不可写预览

验收人：QA + PO
证据：截图（不泄露 Sites project ID 细节）
清单：
- [x] 部署到临时 Sites 项目或子路径（不影响生产 URL）
- [x] Owner 授权访问候选首页返回 200
- [x] 所有写控件变灰，点击显示「只读预览模式：候选不可写」toast（本地候选验收）
- [x] 系统页显示 `mode=CANDIDATE_PREVIEW · 合成数据`（本地候选验收）
- [ ] 非 owner 登录尝试访问 → 403

### 阶段 C：Owner-only / 密钥 / 备份校验

验收人：PO + 后端 Agent
证据：**不进 Git**；PO 本地终端 / 浏览器手动记录
清单：
- [ ] 部署到正式 Sites URL（旧 Life Dashboard 原位替换为候选状态）
- [ ] Owner-only 验证：非 owner 账号尝试访问 `/api/v1/auth/me` → 403
- [ ] KEK 生成并写入 Sites Secret：`wrangler secret list` 显示 KEK_JOURNAL_V1 / KEK_HEALTH_V1 已存在
- [ ] 下载恢复包 → 压缩包加密（打开 ZIP 需要口令）→ 验证通过
- [ ] R2 bucket 创建成功；签名 URL 5 分钟后失效验证

### 阶段 D：真实迁移计划展示 + 迁移前确认

验收人：PO + PMO
证据：系统页截图（仅展示通用字段，不展示真实数据数量）
清单：
- [ ] 系统页显示迁移向导步骤 1：迁移计划表格完整展示（行数、预计耗时、回滚窗口）
- [ ] 二次勾选「我已阅读迁移计划并理解 7 天回滚窗口与单向切源规则」存在且默认为未勾选
- [ ] 未勾选时「开始迁移」按钮禁用
- [ ] 步骤 2 前置检查：4 项（Sites/KEK/R2/iCloud）全部 PASS
- [ ] PO 明确口头+书面确认（勾选后点击开始即视为确认）

### 阶段 E：上传校验 + 切换真相源

验收人：PO + QA + 后端 Agent
证据：系统页 + 私有验收台账（research/XXX-迁移验收记录.md，不进 Git）
清单：
- [ ] VALIDATING 进度条完成，五项校验（数量/ID/revision/哈希/KEK round-trip）全部 PASS
- [ ] READY-TO-SWITCH 状态下，「切换真相源」按钮弹出二次确认 + 输入 `CONFIRM SWITCH` 文字框
- [ ] SWITCHED 后系统页显示 `真相源 = SITES_D1_PRIMARY`
- [ ] 回滚窗口 = SWITCHED 时间 + 7 天，倒计时正确
- [ ] 创建一条测试日记 → revision+1 → audit_events 新增 → backup_exports 队列新增 → 同步代理首次执行 SUCCESS（或 PENDING 1 分钟内转为 SUCCESS）
- [ ] iCloud 对应目录可看到该测试日记冷备副本（单向写入成功）
- [ ] 尝试用 1.0.0 原子工具写回 iCloud → 不应该回灌到 D1（验证单向）

### 阶段 F：覆盖现有 Sites URL + 旧展示关闭

验收人：PO
证据：浏览器并排对比截图
清单：
- [ ] `https://life-compass-cn-2026...` 打开后显示 Life Console 2.0.0（不再是旧 Life Dashboard 单页看板）
- [ ] 系统页 footer 显示版本 2.0.0
- [ ] 旧 Dashboard 构建脚本与 worker 入口已从 2.0.0 代码中移除
- [ ] 文档 `docs/operations/product-surfaces.json` 已更新为 `life-console = active primary, mode = SITES_D1_PRIMARY`；旧 life-dashboard = archived

## 4. 回退时的验收清单

- [ ] 点击系统页「回滚到 iCloud 真相源」（7 天内可用）
- [ ] 二次确认对话框：「我理解回滚后将失去 D1 中 X 条新写入（已导出到 R2）」
- [ ] 回滚完成后系统页显示 `真相源 = ICLOUD_PRIMARY (ROLLED_BACK)`
- [ ] D1 写入接口返回 405 Method Not Allowed（只读模式）
- [ ] R2 导出 `rolled-back-pending/batch-*.json.enc` 下载成功，解密后可人工审阅 manifest 与增量记录

## 5. 隐私扫描与合规（必须在 PR 合入前通过）

- [ ] `tools/check_git_privacy.sh` 当前索引通过（0 条私有路径、0 条凭据）
- [ ] `tools/check_git_privacy.sh --history origin/main..HEAD` 历史通过
- [ ] 2.0.0 文档中不出现：真实 iCloud 路径、真实 Sites project ID、真实用户名/邮箱、KEK/Token 字面量
- [ ] 合成测试 fixture 与真实个人数据无交集（人名/日期/地点均为合成且可识别）

## 6. 上线与合入证据

每个最终 PR 至少记录：
- 变更范围（文档 / Worker API / D1 Schema / 前端 / 迁移 / 部署脚本）
- PO 门禁状态（已确认哪些）
- 知识库更新（六类文档中的哪几类有变更）
- 隐私检查结果（索引+历史）
- Python/Worker/Life Console 测试数量与通过数
- 未覆盖边界（明确列出）

CI 只证明通用检查通过；阶段 C/D/E/F 的真实部署与迁移证据保存在私有 iCloud research/ 目录，不进 Git。

## 7. PO 阶段 A 确认记录

- 确认结论：通过阶段 A 通用开发结果确认。
- 确认日期：2026-08-11。
- PO 原话：`好的，我确认签字，把 PR 转为 Ready`。
- 授权范围：
  - 将本文件 §2.7 所列通用代码、合成测试与知识库变更提交并推送到 PR #36。
  - PR #36 保持 Ready for review，进入代码评审与 CI 验证。
- 不包含：
  - 不授权正式 Sites 部署、Owner 会话绑定、真实 D1/R2 绑定或真实 KEK 生成。
  - 不授权读取或迁移真实 iCloud 数据、切换真相源、永久删除真实数据或合并 PR。
  - 阶段 B/C/D/E/F 继续遵循各自的 PO 当次确认门禁。

## 8. PO 阶段 B 本地候选验收记录

- 验收结论：阶段 B 本地候选预览通过验收。
- 验收日期：2026-08-11。
- PO 原话：`已完成验收`。
- 已验收范围：
  - 四页候选工作台、合成数据标识与候选不可写提示。
  - 所有写动作被只读边界拦截，不调用 `/api/`。
  - 系统页恢复包确认项为紧凑单行布局。
  - 独立迁移向导前置检查采用“标题+状态首行、说明独立次行”，无文字重叠。
- 未包含：
  - 未验收独立私有 Sites URL、Owner 登录或非 Owner 403。
  - 未授权阶段 C 的正式 Owner-only、D1/R2、真实 KEK、恢复包或备份校验。
  - 未授权真实 iCloud 读取/迁移、真相源切换、正式 URL 覆盖、永久删除、合并或发布。

## 9. PO 阶段 B 私有 Sites 候选授权与结果

- 授权日期：2026-08-11。
- PO 原话：`继续 Life Console 2.0.0 阶段 B。使用 agent/life-console-200-preview 创建一个新的独立私有 Sites 候选项目，部署 candidate-preview 构建。不得覆盖正式 URL，不绑定真实 D1/R2/KEK，不读取 iCloud。部署后验证 Owner 可访问、非 Owner 返回 403，并记录阶段 B 验收证据。`
- 已执行：独立私有候选项目、`candidate-preview` version 1 部署、Owner 授权 200、候选 API 403、权限及 0 环境变量读回。
- 已隔离：正式 Sites 项目未保存新版本、未部署、未修改权限；未配置真实 D1/R2/KEK；未读取或迁移 iCloud 数据。
- 未完成：未登录请求返回 401，不等于“已登录非 Owner 403”；当前缺少第二个非 Owner 身份，因此本阶段结论为「条件通过」，不虚报 403 验收。
- PO 收口确认：2026-08-11，`暂时没有第二个账号，保持当前“条件通过”吧`。因此 403 实测作为已披露限制延期，不再阻塞阶段 B 收口，也不视为已通过的测试项。

## 10. PO 阶段 C 授权记录

- 授权日期：2026-08-11。
- PO 原话：`合并并且进入阶段c`。
- 已执行：
  - PR #36 与 PR #37 已按堆叠依赖顺序合并到 `main`。
  - 已从最新 `origin/main` 创建独立分支 `agent/life-console-200-stage-c` 和对应 worktree。
- 阶段 C 授权范围：
  - 将 Life Console 2.0.0 部署到正式 Sites URL，保持迁移前候选状态。
  - 验证 Owner-only 会话边界；已登录非 Owner 403 因缺少第二身份可继续按已披露限制记录。
  - 创建并绑定空白 D1、私有 R2 和真实 `KEK_JOURNAL_V1` / `KEK_HEALTH_V1` Sites Secret。
  - 执行恢复包加密、解密验证和 R2 五分钟签名 URL 失效校验。
- 不包含：
  - 不读取或迁移真实 iCloud 数据。
  - 不执行阶段 D 的迁移计划确认、阶段 E 的上传校验或真相源切换。
  - 不把恢复口令、KEK、Sites Secret、真实资源标识或私有验收原文写入 Git。
  - 不永久删除真实数据，不把 `source_truth` 切换为 `SITES_D1_PRIMARY`。
