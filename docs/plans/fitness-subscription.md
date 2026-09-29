# Apple 健身日历订阅实施计划

Spec: ../knowledge-base/生活助手-LifeConsole-2.10.0/技术方案-生活助手-LifeConsole-2.10.0.md

范围：单向订阅、默认关闭、备注默认不输出。交付分为服务与界面、合成客户端探针两个可独立验收工作块。测试通过不代表产品发布或真实日历连接已完成。

## Task 1: Subscription SQL contract
新增迁移，提供 Owner get/rotate/update 原子接口；rotation 由后端安全随机源生成32字节，仅返回一次；Owner RPC 只接收 SHA256。独立 NOLOGIN feed role 仅能执行私有快照函数。状态版本锁与原预约使用同一 advisory lock，拒绝过期与隐式重启；所有记录或明确超限错误。
Tests: tests/supabase/fitness-subscription.test.ts。先运行缺实现失败，再实现，预期全部通过。覆盖 anon/非Owner、跨Owner、撤销/轮换、备注、软删、序列、角色直读拒绝、上限及冲突。

## Task 2: ICS and HTTPS service
私有后端独立 calendar 服务，单独最小权限数据库连接；RFC5545 serializer + GET/HEAD，错误503、无效404、no-store，无请求URL日志，容量与并发预算。公共契约留应用，运行序列化代码随私有服务维护，避免跨库未版本化复制。
Tests: private tests/calendar*.test.mjs；真实合成数据库HTTP探针。先红再绿。

## Task 3: Subscription settings
Owner RPC adapter；按钮+设置面板，启用时说明字段和延迟，只在当前面板展示新链接，关闭不持久化；停用/轮换确认；冲突和失败不宣称保存或同步。默认运行配置不开启未验证入口。
Tests: repository与UI测试，真实浏览器合成预览。先红再绿。

## Task 4: Review and Apple probe
全量项目检查、独立审阅、两个Draft PR、可复现合成探针与发布/回退清单。需明确授权后部署合成只读入口，在Apple客户端验证增改删、手动/自动刷新、多设备与撤销；失败则不开放真实订阅。不能以ICS字符串测试代替Apple证据。

## Review Focus
检查授权边界、feed凭据与Owner会话隔离、RPC秘密响应日志、撤销竞态、全量快照和超限、UTF8折行、关闭/登出异步响应、恢复令牌不复活。

## Progress
- Task 1: started. 全部数据库验证使用合成数据。
- Ruling: serializer 在私有服务维护，公开仓库维护字段契约和数据库迁移；避免复制两份实现，测试覆盖一致的响应字段。

- Task 1: Owner RPC/私有feed及6项SQL行为测试通过；更新与停用使用与预约相同锁，hash不暴露。
- Task 2: 私有ICS/HTTP服务与11项订阅测试通过；真实本地PG+HTTP增改删、轮换撤销与HEAD通过。反代配置解析和实际故障日志测试通过。
- Task 3: 设置面板及2项adapter、3项UI测试通过；浏览器合成启用确认及一次性链接展示通过，控制台无错误。入口默认关闭，候选模式标明合成。
- Final: fixed 大快照先传输后校验导致潜在OOM — SQL预算反例RED→GREEN；10000条最大emoji备注、4连接、96MiB V8堆实际返回小型503。
- Task 4: 独立复审的唯一P2已修复；Apple真实客户端、固定服务器版本复验与发布仍未执行。
- Verification: 最终应用695 Vitest + 93 Python通过；根目录376项/1skip通过。治理与Git隐私通过。完整私人工作区便携性校验不适用于公开克隆，未降低检查规则或复制私人资料。

- Compatibility: merged current all-day appointment model; added ordered feed projection migration and DATE-valued ICS contract. Application 701 Vitest + 93 Python passed; candidate build passed. The backend counterpart passed 43 Node tests and isolated PostgreSQL/HTTP probes. Apple client probe is in progress; this does not enable production subscriptions.
