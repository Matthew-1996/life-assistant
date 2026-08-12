# 生活助手 / Life Console / 2.2.0

本目录是 Life Console 2.2.0「Vercel + Supabase 在线生活工作台」的唯一版本知识库。当前已完成 Gate 1/2、阶段 A-D 通用合成实现，以及阶段 E 的东京 Supabase migration、纯合成 seed、托管权限矩阵、Advisor 复核和 Vercel Preview；浏览器 OTP 与 UI 读写验收仍需 PO 使用可收件测试邮箱完成。不接入真实数据或真实 iCloud，不切源、不部署 Production、不合并本版本 PR。

| 文档 | 职责 | 当前状态 |
|---|---|---|
| [产品需求文档](生活助手-LifeConsole-2.2.0.md) | 产品定位、范围、成功标准、非目标与待确认决策 | draft.1 / Gate 1 已确认 |
| [需求评审报告](需求评审报告-生活助手-LifeConsole-2.2.0.md) | 多角色评估、成本、风险与 Gate 1 建议 | 有条件通过 / PO 已确认 |
| [设计方案](设计方案-生活助手-LifeConsole-2.2.0.md) | 登录、加载、读写、错误、备份和移动端体验 | Gate 2 已确认 |
| [技术方案](技术方案-生活助手-LifeConsole-2.2.0.md) | Vercel、Supabase Auth/Postgres/API/RLS、数据模型与迁移边界 | Gate 2 已确认 / 阶段 E 远端候选已部署 |
| [Supabase 可行性调研与 POC](Supabase可行性调研与POC-生活助手-LifeConsole-2.2.0.md) | 本地环境、官方约束、合成验证、已知卡点和远端待验证项 | 本地与托管权限验证通过 / OTP 待 PO 验收 |
| [工程评审与验收](工程评审与验收-生活助手-LifeConsole-2.2.0.md) | 测试方案、分阶段开发、验收矩阵与阻塞条件 | 阶段 A-D 通过；阶段 E 条件通过，OTP/UI 待补 |
| [项目管理](项目管理-生活助手-LifeConsole-2.2.0.md) | 范围、依赖、风险、门禁、进度和 PR 关系 | 阶段 E 验收中 |

## 版本关系

- 2.1.0 已由 PR #39 squash 合并并完成活动分支/worktree 清理，保留当前 Vercel 合成预览作为体验基线。
- 2.2.0 只复用现有 Life Console 前端，不建立第二套产品；目标是用 Supabase 替代此前未完成的 Sites/D1 后端路径。
- iCloud 私人真相源在任何真实迁移和切源门禁通过前保持唯一真相源。
- 旧 Sites/D1/R2/Secret 是否归档或删除不属于本版本当前授权。
