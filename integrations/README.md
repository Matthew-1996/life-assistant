# 外部展示连接

> 后续 Agent 执行 Google 表格同步前，先读同目录的 `GOOGLE_SYNC_SOP.md`：它给出插件可用性判定、载荷生成、按序写入、读回验证、`mark-success` 与换机重建的固定步骤。

当前生活计划采用两层结构：

- 当前 iCloud 项目中的 `GOALS.md`、`journal/` 与 `records/` 是唯一真相源；
- 私人 Google 表格只是可重建的只读展示层，不接受反向录入。

`google-sheets.json` 只保存可迁移策略、表格 ID 和链接，不保存 OAuth 凭据、令牌或用户日记原文。首次导入成功前保持 `pending_connection`；只有原生 Google 表格已创建、八个页面存在且关键范围读回验证成功后，才能通过 `tools/google_sheets_state.py activate` 写入表格标识并切换为 `active`。

每次记录先完成 iCloud 本地写入，再运行 `node tools/google_sheets_payload.mjs` 生成固定范围的派生载荷。载荷同时声明 `Asia/Shanghai` 时区与日期/时间列格式；连接器先应用 `spreadsheet_properties` 和 `format_updates`，再处理 `clear_ranges`、`value_updates` 并读回 `verification_ranges`。日期继续保存为可排序日期值并显示为 `yyyy-mm-dd`，时间继续保存为可排序时间值并显示为 `hh:mm`，不得把 `46236` 或小数序列直接展示给用户。载荷只包含现有生活计划视图允许展示的内容：目标与路线展示、每日结构化状态、用户明确周复盘以及轻量日记索引；不包含日记原文、苹果健康摘要/明细、Prompt、凭据或聊天原文。

Google 同步失败不回滚本地写入。没有成功收据、或当前三类源哈希与最近成功收据不一致时，状态为待刷新；下一次记录重试。现有 `生活计划表.xlsx` 保留为迁移前快照与手工 Numbers 备选，不再作为日常同步真相。

外部读写优先走已安装并已连接的 Google Drive/Sheets 插件或连接器，不把浏览器手工编辑当作正常同步方式。插件未安装、未连接、缺少权限或没有暴露所需读写能力时，先请用户完成相应安装、连接或授权；本地 iCloud 写入仍照常完成，Google 展示层保持待刷新。
