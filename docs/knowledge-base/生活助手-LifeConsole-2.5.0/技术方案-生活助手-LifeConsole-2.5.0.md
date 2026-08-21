# 技术方案：Life Console 2.5.0

状态：Gate 2 v2 已由 PO 于 2026-08-20 确认，可按本方案进入实现。

## 1. 总体架构

```text
React UI
  ├─ Owner-scoped Supabase repositories
  │    ├─ Todo + status events
  │    ├─ dashboard messages
  │    ├─ journals soft delete / restore
  │    ├─ goals / reviews / daily check-ins / health
  │    └─ backup v3 export
  └─ Owner-authenticated daily-news API
         └─ Vercel Runtime Cache
              ├─ GDELT discovery
              ├─ Xinhua/BBC public-source fallback
              ├─ allowlist → public metadata → DeepSeek summary
              └─ 7-day sanitized Cron run receipts

Owner Agent (Monday 12:00 Asia/Shanghai)
  └─ minimal Supabase reads → upsert_dashboard_message
```

私人数据不进入新闻链路；新闻不进入 Supabase 或个人备份。浏览器只持有现有 Supabase publishable key 和 Owner JWT，不持有 Cron、DeepSeek 或 Unsplash Secret。

## 2. Supabase 数据模型

### `todo_items`

| 字段 | 约束 |
|---|---|
| `id` | bigint identity，主键 |
| `user_id` | `auth.users` 外键，`auth.uid()` Owner 隔离 |
| `title` | 1–240 字符 |
| `priority` | `P0 | P1 | P2`，默认 `P1` |
| `status` | `not_started | in_progress | completed`，默认 `not_started` |
| `planned_start_at` | timestamptz，默认事务当前时间 |
| `due_at` | timestamptz，必填且晚于计划开始 |
| `actual_started_at` | timestamptz，可空，只由状态 RPC 更新 |
| `completed_at` | timestamptz，可空，只由状态 RPC 更新 |
| `revision` | bigint，默认 1，更新时严格 +1 |
| `created_at / updated_at` | timestamptz |

索引：`(user_id, status, priority, due_at, created_at)`、`(user_id, planned_start_at, due_at)`。

### `todo_status_events`

保存 `user_id`、`todo_id`、`from_status`、`to_status`、`todo_revision`、`occurred_at`。只允许数据库 RPC 追加；Todo 软删除另写 `audit_events`，不伪造状态转换事件。

### `dashboard_messages`

保存 `user_id`、`week_start`、`message`、`quote_source`、`image_url`、`image_author_name`、`image_author_url`、`image_platform_url`、`fallback_theme`、`generated_at`、`revision`。`(user_id, week_start)` 唯一；不保存输入快照。

三张表启用 RLS；authenticated 仅能读取自身行。写入由 `SECURITY DEFINER` RPC 完成，函数固定空 `search_path`、首先验证 `auth.uid()`，anon/public 无执行权。

## 3. RPC 契约

- `create_todo(p_idempotency_key, p_title, p_priority, p_planned_start_at, p_due_at)`：复用 `idempotency_keys`，同 key 同请求返回原结果，不同请求拒绝。
- `update_todo(p_id, p_expected_revision, p_title, p_priority, p_planned_start_at, p_due_at)`：不改变状态和实际时间；revision 冲突返回可识别错误。
- `transition_todo(p_id, p_expected_revision, p_status)`：事务内更新状态/实际时间、revision 并写入事件。未开始直接完成时开始/完成时间相同；completed → in_progress 保留开始并清空完成；退回 not_started 清空两者；同状态请求原样返回且不追加事件。
- `soft_delete_todo(p_id, p_expected_revision)`：锁定 Owner Todo，revision 匹配后设置 `deleted_at`、revision +1 并追加不含正文的 `SOFT_DELETE` 审计事件；重复删除幂等返回原结果。
- `upsert_dashboard_message(p_idempotency_key, p_week_start, p_expected_revision, p_message, p_quote_source, p_image_metadata, p_fallback_theme)`：首次插入要求 expected revision 为空；覆盖同周内容必须匹配当前 revision；同幂等请求返回原结果。
- `soft_delete_journal(p_journal_id, p_expected_revision)`：只设置 `deleted_at` 并增加 revision；重复删除幂等。
- `restore_journal(p_journal_id, p_expected_revision)`：清空 `deleted_at` 并增加 revision；未删除记录幂等。

