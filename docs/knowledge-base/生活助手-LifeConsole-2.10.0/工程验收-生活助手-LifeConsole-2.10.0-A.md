# 阶段 A 工程验收 · Life Console 2.10.0

日期：2026-09-28。状态：已实现并完成工程验证，待 PO 阶段验收。授权限于合成库预约存储与接口；不代表 UI、订阅、真实迁移、合并或上线完成。

## 交付

- CLI 生成新增迁移 `20260928131414_fitness_appointments.sql`：预约表、私有 Owner 登记、幂等回执与默认关闭的订阅元数据。
- 5 个认证 RPC：按范围读取、单条读取、创建、revision 更新、软删除；不提供直接表写入权限。
- FitnessRepositoryPort / FitnessRepository：字段校验、Shanghai IANA 时区、100 条游标页、错误分类、写入不自动重试；没有挂载正式应用。
- Owner 登记默认空。合成测试显式登记虚构账号，不从可自写 profiles 判断 Owner；实际登记属于未来受控迁移范围。

## 实际验证

| 检查 | 结果 | 说明 |
|---|---|---|
| 新增 SQL/PGlite 行为 | 17 项通过 | 非 Owner/匿名拒绝、跨账号隔离、直接写拒绝、幂等、revision、软删、分页、权限 |
| 新增 repository | 21 项通过 | RPC 参数、错误、显式时间偏移、历史上海 DST、微秒游标与无写重试 |
| 原生 PostgreSQL 多连接 | 3 项通过 | PostgreSQL 18.4 临时隔离实例，实际观察锁等待；同键同内容只写一次、同键不同内容冲突、同 revision 更新/删除仅一方成功 |
| 完整 npm test | 675 Vitest + 93 Python 通过 | 85 个 Vitest 文件；契约重新生成无差异；包含原有生产构建保护测试 |
| npm run build | 通过 | TypeScript + Vite；未部署产物 |
| 项目 Python | 372 项运行，成功，1 跳过 | 通用工具回归 |
| 治理/隐私/差异 | 通过 | 提交前与新增历史复核；规范正文未变 |
| 独立代码复审 | 无 P0–P2 问题 | 独立审阅者另跑 38 项新测试全部通过；原生并发采用主 Agent 证据 |

按 TDD 先观察缺失迁移、缺失 repository 导致测试失败，再实现；历史上海夏令时回归也先失败后修复。原生测试依赖的 PostgreSQL 包仅附带 server/initdb/pg_ctl，因此改用临时 pg 客户端驱动验证多连接，未加入项目依赖。开发工具、依赖链接、缓存及真实配置不进入提交。

独立复审建议后续补充上海午夜精确左闭右开边界样本；当前 SQL 边界表达式与跨 UTC 午夜测试已检查，属于非阻断增强。UI、原生浏览器、真实 PostgREST 集成、服务器版本适配与 Apple 客户端尚未验收。

`validate_project.py` 仍失败：隔离 worktree 缺少按隐私规则排除的个人真相源/派生文件，既有测试样例触发两项秘密模式提示，另有既有研究链接失效。本阶段新增文档链接有效；没有复制私人资料、修改旧样例或削弱检查来消除基线提示。

## 原生并发复现

单独运行（不由默认 Vitest 自动加载）：

```sh
FITNESS_TEST_PG_BIN=/path/to/postgresql/bin \
FITNESS_TEST_PG_MODULE=/path/to/node_modules/pg/lib/index.js \
node apps/life-console/tests/supabase/verify-fitness-postgres.mjs
```

测试只创建新的临时集群，Unix socket、不监听 TCP；不用数据库 URL、不读取已有实例配置。结束关闭服务并删除本次临时目录。普通 `npm test` 不要求机器安装 PostgreSQL；原生验证必须显式运行并独立报告，不把未执行当通过。

## 备份覆盖清单与上线门禁

本阶段交付覆盖方案，**未升级当前应用快照 v3，未完成 pg_dump/restore 或真实恢复演练**。在允许首条真实预约写入前完成下表并记录证据。数据库备份由私有基础设施项目承接；公开仓库只维护通用契约与合成测试。

| 对象 | 受控数据库备份 | 普通业务导出/恢复要求 |
|---|---|---|
| public.fitness_appointments | 包含活动与软删、revision、时间戳及 Owner 关联 | 升级快照 v4/资源白名单，包含预约；校验类型、Owner、计数、唯一 ID 与版本 |
| life_console_private.fitness_create_receipts | 与预约同一一致性快照，保留原键/指纹/关联 | 不放进普通下载文件；缺失回执不得声称幂等恢复完好 |
| life_console_private.fitness_owners | 受限备份，隔离恢复后复核授权 | 不允许业务文件新增/覆盖管理员授权 |
| life_console_private.fitness_calendar_subscription | 受限备份包含状态/哈希/版本 | 不导出哈希；恢复库先禁用全部订阅并清空 token_hash，增加 revision，禁止旧链接恢复可读 |
| public.audit_events 预约元数据 | 随一致性数据库快照保存 | 不包含事件标题、地点、备注、私密链接或令牌 |

恢复演练验收：旧 v3 可读但不反向清空新预约；v4 合成快照往返；数据库一致性恢复后验证外键、Owner 隔离、原幂等键重试与软删不复活；在 feed 可达前执行并验证撤销，必须证明恢复已撤销令牌不会重新生效。普通备份不修改正在运行的订阅状态。

回退采用旧应用禁用入口并保留新增表，不能用 DROP TABLE 删除已产生记录。真实迁移、授权登记、备份演练、发布和真实 Apple 探针均需对应范围的 PO 门禁。本次只形成候选，没有操作上述真实系统。
