# 技术方案：Life Console 2.3.0

## 数据与防重

在日记、目标和两类复盘增加 Owner-scoped `record_key` 唯一索引；迁移跟踪改为 `(table_name, source_stable_id)` 全局唯一。每日状态沿用日期唯一，复盘沿用周期唯一。日记增加 `metadata`，复盘增加 `structured_data`，每日状态增加四个睡眠字段。revision 快照使用整行 JSONB。

迁移补偿必须先删 `journal_revisions` 再删 `journals`，任何补偿错误都升级为迁移失败，不得忽略。清理使用单事务和固定前置断言；canonical 优先选择已有成功迁移追踪的记录。

## 写入与认证

React Repository 与本机 `CloudClient` 使用相同 Supabase REST/RPC。Owner access/refresh session 只进入 macOS Keychain；浏览器只持有普通 Owner 会话；禁止 service-role。回执只返回 `saved/conflict/unauthenticated/unavailable`、资源类型与 revision。

本机 token provider 在到期前刷新 Owner session 并原子更新 Keychain。公开项目配置使用 Git 忽略、权限 `0600` 的本机绑定；配置缺失或仍是脱敏占位时认证失败关闭，不回退本地写入。

生产收口使用 `cutover_life_console_230` 单事务 RPC。它先断言固定计数、十组三重重复、每组唯一已追踪 canonical 和唯一测试归档目标，再按 revision→journal 顺序删除，导入三篇日记与一天状态、写迁移跟踪并复核最终计数。任何内容、数量、来源键或约束不一致都会回滚整笔事务。

## 备份

`export_life_console_snapshot()` 以 invoker 权限返回 schema 2 的八类资源一致性快照。Agent 生成 canonical NDJSON、资源 SHA-256 和 `life-console-backup/2` 清单，由 `BackupStore` 校验并原子安装 latest；替换前把已验证 latest 保存为 previous。每六小时以及手动请求处理一次。恢复只进入隔离目录。

手动和自动请求统一调用 Owner-scoped `request_life_console_backup` RPC，由数据库写入正确 `user_id`。macOS LaunchAgent 安装器固定 `StartInterval=21600`、`RunAtLoad=true`，只在切源标记和本机云绑定同时存在时安装。

LaunchAgent 不直接用系统 Python 访问 iCloud，而由已签名的 `Life Console.app` 启动器承接 macOS 文件权限，再通过 `LIFE_CONSOLE_PYTHON` 调用备份命令。安装测试校验启动器、解释器、周期和 plist 权限；运行验收要求 exit 0。

## Production 发布

Vercel Production 使用 `build:supabase-production` 和 `dist/supabase-production`，候选环境继续使用 `build:supabase-candidate`。两者复用 Repository 和安全头，但 Production 将 UI 标记为 `ONLINE_PRIMARY`，不得出现 Candidate、合成数据或 `ICLOUD_PRIMARY` 文案。

动态配置生成器位于 `scripts/write-vercel-config.mjs`。根目录不得出现 Vercel 保留的 `vercel.mjs`，否则平台会把生成器误判为动态配置并在构建前拒绝发布。发布必须先生成权限 `0600` 的本地配置，再通过 `--local-config` 部署最新已合并 `main`。

## 安全

Git、PR、文档与日志不保存真实内容、邮箱、Token、服务标识或完整 URL。生产预检只输出计数和结构断言；原文只在 Owner 会话、数据库和 iCloud 私有备份之间流动。
