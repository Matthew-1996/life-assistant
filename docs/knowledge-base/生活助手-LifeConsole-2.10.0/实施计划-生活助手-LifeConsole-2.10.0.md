# 第一阶段实施计划 · Life Console 2.10.0

授权：PO 确认技术路线并明确开始 A（合成测试库中的预约存储与接口）。由当前 Agent 逐项实施，最终独立审阅。规范以技术方案 draft.2 为准；本阶段已完成工程验证，结果见同目录工程验收 A；本计划不扩大到 UI、ICS、生产迁移或部署。单工作块不超过 4 小时。

## 实现与验收顺序

- [x] 先写合成 SQL 行为测试：Owner/非 Owner/匿名权限、不可直接写、幂等指纹、版本冲突、软删除、业务时区和分页；观察缺失接口导致失败。
- [x] 新增迁移：独立预约表、不可由用户写入的 Owner 授权登记、私有回执及默认关闭的订阅元数据；创建 CRUD/get/list 原子 RPC，固定 search_path 与权限。
- [x] 写 repository 测试并实现 domain/types 与 Supabase 适配：显式时区、UUID/revision 校验、100 条游标页、错误归类、不自动重试写。
- [x] PostgreSQL 多连接测试争抢相同创建键及相同 revision，验证只产生一次成功写入；PGlite 用于快速权限/业务回归。
- [x] 运行应用测试/构建、治理/隐私/差异检查、独立复审，补齐工程验收与备份覆盖清单，更新 Draft PR。

## 接口与范围

FitnessRepositoryPort 提供 listRange(input): FitnessPage、get(id): Appointment|null、create(input)、update(input)、softDelete(input)。get 包含已删除结果以支持冲突处理；listRange 只返回活动记录。阶段 A 不挂载到 App，不实现订阅读取和管理端点。

## 执行裁决

现有公开 schema 没有不可伪造的 Owner allowlist，profiles 允许用户维护自己的行，不能用其 display_name/status 充当授权。因此新增仅管理员可维护的私有 fitness_owners 登记，迁移不自动登记任何真实用户；合成测试显式登记测试 Owner。实际 Owner 配置是未来受控迁移前置条件。此为落实已批准“非 Owner 拒绝”的必要保护，不改变既有模块权限。

备份覆盖本阶段交付清单和隔离恢复测试；应用快照格式升级与真实备份演练在上线前完成，本阶段不改变现有导出格式。