所有 RPC 返回完整更新行；禁止客户端拼接实际时间或直接写状态历史。

## 4. Repository 与领域类型

- `TodoRepositoryPort`：`listToday`、`listAll`、`create`、`update`、`transition`、`delete`、`listStatusEvents`；两个列表固定过滤 `deleted_at is null`。
- `DashboardMessageRepositoryPort`：`getCurrentWeek`、`upsert`。
- `HealthRepositoryPort`：读取 14 天日级指标及 7 天睡眠时刻。
- `DailyNewsClient`：`getDigest({ allowRebuild })`，返回成功、陈旧降级或空态的判别联合类型。
- `JournalRepositoryPort` 增加 `listDeleted`、`softDelete`、`restore`；普通 `list` 固定过滤 `deleted_at is null`。
- Review 投影暴露 `structured_data`，前端仅通过格式化器转换已知中文字段。

新增类型：`TodoPriority`、`TodoStatus`、`DailyNewsDigest`、`DailyNewsItem`、`TrendObservation`。逾期、展示序号与趋势观察均为纯函数派生并单元测试。

## 5. 备份 v3

- 写出格式固定为 `life-console-backup/3`，资源增加 `todo_items`、`todo_status_events`、`dashboard_messages`。
- 读取器接受 v2 和 v3；v2 缺少的新资源按空数组处理，不回写数据库。
- v3 manifest 对每类资源记录计数和 SHA-256；新闻缓存、Secret 和自动化运行状态不进入备份。
- 恢复仍使用现有原子安装、锁和摘要校验；本版本只验证兼容，不执行真实恢复迁移。

## 6. 新闻服务

- `GET /api/cron/daily-news`：要求 `Authorization: Bearer <CRON_SECRET>`；成功或已存在返回 200，鉴权失败 401。
- `GET /api/daily-news`：校验 Supabase Owner JWT；命中缓存直接返回，缺失时通过单飞锁允许一次受控重建。
- `GET /api/daily-news-runs`：复用 Owner JWT 鉴权，默认返回最近 7 天的去敏 Cron 运行记录；传入响应头中的 `runId` 可直接读取对应独立收据，不依赖最近索引。不提供匿名、浏览器缓存或写入能力。
- 三个端点固定同一 Vercel Production 区域；摘要缓存键为 `daily-news:v1:YYYY-MM-DD`，最近成功指针为 `daily-news:v1:last-success`。每次运行收据按随机 run id 单独写入 `daily-news:v1:cron-run:<run-id>`，`daily-news:v1:cron-runs` 只保留最近 32 条的去敏索引；单 Function 实例内并发索引变更串行化，索引逐出不影响已写入的独立收据完成。摘要、收据和索引均保留 7 天。
- GDELT 响应设超时、最大体积和条目上限；三个分类请求按上游公开限制顺序执行，相邻请求至少间隔 5 秒。GDELT 抛错或返回集合无法通过 Top 5 配比校验时，才启动备用发现，不在健康主源请求旁并发浪费外部流量。
- 备用发现只访问固定 HTTPS 入口：新华网科技、财经、时政当前频道页面，以及 BBC Technology、Business、World RSS。每个入口独立超时和体积限制；新华网页面只解析可信文章链接，并以文章公开元数据补齐精确发布时间与描述；BBC 只解析标准 RSS item。新华网旧 RSS 经验证已停更，固定拒绝进入配置。
- 备用入口按来源失败隔离；新华频道在已受 1 MB 响应上限保护的页面中收集全部可信去重文章链接，再按 URL 日期选取最新 2 条，避免首屏旧稿遮挡当日稿件。合并后的 URL 仍执行 HTTPS、可信域名、24 小时窗口、canonical URL、标题指纹、分类和国内/国际配比校验。若不足 5 条或缺少任一必需分类/范围，整体失败，不向 DeepSeek 发送半成品。
- DeepSeek 使用独立新闻 Schema；公开输入按不可信数据包裹，输出逐字段校验，摘要超过 160 字拒绝而非截断补义。
- 全链路失败返回最近成功缓存；没有缓存返回结构化 `empty`，不得返回半成品候选。
- Cron 在鉴权成功后先写 `running` 收据，随后更新为 `success | stale | empty | failed`。字段固定为随机 run id、开始/结束时间、结果状态、候选来源、失败阶段、稳定错误码、摘要日期和生成时间；禁止保存标题、URL、片段、模型请求/响应、环境变量、Owner 标识或 Secret。若 Function 在结束前被硬终止，`running` 收据保留以显示未正常收口。
- `DailyNewsRunStorePort` 封装 Runtime Cache 的开始、完成和最近记录读取；写收据失败不得改变新闻结果，但 Cron 响应必须用稳定的 `run_receipt_unavailable` 标记可观测性降级。Runtime Cache 是运维级、可逐出的 7 天记录，不声明审计级永久持久化，也不进入个人备份。
- Owner 与 Cron 两个可能触发重建的 Function 最长执行时间为 60 秒，仍保持同一 Production 区域。Runtime 固定 GDELT 单请求 5 秒、分类间隔 5 秒、发布方单请求 4 秒、DeepSeek 12 秒，主源三分类、备用两阶段与摘要的最坏外部等待预算为 45 秒，为解析、缓存和收据收口预留时间。超时从请求开始覆盖到流式 body 读取完成，响应体在读取时逐块校验上限；不允许无限重试。

