# Google 表格同步操作手册（供后续 Agent 复用）

本手册是把 iCloud 真相源刷新到私人 Google 表格“生活计划表”展示层的**可迁移固定流程**。它与 `integrations/README.md`、`AGENTS.md` 第 21 条一致，只描述“怎么做”，不保存任何凭据、令牌或日记内容。任何 Agent 在需要同步 Google 表格时，先读本手册再动手。

## 0. 一句话现状

- Google Drive/Sheets 连接能力以 **Codex 插件**形式存在，注册在机器本地 `~/.codex/config.toml`：
  `[plugins."google-drive@openai-curated"] enabled = true`。
- 该插件的调用工具**只在标准 Codex 运行时（模型 `gpt-5.6-sol`）的会话里暴露**。当会话运行时被切换到第三方模型（例如通过 `shell_environment_policy` 注入的 Anthropic 兼容端点）时，插件工具**不会出现在工具列表里**，此时无法直接驱动同步。
- 因此“同步失败”通常不是“没装插件”，而是**当前会话运行时没有加载该插件**。判定方法见第 2 步。

## 1. 前置：先完成 iCloud 本地写入

任何记录（日记新增、每日状态、周/阶段复盘等）都以 iCloud 本地原子写入为准，**本地成功即算成功**。Google 表格只是单向派生的只读展示层，同步失败绝不回滚本地台账。

## 2. 判定当前会话能否直接同步

在当前会话枚举可用工具，检查是否存在 google-drive / sheets 相关工具：

- **能看到插件工具** → 进入第 3 步，本会话直接同步。
- **看不到插件工具**（如运行时被 override 成第三方模型）→ 不要用浏览器手工代替（违反第 21 条）。改为下列任一：
  1. 让用户在**标准 Codex 会话（`gpt-5.6-sol`）**里发起同步，该会话能加载 `google-drive@openai-curated` 插件；
  2. 或由用户提供该连接器作为 MCP server 的 `server_name` / `tool_name`，用 `run_mcp` 调用；
  3. 或暂缓，展示层保持“待刷新”，下次记录自动重试。

## 3. 生成确定性载荷

```bash
node tools/google_sheets_payload.mjs > /tmp/gs_payload.json
```

载荷字段（只读，不含日记原文/健康明细/凭据/聊天原文）：

- `spreadsheet_properties`：`locale=zh_CN`、`timeZone=Asia/Shanghai`
- `format_updates`：日期列 `yyyy-mm-dd`、时间列 `hh:mm`（保存为可排序序列值，不把序列号直接展示）
- `clear_ranges` → `value_updates` → `verification_ranges`
- `source_snapshots`：journal / daily / weekly 三源的存在性与 SHA-256
- `payload_sha256`：整份载荷指纹（`mark-success` 时回填）

## 4. 用插件/连接器应用载荷（严格按顺序，幂等）

绑定表必须是 `integrations/google-sheets.json` 里的私人原生表（`spreadsheet_id` 固定），八个页面齐全：
`总览 / 阶段路线 / 两周行动 / 每日记录 / 每周复盘 / 使用说明 / 扩展规划 / 日记索引`。

1. 应用 `spreadsheet_properties`（locale / 时区）；
2. 应用 `format_updates`（日期/时间列格式）；
3. 依次清空 `clear_ranges`；
4. 批量写入 `value_updates`；
5. 读回 `verification_ranges`，与载荷比对。

不得创建公开链接、不得共享给他人、不得把表格当作真相源、不得改用浏览器手工编辑。

## 5. 只有“写入 + 读回都成功且源未漂移”才发放收据

```bash
# payload 里的三个字段原样传入
python3 tools/google_sheets_state.py mark-success <<'JSON'
{"spreadsheet_id": "...", "payload_sha256": "...", "sources": { ... }}
JSON
```

- `mark-success` 会重新读取本地三源快照并与传入 `sources` 比对；**同步期间本地源变化则拒绝发放陈旧收据**。
- 成功后 `integrations/google-sheets.sync-state.json`（0600 权限）记录本次收据。
- 用 `python3 tools/google_sheets_state.py status` 查看：`current`（已同步）/ `stale`（源已变，需重试）/ `pending_initial_sync`。

## 6. 失败与回执口径

- 插件不可用 / 未连接 / 无权限：本地写入仍算成功，回执明确“**Google 表格待刷新**”，下次记录重试；每日自动化只在状态为 `stale/pending` 时补一次重试，不新增高频任务。
- 部分范围写入或读回不一致：视为失败，不发放收据，如实逐项回执，不把整体说成已同步。

## 7. 换机 / 重建（可迁移性）

- 本手册、`google_sheets_payload.mjs`、`google_sheets_state.py`、`google-sheets.json`、`README.md` 都在 iCloud 项目内，随项目迁移。
- 插件注册（`~/.codex/config.toml` 的 `[plugins."google-drive@openai-curated"]`）是**机器本地状态**，不进项目、不进备份。换机后在新机器的 Codex 里重新启用该插件并完成一次 Google 授权即可；本项目不保存其 OAuth 凭据。
- 换机后如需验证展示层：先跑第 1、3 步确认本地源与载荷生成正常，再在标准 Codex 会话执行第 4、5 步。

## 8. 严禁

- 不把日记原文、Apple Health 摘要/明细、Prompt、凭据、聊天原文写入载荷或本手册。
- 不在插件可用时改用浏览器手工维护。
- 不把 Google 表格当作真相源或反向录入入口。
- 不将机器本地插件配置或任何令牌复制进项目、日志或长期记忆。
