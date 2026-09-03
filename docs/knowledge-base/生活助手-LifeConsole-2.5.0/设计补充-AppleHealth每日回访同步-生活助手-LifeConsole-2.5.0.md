# 设计补充：Apple Health 每日回访同步

状态：书面规格已获 PO 于 2026-08-26 在对话中确认；实现候选及本地/合成门禁已在 Draft PR #76 完成，待 PO 实施验收；Production migration、私有 Prompt/运行任务更新、真实 Owner 写入/回读与 LaunchAgent 卸载均未执行。

## 1. 背景与快速维护判断

Life Console 2.3.0 已把 Apple Health 汇总的唯一线上真相源确定为 Supabase，现有 `health_days` 表、Owner RLS、唯一日期约束和进展页只读 Repository 已上线。但当前只有 iPhone → iCloud 六行摘要与一次性迁移，没有持续的 iCloud → Supabase 写入接口；本地归档任务又早于 iPhone 更新执行。因此 Production 活动趋势只能读取切源时已有的历史行。

本项按 2.5.0 快速维护处理：它补齐已批准数据边界内缺失的持续写路径，不新增健康类别、不改变页面信息架构、不修改表结构，也不恢复已搁置的每日新闻。新增 authenticated-only RPC 和每日回访步骤仍分别经过 migration、真实写入、PR 合并与运行任务变更门禁。

## 2. PO 已确认范围

- 只修复功能上线后的未来数据，不补写任何历史日期。
- 同步并入每天 14:00（Asia/Shanghai）的生活状态回访，不再依赖独立本地归档任务。
- 输入只来自当天有效的 iCloud 六行摘要。
- 允许写入的最小字段只有：`steps`、`active_energy`、`exercise_minutes`、`sleep_start`、`sleep_end`；`generated_at` 只作来源版本。
- 使用现有 macOS Keychain Owner Session 和 Supabase publishable key；不把密码、Access Token、Refresh Token、service role 或其他 Secret 放入 iPhone 快捷指令、Prompt、日志、Git 或响应。

非目标：历史回填、完整 Apple Health 导出、健康分段导入、心率/HRV/体重等新类别、由活动值推断行动锚点、修改进展图表、浏览器直接读取 iCloud、后台静默重试过去日期。

## 3. 方案选择

采用“每日回访 + Owner-scoped RPC”。回访任务已有固定 14:00 节奏、项目工作目录和 Owner Keychain 会话，能在提问前执行一个不调用模型的数据同步命令。数据库 RPC 自行使用 `auth.uid()`，客户端不提交 Owner ID。

未采用：

- 独立 LaunchAgent：实际调度曾早于 iPhone 文件更新，形成双任务状态和额外运维面；PO 已选择合并到每日回访。
- iPhone 直接写 Supabase：需要在快捷指令中保存或刷新认证材料，扩大凭据暴露和维护风险。
- 客户端直接 REST insert/update：必须额外获取 Owner ID，并难以在并发、来源新旧和 revision 更新之间保持单事务。

## 4. 数据流与组件

```text
iPhone 快捷指令（约 13:30）
  → iCloud apple-health-latest.txt
  → 每日回访 14:00 调用本地同步命令
  → 固定六字段解析、当天校验
  → Owner JWT + authenticated-only RPC
  → public.health_days 当天唯一行
  → 进展页现有 HealthRepository 只读展示
```

### 4.1 本地解析与命令

在 `tools/life_console_cloud.py` 增加 `health-day` 子命令，接收固定 `--source` 和 `--expect-today`。解析复用 `apple_health_history.py` 的单一普通文件、大小、UTF-8、固定键、非负数、上海时区与日期校验；不得通过 stdout、stderr 或异常输出具体健康值。

命令内部直接把规范化对象交给 `CloudClient.upsert_health_day`，不把中间 JSON 交给模型或写入临时文件。成功回执只含 `status`、`resource`、`action`、`date` 和 `revision`；失败只返回闭集 `stale_source`、`invalid_source`、`unauthenticated`、`conflict` 或 `unavailable`。

### 4.2 Supabase RPC

新增 `upsert_health_day_v1(p_health_date, p_generated_at, p_summary)`：

- `SECURITY INVOKER`、空 `search_path`、只授权 `authenticated`，撤销 `PUBLIC` 与 `anon` 执行权。
- 由数据库读取 `auth.uid()`；未认证立即拒绝。
- `p_health_date` 和 `p_generated_at` 必须都是 `Asia/Shanghai` 当天；过去或未来日期均拒绝。
- `p_summary` 只允许五个白名单键；三项活动只能为 null 或非负数，步数必须为整数；睡眠时间只能为 null 或含时区的有效时间。
- 以 `(user_id, health_date)` 为唯一目标；同日首次创建 revision 1。
- 同一 `generated_at` 且内容相同返回 `unchanged`，不增加 revision。
- 同日更晚的 `generated_at` 更新同一行并将 revision 严格加一；更早来源返回 `stale_source`，不得覆盖。
- 使用事务级 Owner+日期锁收口同日并发；响应不返回 `summary`。
- `source_revision` 保存规范化 `generated_at`，不保存完整原文件、设备名或原始载荷。

该 migration 只新增函数和权限，不新增、删除或改写表列、索引、RLS 策略和历史行。

### 4.3 每日回访 Prompt

在提问和睡眠校准之前执行一次 `health-day --expect-today`：