## 7. 每周寄语 Agent

- 由 Codex 自动化在周一 12:00 Asia/Shanghai 运行，晚于既有 11:15 周复盘任务。
- 读取仅限活跃目标、未完成 P0/P1 Todo、最近周复盘；生成完成后调用 `upsert_dashboard_message`。
- Unsplash Key 只从 macOS Keychain 读取；查询词使用通用主题，不含目标、Todo 或复盘文本。
- 自动化创建前核对规范 Prompt、RRULE、`next_run` 和上海本地时间；该动作需要独立 PO 确认。
- 自动化使用 Owner Keychain 会话调用 `life_console_cloud.py` 的最小投影读取与 revision-safe 寄语 RPC；成功只返回去敏保存收据，不把上下文写入 Supabase、iCloud 或 Git。

## 8. 前端与 CSP

- Today、Records、Progress 拆为页面容器和聚焦组件；Repository 注入继续由 `App` 统一装配。
- Supabase 认证只保留一个应用级生命周期：AuthGate 使用的 `LifeConsoleAuthService` 在 Session 恢复、认证事件和显式登录时更新仅存于内存闭包的 access token；新闻客户端复用同一服务的 `getAccessToken()`。服务内部以 revision 防止迟到 Session 覆盖更新的登录、刷新或退出事件，并用事件结束进行中的 Token 回退。Token 不进入 `AuthSession`、React state、DOM、日志、备份或知识库；退出后立即清空。
- Records 头部使用单栏 hero，对话式记录之后直接装配现有 `SupabaseJournalsPanel`，Supabase 模式继续注入 Owner-scoped `JournalRepositoryPort`，不修改线上读写契约。
- `candidate-preview` 仅根据公开 dashboard fixture 创建页面生命周期内的内存 `JournalRepositoryPort`；其更新、软删除和恢复只修改内存数组，重新挂载即重置。全局候选写入拦截仅对该本地演示区域放行，区域内不持有 client、JWT 或外部存储引用。
- 今日锚点继续读取 `daily_checkins.anchors` 并复用现有 check-in 更新与 revision 冲突链路；填写进展为四个 key 中非空值的派生计数，不新增存储字段。
- 内容区达到 1180px 才使用 Todo/新闻、记录/复盘和趋势双栏；不足时转为上下布局。所有 Grid 子项使用 `minmax(0, …)`，长文本允许换行；只有甘特和睡眠表允许卡片内部滚动，页面根节点不得横向滚动。
- 样式拆为 token、共享组件、页面样式；禁止在浏览器引入运行时 Schema 编译。
- Production CSP 保持 `script-src 'self'`；`img-src` 只新增 `https://images.unsplash.com`，不增加 `unsafe-eval`、通配域名或 data 以外的新协议。
- 增加本地 favicon，关闭当前非阻断 `/favicon.ico` 404。

## 9. 兼容、失败与回滚

- 所有数据库变更为加法；旧客户端忽略新表，v2 备份继续可读。
- migration 在事务内创建表、策略、函数和权限；重复检查不得产生第二份对象。
- 发布失败时恢复上一 Vercel Production，停用 Cron/寄语自动化；新表保留休眠，不删除数据或逆转软删除。
