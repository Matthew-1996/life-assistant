# 模块与关键符号

## Life Console 前端

### 应用壳与页面

| 文件 | 关键符号 | 说明 |
|---|---|---|
| `src/main.tsx` | React 入口 | 挂载 `App` |
| `src/App.tsx` | `App` | 获取 Dashboard、维护页面与刷新状态、注入 API client |
| `components/shell/AppShell.tsx` | `AppShell`、`PageId` | 四页全局导航、快速记录入口和页面容器 |
| `features/today/TodayPage.tsx` | `TodayPage` | 今日焦点、生活锚点、待确认事项和快速状态写入 |
| `features/progress/ProgressPage.tsx` | `naturalWeek`、`lineSegments`、`ProgressPage` | 自然周路径、阶段进展、评分与睡眠趋势 |
| `features/records/RecordsPage.tsx` | `JournalCard`、`RecordsPage` | 对话转交、表单新增、语义整理、重试和日记删除 |
| `features/system/SystemPage.tsx` | `SystemPage` | Hub、iCloud、自动化、备份、Google 与移动端边界 |
| `styles.css` | 全局样式 | Apple 风格 token、响应布局、状态和图表样式 |

`App` 默认可使用合成 Dashboard，生产模式通过 `createApiClient()` 访问同源 Hub。页面只操作类型化接口，不直接解析私有文件。

### API 客户端与契约

`src/api/client.ts` 暴露 `LifeConsoleClient`（源码入口：[client.ts](../../apps/life-console/src/api/client.ts)）：

- `dashboard`
- `journal`
- `checkin`
- `preview`
- `enrichmentPreview` / `enrichmentCommit` / `enrichmentStatus`
- `enrichmentRetry` / `enrichNow` / `enrichmentByJournal`
- `deleteJournal`

`createApiClient()` 缓存短时 session，POST 自动附加 CSRF token 和随机幂等键；收到一次 `403` 时只刷新 session 并重试一次。`ApiError` 保留结构化错误体与 HTTP 状态。

`src/contracts/life-console.ts` 由 `contracts/life-console.openapi.yaml` 自动生成，不应手工修改。

## Life Hub

### HTTP 服务

| 符号 | 职责 | 源码位置 |
|---|---|---|
| `LifeConsoleServer` | 持有项目根目录、状态标志、session、幂等缓存、删除计划、确认项和语义 Runtime | [server.py: LifeConsoleServer](../../apps/life-console/hub/server.py) |
| `LifeConsoleHandler` | 服务静态文件，实现 `/api/v1` GET/POST 路由与响应头 | [server.py: LifeConsoleHandler](../../apps/life-console/hub/server.py) |
| `create_server` | 创建并验证回环绑定的服务实例 | [server.py: create_server](../../apps/life-console/hub/server.py) |
| `main` | 解析 CLI 参数、加载语义授权、启动服务 | [server.py: main](../../apps/life-console/hub/server.py) |
| `_validate_journal` | 校验新增日记请求的字段白名单与长度 | [server.py: _validate_journal](../../apps/life-console/hub/server.py) |
| `_validate_checkin` | 校验每日状态字段、revision 和枚举 | [server.py: _validate_checkin](../../apps/life-console/hub/server.py) |
| `_session` | 校验 cookie、过期时间、Origin 与 CSRF | [server.py: _session](../../apps/life-console/hub/server.py) |
| `_receipt` | 将底层工具结果投影为稳定命令收据 | [server.py: _receipt](../../apps/life-console/hub/server.py) |

Server 使用 `ThreadingHTTPServer` 处理请求，但业务写入并发安全由底层文件锁和 compare-and-swap 负责。HTTP 日志被压缩为通用事件，避免正文进入访问日志。

### 安全策略

`hub/security/policy.py` 包含（源码入口：[policy.py](../../apps/life-console/hub/security/policy.py)）：

- `require_loopback_bind`：拒绝非回环监听地址。
- `valid_host`：只接受当前端口的 `localhost`、`127.0.0.1` 或 `::1`。
- `valid_origin`：写请求必须来自同端口回环 Origin。

Handler 还设置 CSP、`nosniff`、`no-referrer` 与 `Cache-Control: no-store`。

### 只读模型

`hub/read_model/dashboard.py` 的核心入口是 `build_dashboard(root, today=None)`（源码入口：[dashboard.py](../../apps/life-console/hub/read_model/dashboard.py)）。它用 `_regular_bytes` 和 `_json_lines` 限制输入为普通文件和白名单字段，用 `_etag` 生成源 revision，并通过 `checkin_conflict_projection` 返回不含自由文本的冲突投影。

### 命令适配

`hub/command_runner/runner.py` 的 `CommandRunner`（源码入口：[runner.py](../../apps/life-console/hub/command_runner/runner.py)）将 HTTP 操作映射到固定 CLI：