- `status=saved`（`action` 为 `created`、`updated` 或 `unchanged`）：继续原回访，不展示具体设备数值。
- 源文件缺失、无效或不是当天：不调用 Supabase，继续回访并短提示“今日健康数据未同步”。
- 云端失败：不回退写入 iCloud 历史、不重试过去日期，继续回访并报告稳定失败状态。
- 当天人工重新运行每日回访时允许幂等重试；跨日后 RPC 拒绝上一日输入。

新的真实链路通过验收后，卸载 `local.life-assistant.apple-health-history`。保留已有 `apple-health-history.jsonl` 和 plist 备份，不删除历史数据；运行任务变更与卸载须在发布后单独验证。

## 5. 隐私与安全边界

- iCloud 文件和具体健康值只在本机解析器与 TLS 请求体中出现；对话、Git、PR、测试 fixture、日志和回执只保存去敏结构与状态。
- 只用 publishable key + Owner JWT；RLS 和 RPC 双重绑定 `auth.uid()`，禁止 service role、管理 SQL 或绕过 Owner Session。
- 测试只使用合成日期与数值；Production 验收只在 PO 确认 migration、任务变更和当次真实写入后进行。
- 未提供值保持 null，不从睡眠、每日状态、旧文件或均值推断活动指标。
- 写入成功必须由 RPC 回执和 Owner-scoped 回读共同证明；网络超时、冲突或无法回读均不得报告已同步。

## 6. 失败处理与恢复

| 失败 | 行为 |
|---|---|
| iCloud 文件缺失、陈旧、重复键或格式异常 | 不发云端请求；回访继续；提示未同步 |
| Owner Session 缺失或刷新失败 | 返回 `unauthenticated`；不本地补写、不输出认证材料 |
| 来源比已存同日版本更早 | 返回 `stale_source`；保留线上较新行 |
| revision/并发冲突 | 返回 `conflict`；仅允许当天人工重跑 |
| Supabase 不可用或回读失败 | 返回 `unavailable`；不声称成功、不补历史 |
| Mac/Codex 14:00 未运行 | 当日不自动补写；符合“不补历史”范围 |

回滚时先移除每日回访中的同步步骤，保留已写 `health_days` 行和加法 RPC；任何函数撤销或 Owner 数据删除都另行审批。旧本地归档任务不自动恢复，除非 PO 重新选择本地历史用途。

## 7. 测试与验收

严格 TDD，先观察以下红灯：

1. Python 解析/CLI：有效当天文件只发一次 RPC；陈旧、未来、缺失、重复键、非法数值不发请求；stdout/stderr 不含健康值或 Token。
2. CloudClient：请求只含日期、生成时间和五键 summary；回执去敏；认证、冲突、不可用映射为闭集状态。
3. SQL/PGlite：anon 拒绝、Owner A/B 隔离、仅当天、字段白名单、同值幂等、更新 revision +1、旧来源拒绝、同日并发单行。
4. migration：干净数据库和 2.5.0 基线均可应用；重复 schema 验证无额外表列或权限扩张；托管权限矩阵覆盖函数授权。
5. Prompt 契约：同步发生在提问前；只调用 `--expect-today`；失败不阻断回访、不补历史、不泄露数值。
6. 全量门禁：治理、当前与历史隐私、Python、Vitest、Production build；本项没有前端变化，不以静态 Preview 冒充真实 Owner 写验收。

发布分层：

1. Draft PR 与本地合成门禁。
2. PO 审阅实现与测试结论。
3. PO 当次确认后应用 authenticated-only RPC migration。
4. PO 当次确认后合并代码并更新正式每日回访 Prompt。
5. 在当天有效摘要上执行一次真实 Owner 写入并回读，只报告日期、action、revision 和字段存在性；确认进展页次日开始形成连续活动样本。
6. 新链路成功后卸载旧本地归档任务并读回运行状态。

## 8. 完成标准

- 从启用日开始，每次有效每日回访最多写入一个当天 `health_days` Owner 行。
- 同日重跑幂等，较新摘要可更新，较旧摘要不能覆盖。
- 缺失或失败不影响回访，不回填历史，不产生本地第二真相源。
- Life Console 无需前端改动即可在 14 天活动趋势中读取新增行。
- 凭据、健康值、Owner 标识和服务资源 ID 不进入 Git、PR、日志或对话证据。

## 9. Implementation evidence

- Parser/CLI: targeted Python tests passed (49); full tools discovery passed (397, 1 skipped); receipts contain no health values or credentials.
- Database: PGlite behavior and permission tests passed within the fresh full Vitest run (81 files / 619 tests); migration only adds one function and grants.
- Prompt contract: synthetic validator tests passed (12, included in the targeted Python count); private Prompt remains gated and unmodified.
- Frontend: no source changes; the existing `health_days` reader remains the consumer.
- Builds: default and Supabase Production builds passed (129 modules each).
- Implementation commits: `6054133af29aca16aa372756a25a7d4de72140b8`, `68ddbee55927fede6b9c30ff7afc6e1b592b05da`, `a11e8da3a8291d1009aea5c5c74f56b0fc2b3fa3`, `2b7521f99c9eae7d7d6daae185fedc1d3b8f3b96`, `211b9a18386521ca12a83e82edf648d829f0edf8`, `669c83f0094f89507db4ac7623478b9acf0a332b`, `3ebf23f3a5a3ab247594d6d5b1a1e76ca35381ed`, `d9405624fc17336156f88c32c067933ea236e68b`, `c935c6c7e21747e94c582d75973b2fb471525af7`, `4dafdd96dcc9c048fd253b9855e177a04cbf11c7`, `c0d527d6e1ae6c5978b82c5e6472417c53dd2749`.
- Release state: Draft PR only; Production migration, runtime update, real write and LaunchAgent unload not performed.
