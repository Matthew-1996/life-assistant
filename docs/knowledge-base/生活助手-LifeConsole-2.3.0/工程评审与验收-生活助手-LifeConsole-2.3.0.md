# 工程评审与验收：Life Console 2.3.0

## 自动验收

- 数据库约束：稳定键、全局迁移唯一、结构化字段、schema 2 导出。
- 迁移：跨批次跳过；tracking 失败时 revision 先回滚；补偿失败不得静默。
- 写入：稳定键、睡眠字段保真、网络失败无本地降级。
- 备份：八类资源哈希、数量、可解析性、latest/previous 原子替换。
- 全量测试、Production build、隐私、治理、diff 与移动四页。

## 生产门禁

| 验收项 | 状态 | 去敏证据 |
|---|---|---|
| Owner 本机会话与续期 | 通过 | Keychain 条目包含访问、刷新与到期信息；Owner 只读请求成功，未使用 service-role |
| 增量 schema | 通过 | 首次因旧 revision 触发器阻止元数据回填而整笔回滚；修复为事务内暂停回填触发后重新应用成功，既有日记 revision 未虚增 |
| 切源前备份 | 通过 | 八类资源导出、哈希、数量与 JSON 解析通过；隔离临时目录恢复通过 |
| 固定重复组 | 通过 | 十组、每组三份、每组一份已追踪 canonical；二十份冗余及其 revision 在单事务中删除 |
| 本地独有导入 | 通过 | 三篇日记和一天状态以稳定来源键在同一事务导入并全部进入迁移跟踪 |
| 最终生产计数 | 通过 | 日记 14、每日状态 15、目标 5、周复盘 1、阶段复盘 1、健康汇总 8；重复组 0，日记 revision 15 |
| 切源后备份 | 通过 | latest 为清理后数据，previous 为清理前数据；两份均完成隔离恢复验证 |
| 本地活动写入 | 通过 | 根切源标记生效；日记与每日状态旧命令拒绝新增并引导云端适配器 |
| Production 应用与真实故障路径 | 通过 | 2.3.0 与三个上线 hotfix 均经 Node、Python、隐私 CI 后 squash 合并；正式别名指向最新 READY 构建，Owner 四页可读，运行时错误聚合为空 |
| 正式环境真相源文案 | 通过 | Production 使用独立构建模式；首页、记录页、系统页仅显示 Supabase 唯一真相源与 iCloud 单向备份，不再显示 Candidate、合成数据或未切源文案 |
| 未登录访问 | 通过 | 登录前正式认证链路返回 unauthenticated；Auth Gate 回归覆盖会话缺失与失效，不回落到演示数据 |
| 正式站手动备份 | 通过 | Owner 在系统页只触发一次备份请求；本机 LaunchAgent 处理后 exit 0，页面回读新的成功时间 |
| 六小时本机备份 | 通过 | LaunchAgent 使用签名应用启动器访问 iCloud，StartInterval=21600，RunAtLoad=true；安装后实跑 exit 0 |
| 已登录非 Owner 403 | 延期 | 当前没有第二身份，不以未登录 401 冒充 403 |

生产清理与导入只通过 Owner 会话和数据库事务处理原始字段；聊天、Git、PR 和本文均只保存数量与结论。

上线期间首次 Production 部署因根目录旧 `vercel.mjs` 与 Vercel 动态配置入口重名而在构建前失败，未覆盖旧正式站。修复将生成器迁至 `scripts/write-vercel-config.mjs`，并使用显式 Production 配置和独立 `supabase-production` 构建模式；回归测试锁住保留文件名与正式/候选文案隔离。
