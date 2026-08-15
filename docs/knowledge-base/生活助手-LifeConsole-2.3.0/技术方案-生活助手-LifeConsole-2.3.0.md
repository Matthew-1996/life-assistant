# 技术方案：Life Console 2.3.0

## 数据与防重

在日记、目标和两类复盘增加 Owner-scoped `record_key` 唯一索引；迁移跟踪改为 `(table_name, source_stable_id)` 全局唯一。每日状态沿用日期唯一，复盘沿用周期唯一。日记增加 `metadata`，复盘增加 `structured_data`，每日状态增加四个睡眠字段。revision 快照使用整行 JSONB。

迁移补偿必须先删 `journal_revisions` 再删 `journals`，任何补偿错误都升级为迁移失败，不得忽略。清理使用单事务和固定前置断言；canonical 优先选择已有成功迁移追踪的记录。

## 写入与认证

React Repository 与本机 `CloudClient` 使用相同 Supabase REST/RPC。Owner access/refresh session 只进入 macOS Keychain；浏览器只持有普通 Owner 会话；禁止 service-role。回执只返回 `saved/conflict/unauthenticated/unavailable`、资源类型与 revision。

## 备份

`export_life_console_snapshot()` 以 invoker 权限返回 schema 2 的八类资源一致性快照。Agent 生成 canonical NDJSON、资源 SHA-256 和 `life-console-backup/2` 清单，由 `BackupStore` 校验并原子安装 latest；替换前把已验证 latest 保存为 previous。每六小时以及手动请求处理一次。恢复只进入隔离目录。

## 安全

Git、PR、文档与日志不保存真实内容、邮箱、Token、服务标识或完整 URL。生产预检只输出计数和结构断言；原文只在 Owner 会话、数据库和 iCloud 私有备份之间流动。
