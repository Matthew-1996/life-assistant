# Google 表格按需同步操作手册

本手册描述把 iCloud 真相源刷新到私人 Google 表格的固定流程。当前生命周期是 `paused/on_demand`：只有用户明确要求刷新时执行，普通记录和自动化不触发同步。

## 1. 边界与前置

- iCloud 本地写入是唯一真相源，必须先完成；Google 失败不回滚本地结果。
- 读取 `integrations/google-sheets.json`，确认绑定的是用户自己的原生私人表格且 `sync_cadence=on_demand`。
- 读取 `docs/operations/product-surfaces.json`，确认 Google 仍是按需派生。若两者冲突，停止同步并修复生命周期，不自行切换为自动模式。
- 不把浏览器手工编辑当作正常同步方式；优先使用已安装并已连接的 Google Drive/Sheets 插件或连接器。

## 2. 生成确定性载荷

```bash
node tools/google_sheets_payload.mjs
```

载荷包括表格属性、格式更新、清空范围、批量值、读回范围、三类本地源快照与整体指纹。载荷不得包含日记原文、Apple Health、Prompt、凭据或聊天原文。

## 3. 幂等应用与读回

绑定表的八个页面必须齐全：`总览 / 阶段路线 / 两周行动 / 每日记录 / 每周复盘 / 使用说明 / 扩展规划 / 日记索引`。

严格按顺序执行：

1. 应用 `spreadsheet_properties`；
2. 应用 `format_updates`；
3. 依次清空 `clear_ranges`；
4. 批量写入 `value_updates`；
5. 读回 `verification_ranges` 并与载荷比对。

不得创建公开链接、共享给他人、反向读取表格补写 iCloud，或把日期/时间序列号直接显示给用户。

## 4. 成功收据

只有写入与读回全部成功且本地源没有漂移，才通过 stdin 调用：

```bash
python3 tools/google_sheets_state.py mark-success
```

传入载荷中的 `spreadsheet_id`、`payload_sha256` 和完整 `sources`。工具会重新核对本地源；变化时拒绝陈旧收据。`integrations/google-sheets.sync-state.json` 只保存同步收据，不成为真相源。

## 5. 失败口径

- 插件不可用、未连接或无权限：本次按需刷新未完成；本地记录仍成功，不自动重试。
- 部分范围写入或读回不一致：整体视为失败，不发放收据，不声称已同步。
- 用户之后再次明确要求刷新时，从生成新载荷开始重做，不沿用旧源快照。

## 6. 换机

项目文件和同步协议随 iCloud 迁移；插件安装、OAuth 授权和本机运行时不随项目迁移。新机器只在首次按需刷新时重新连接插件并完成一次写入与读回验证，不复制旧机器凭据或绝对路径。