| 方法 | 底层能力 |
|---|---|
| `add_journal` | `journal_manager.py add` ([journal_manager.py](../../tools/journal_manager.py)) |
| `delete_journal` | 日记逻辑撤回与受控删除链路 |
| `upsert_checkin` | `daily_checkin.py upsert` ([daily_checkin.py](../../tools/daily_checkin.py)) |
| `purge_plan` | 按目标类型调用对应工具的删除预览 |
| `purge` | 使用冻结的 revision/etag 精确删除 |

`_run` 使用固定 Python 解释器、超时、非交互 stdin 和 JSON 输出。错误被折叠为 `CommandError(code, retryable)`，不会把子进程敏感输出直接返回 UI。

## 语义整理

| 文件 | 关键符号 | 职责 | 源码位置 |
|---|---|---|---|
| `semantic/runtime.py` | `EnrichmentRuntime` | 预览 token、授权门控、提交、状态、重试和启动恢复 | [runtime.py](../../apps/life-console/hub/semantic/runtime.py) |
| `semantic/worker.py` | `SingleConcurrencyWorker`、`process_once`、`run_with_retry` | 单并发执行、错误分类、重试和原子写回 | [worker.py](../../apps/life-console/hub/semantic/worker.py) |
| `semantic/jobs.py` | `create_job`、`update_job`、`iter_recoverable`、`public_view` | 持久作业状态、恢复扫描和安全公共投影 | [jobs.py](../../apps/life-console/hub/semantic/jobs.py) |
| `semantic/source.py` | `read_source`、`assert_fingerprint` | 只读取 active 日记和受控原文块，检测来源漂移 | [source.py](../../apps/life-console/hub/semantic/source.py) |
| `semantic/preview.py` | `build_preview`、`source_fingerprint`、`resolve_model` | 生成离线发送范围和来源指纹 | [preview.py](../../apps/life-console/hub/semantic/preview.py) |
| `semantic/schema.py` | `parse_model_output`、`merge_enrichment` | 严格解析模型 JSON、列表去重与人物别名归一 | [schema.py](../../apps/life-console/hub/semantic/schema.py) |
| `semantic/prompt.py` | `system_prompt`、`build_messages` | 固定 Prompt 版本和模型消息 | [prompt.py](../../apps/life-console/hub/semantic/prompt.py) |
| `semantic/deepseek_client.py` | `ProviderRequest`、`request_enrichment` | HTTPS allowlist、请求体和响应提取 | [deepseek_client.py](../../apps/life-console/hub/semantic/deepseek_client.py#L23-L136) |
| `semantic/keychain.py` | `load_api_key` | 从 macOS Keychain 读取密钥 | [keychain.py](../../apps/life-console/hub/semantic/keychain.py#L20-L54) |
| `semantic/aliases.py` | `load_aliases` | 加载不含原文的人物别名映射 | [aliases.py](../../apps/life-console/hub/semantic/aliases.py) |

`EnrichmentRuntime.mint_preview()` 生成 10 分钟 token；`commit()` 重新校验授权版本与来源指纹；`enrich_now()` 复用相同门控。`SingleConcurrencyWorker` 在写回前再次验证来源，并且只通过 `journal_manager.py amend` 修改索引。

## 原子数据工具

### 日记

`tools/journal_manager.py` 是日记域的唯一写入入口（源码入口：[journal_manager.py](../../tools/journal_manager.py)）。

| 入口 | 作用 |
|---|---|
| `normalize_entry` / `normalize_amendment` | 严格白名单、时间精度、隐私级别和秘密去除 |
| `add_entry` | 写入月度 Markdown、机器 JSONL 索引和可读索引 |
| `amend_entry` | 追加审计更正并重建轻量索引 |
| `withdraw_entry` / `restore_entry` | 逻辑撤回与恢复 |
| `withdraw_latest_implicit` | 按 `recorded_at` 撤回最近一次隐式记录 |
| `purge_plan` / `purge_entry` | 冻结范围、确认后永久删除当前项目副本 |
| `review_plan` / `create_review` | 对闭合自然周或月份生成回顾 |
| `list_entries` | 只输出安全轻量投影 |

日记源采用稳定 ID、受管 Markdown 标记和双索引。待恢复的 purge 操作会阻止其他写入，避免删除期间扩大作用范围。

### 每日、每周和阶段记录

| 工具 | 核心入口 | 主要数据键 | 源码位置 |
|---|---|---|---|
| `daily_checkin.py` | `upsert`、`purge_plan`、`purge`、`week_summary`、`migrate_v2` | 日期 | [daily_checkin.py](../../tools/daily_checkin.py) |
| `weekly_review.py` | `upsert`、`purge_plan`、`purge` | ISO 周一 | [weekly_review.py](../../tools/weekly_review.py) |
| `phase_review.py` | `upsert`、`list_records`、`purge_plan`、`purge` | 复盘日期 | [phase_review.py](../../tools/phase_review.py) |
| `phase_actions.py` | `plan`、`apply_plan`、`mark` | 来源复盘 + 稳定动作 ID | [phase_actions.py](../../tools/phase_actions.py) |

三种台账都使用 JSONL、严格 Schema、文件锁、revision、record etag 和原子替换。相同输入是字节级 no-op；部分字段更新在锁内合并；显式清空需要当前 revision。

`phase_actions.py` 不直接执行目标、提醒或外部变更。它从阶段回答派生待处理动作，`apply_plan` 只读返回动作详情，外部操作验证后再由 `mark` 更新状态。

### 长期认识

`tools/journal_insights.py` 管理从回顾到长期文件的受控状态机（源码入口：[journal_insights.py](../../tools/journal_insights.py)）：

```text
候选 -> accept/reject -> awaiting_proposal -> proposed
     -> apply-plan（只读）-> 外部精确编辑 -> mark-applied
```

`plan` 每次最多返回三个候选；`propose` 只接受白名单目标文件和精确文字；`mark_applied` 会验证目标文件确实包含对应提案。回顾来源漂移会使旧候选或提案进入 `superseded`。

## 健康数据

### 睡眠校准

`tools/apple_health_sleep.py`（源码入口：[apple_health_sleep.py](../../tools/apple_health_sleep.py)）：

- `_parse_summary` 读取小型摘要。
- `_parse_details` 在摘要异常时从两日明细重建最近睡眠段。
- `resolve_device_times` 生成设备入睡与醒来时间。
- `_resolve_field` 按用户是否明确、与设备差值阈值逐字段决定来源。
- `resolve` 输出校准结果，不写每日状态。

设备数据不会推断睡眠质量、精力、情绪、生活实感、离床或生活动作。

### 最小健康历史

`tools/apple_health_history.py`（源码入口：[apple_health_history.py](../../tools/apple_health_history.py)）：

- `_read_source` 解析六行摘要。
- `ingest` 按来源当地日期幂等写入一行。
- `list_records` 返回日期范围内的客观字段。

它只保存生成时间、步数、活动能量、运动分钟和睡眠起止，不进入 Google、网页或 Git。

## 外部展示与运行状态

| 工具 | 职责 | 源码位置 |
|---|---|---|
| `google_sheets_payload.mjs` | 从完整本地源生成确定性批量更新载荷 | [google_sheets_payload.mjs](../../tools/google_sheets_payload.mjs) |
| `google_sheets_state.py` | 管理绑定、同步模式和成功收据 | [google_sheets_state.py](../../tools/google_sheets_state.py) |
| `life_plan_records.mjs` | 将记录台账投影为计划视图 | [life_plan_records.mjs](../../tools/life_plan_records.mjs) |
| `life_assistant_status.py` | 聚合核心、目标、日记、自动化、站点和备份状态 | [life_assistant_status.py](../../tools/life_assistant_status.py) |
| `validate_project.py` | 校验结构、引用、隐私、契约和便携性底线 | [validate_project.py](../../tools/validate_project.py) |
| `portability_doctor.py` | 检查迁移后运行时依赖和关键文件 | [portability_doctor.py](../../tools/portability_doctor.py) |

`life_assistant_status.Section` 聚合 `PASS`、`ATTENTION`、`FAIL` 项；`build_status` 生成结构化报告，`render_markdown` 生成可重建 `STATUS.md`。该工具只输出状态和计数。

## 备份与恢复

`tools/create_backup.py` 先捕获固定字节快照，再扫描秘密、校验日记图和可选台账，最后生成 ZIP、SHA-256 与 manifest（源码入口：[create_backup.py](../../tools/create_backup.py)）。发布归档前会重新验证源身份与内容，检测中途新增、删除或替换。

`tools/verify_backup.py` 先验证 sidecar、ZIP CRC、manifest、成员集合、路径和文件类型，再选择只读返回或解压到全新目录（源码入口：[verify_backup.py](../../tools/verify_backup.py)）。它拒绝覆盖已有目标、符号链接、重复成员和路径穿越。

## 移动端与设计治理

`web/life-dashboard/` 是 Next/vinext 展示脚手架。当前通用代码包括：

- `app/life-date.js`：上海日期、自然日偏移、七日路径和阶段状态。
- `db/index.ts` / `db/schema.ts`：Drizzle 数据层接口。
- `worker/index.ts`：Cloudflare Worker 入口。
- `build/sites-vite-plugin.ts`：托管构建适配。

个人化页面与发布元数据属于私有工作区边界，不能从 Git 克隆恢复。

`docs/design/` 采用三层治理：

1. `apple-top-level-design-system/` 定义 token、组件和图标。
2. `life-console-apple-redesign/` 保存四页已验收静态原型。
3. `life-console-apple-ui-ue-guidelines.md` 约束信息层级、交互、文案和隐私。

React 变更应按这个顺序读取设计依据。
