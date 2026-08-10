# 外部展示连接

> 后续 Agent 执行 Google 表格同步前，先读同目录的 `GOOGLE_SYNC_SOP.md`：它给出插件可用性判定、载荷生成、按序写入、读回验证、`mark-success` 与换机重建的固定步骤。

当前生活计划采用两层结构：

- 当前 iCloud 项目中的 `GOALS.md`、`journal/` 与 `records/` 是唯一真相源；
- 私人 Google 表格只是可重建的只读展示层，不接受反向录入。

`google-sheets.json` 只保存可迁移策略、表格 ID 和链接，不保存 OAuth 凭据、令牌或用户日记原文。首次导入成功前保持 `pending_connection`；只有原生 Google 表格已创建、八个页面存在且关键范围读回验证成功后，才能通过 `tools/google_sheets_state.py activate` 写入表格标识并切换为 `active`。

当前生命周期固定为 `paused/on_demand`，并与 `docs/operations/product-surfaces.json` 一致：普通日记、状态和复盘只写 iCloud，不自动运行 Google 同步，也不制造“待刷新”任务。只有用户明确要求查看或刷新 Google 表格时，才运行 `node tools/google_sheets_payload.mjs` 并按 SOP 应用载荷。工具仍保留 `active/every_record` 兼容能力，但恢复自动模式属于未来生命周期变更，必须先取得用户明确确认并同步更新生命周期契约，不能由 Agent 自行切换。

实际刷新载荷声明 `Asia/Shanghai` 时区与日期/时间列格式；连接器先应用 `spreadsheet_properties` 和 `format_updates`，再处理 `clear_ranges`、`value_updates` 并读回 `verification_ranges`。日期继续保存为可排序日期值并显示为 `yyyy-mm-dd`，时间继续保存为可排序时间值并显示为 `hh:mm`，不得把序列号直接展示给用户。载荷只包含现有生活计划视图允许展示的内容：目标与路线展示、每日结构化状态、用户明确周复盘以及轻量日记索引；不包含日记原文、苹果健康摘要/明细、Prompt、凭据或聊天原文。

按需同步失败不回滚本地写入，也不自动安排下次重试；只说明本次展示刷新未完成，等待用户下次明确要求。`paused/on_demand` 下源变化不算同步欠账。现有 `生活计划表.xlsx` 是唯一长期本地可视化工作簿，只在用户明确要求更新、导出或恢复时按需重建，不是日常同步真相。

实际需要刷新时，外部读写优先走已安装并已连接的 Google Drive/Sheets 插件或连接器，不把浏览器手工编辑当作正常同步方式。只有当前按需请求发生时，插件未安装、未连接、缺少权限或没有暴露所需读写能力才请用户完成相应安装、连接或授权；普通记录不触发这些连接要求。

## 按篇 DeepSeek 语义整理（启动授权）

按篇主动触发的 DeepSeek 日记语义整理默认**关闭**，且是逐篇外发个人日记原文的动作，与 Google 只读派生展示不同。它的启动开关由可迁移配置 `integrations/journal-enrichment.json` 决定，工具为 `tools/journal_enrichment_state.py`（仅标准库，原子 0600 写入）。

- 该配置只保存：`lifecycle_state`（`disabled`/`active`/`paused`）、provider 固定 `deepseek`、生产模型白名单选择（`deepseek-v4-flash`/`deepseek-v4-pro`），以及一条授权记录（版本、外发确认标志、授权时间）。它**不保存 API Key**（Key 仅在 macOS Keychain，服务名 `life-console-deepseek`、账户 `deepseek-api-key`），也不保存任何日记原文或摘要。文件与 `google-sheets.json` 一样只留在 iCloud，不进 Git。
- 启用需用户当次明确确认外发：`python3 tools/journal_enrichment_state.py enable`（stdin 传 `{"acknowledge_external_send": true}`，可选 `"model"`）。成功后生成新的授权版本；Life Hub 启动时读取该配置，`active` 才把授权版本交给运行时，commit/retry 才可能真正发送。
- 随时关闭用 `pause`（保留配置与模型选择，但立即撤销授权，遗留旧预览无法再提交）；彻底清除授权用 `disable`。`disabled`/`paused`/配置缺失或损坏时，Hub 一律取不到授权（fail-safe，不外发）。
- 换机恢复：Keychain 是机器本地状态，需在新机重新用 `security add-generic-password -s life-console-deepseek -a deepseek-api-key -w '<KEY>' -U` 写入；`integrations/journal-enrichment.json` 随 iCloud 迁移，但如需重新确认外发，可再次 `enable` 生成新授权版本。
