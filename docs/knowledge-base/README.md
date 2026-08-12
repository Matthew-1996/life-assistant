# 项目知识库

本目录是产品开发事实、方案、评审、进度和验收证据的统一入口。所有开发类工作先遵循 [`Agent 与用户项目开发规范`](../governance/agent-user-project-development-standard.md)，再进入对应版本目录。

## 当前项目

| 产品 / 项目 / 版本 | 版本入口 | 产品需求 | 设计 / 技术 / 验收 | PMO 状态 | 当前阶段 | 用户确认 |
|---|---|---|---|---|---|---|
| 生活助手 / Life Console / 1.0.0 | [版本知识库](生活助手-LifeConsole-1.0.0/README.md) | [PRD](生活助手-LifeConsole-1.0.0/生活助手-LifeConsole-1.0.0.md) | [设计](生活助手-LifeConsole-1.0.0/设计方案-生活助手-LifeConsole-1.0.0.md) / [技术](生活助手-LifeConsole-1.0.0/技术方案-生活助手-LifeConsole-1.0.0.md) / [工程验收](生活助手-LifeConsole-1.0.0/工程评审与验收-生活助手-LifeConsole-1.0.0.md) | [项目管理](生活助手-LifeConsole-1.0.0/项目管理-生活助手-LifeConsole-1.0.0.md) | 已上线 | PO 已确认 1.0.0 基线与项目收口计划 |
| 生活助手 / Life Console / 1.1.0 (Draft 底稿) | 历史 Draft PR [#35](https://github.com/Matthew-1996/life-assistant/pull/35)，不进入通用知识库目录 | PRD 草稿、只读快照技术草稿 | 见 2.0.0 PMO §8 决策日志 | 已关闭并清理活动分支/worktree | 已被 2.x 主线取代；关闭 PR 和提交记录只作历史审计，未删除线上资源 |
| 生活助手 / Life Console / 2.0.0（云端真相源）| [版本知识库](生活助手-LifeConsole-2.0.0/README.md) | [PRD（Gate 1 已确认）](生活助手-LifeConsole-2.0.0/生活助手-LifeConsole-2.0.0.md) | [设计方案（Gate 2 已通过）](生活助手-LifeConsole-2.0.0/设计方案-生活助手-LifeConsole-2.0.0.md) / [技术方案（Gate 2 已通过）](生活助手-LifeConsole-2.0.0/技术方案-生活助手-LifeConsole-2.0.0.md) / [工程验收（阶段 B 本地候选已验收）](生活助手-LifeConsole-2.0.0/工程评审与验收-生活助手-LifeConsole-2.0.0.md) | [项目管理（PR #36 已合并）](生活助手-LifeConsole-2.0.0/项目管理-生活助手-LifeConsole-2.0.0.md) | 历史基线 | Miniflare 与 Playwright 合成链路完成；后续产品减法与 Vercel 基线进入 2.1.0 |
| 生活助手 / Life Console / 2.1.0（简化备份与恢复） | [版本知识库](生活助手-LifeConsole-2.1.0/README.md) | [PRD（Gate 1 / 2B / 2C 已确认）](生活助手-LifeConsole-2.1.0/生活助手-LifeConsole-2.1.0.md) | [设计（Gate 2C 已确认）](生活助手-LifeConsole-2.1.0/设计方案-生活助手-LifeConsole-2.1.0.md) / [技术（Gate 2C 已确认）](生活助手-LifeConsole-2.1.0/技术方案-生活助手-LifeConsole-2.1.0.md) / [工程验收（Gate 2C PO 验收通过）](生活助手-LifeConsole-2.1.0/工程评审与验收-生活助手-LifeConsole-2.1.0.md) | [项目管理](生活助手-LifeConsole-2.1.0/项目管理-生活助手-LifeConsole-2.1.0.md) | 已收口 | PR [#39](https://github.com/Matthew-1996/life-assistant/pull/39) 已 squash 合并；活动分支/worktree 已清理，Vercel 合成预览作为 2.2.0 体验基线 |
| 生活助手 / Life Console / 2.2.0（Vercel + Supabase） | [版本知识库](生活助手-LifeConsole-2.2.0/README.md) | [PRD draft.1（Gate 1 已确认）](生活助手-LifeConsole-2.2.0/生活助手-LifeConsole-2.2.0.md) | [设计（Gate 2 已确认）](生活助手-LifeConsole-2.2.0/设计方案-生活助手-LifeConsole-2.2.0.md) / [技术（Gate 2 已确认）](生活助手-LifeConsole-2.2.0/技术方案-生活助手-LifeConsole-2.2.0.md) / [测试方案（Gate 2 已确认）](生活助手-LifeConsole-2.2.0/工程评审与验收-生活助手-LifeConsole-2.2.0.md) | [项目管理](生活助手-LifeConsole-2.2.0/项目管理-生活助手-LifeConsole-2.2.0.md) | 待联调 | Gate 1 / Gate 2 与阶段 A-D 通用合成实现已通过本地验证；阶段 C PR CI 已通过，阶段 D PR CI 待确认；远端资源、部署、真实数据与合并仍需独立授权 |

## 读取顺序

1. 先读最高优先级开发规范，确定角色、阶段和确认门禁。
2. 再读目标版本的产品需求文档，确认范围、成功标准、非目标和待确认项。
3. 读取 PMO 文档，确认当前进度、开放 PR、卡点和下一步。
4. 只读取当前阶段直接需要的设计、技术、测试或验收材料；当前方案只维护在版本目录，研究证据与源码使用链接，不复制第二份 Code Wiki。
5. 完成工作后同步更新 PMO 状态和对应知识库文档。

## 状态规则

- 主阶段仅使用：待需求评审、待设计方案评审、待技术方案评审、待联调、待测试、待验收、待上线、已上线。
- 子状态仅使用：待开始、进行中、已完成。
- `pending` 必须注明恢复条件；已废弃必须保留原因和可复用经验。
- 开放 PR、未提交工作树和没有验收证据的实现不能标为已完成或已上线。
- Agent 草拟的 PRD、设计或重大技术取舍，在 PO 明确确认前不能推进到下一门禁。

## 新项目或新版本

PMO 先判断是否属于“快速维护通道”。若会改变产品行为、信息架构、数据边界、验收标准或上线范围，必须新建版本目录和 PRD 草稿，并等待 PO 确认需求评审结论。

命名格式：

```text
docs/knowledge-base/<产品名>-<项目名>-<版本号>/
  README.md
  <产品名>-<项目名>-<版本号>.md
  需求评审报告-<产品名>-<项目名>-<版本号>.md
  设计方案-<产品名>-<项目名>-<版本号>.md
  技术方案-<产品名>-<项目名>-<版本号>.md
  工程评审与验收-<产品名>-<项目名>-<版本号>.md
  项目管理-<产品名>-<项目名>-<版本号>.md
```

其他阶段文档只在阶段实际开始时创建，格式和门禁见最高优先级开发规范。

## 隐私边界

GitHub 知识库只保存通用产品、设计、技术和测试事实，不记录真实用户资料、日记、健康数据、生活状态、外部服务绑定、机器路径或凭据。需要引用私有 iCloud 证据时，只记录“已在私有环境验证”的去敏结论和通用复现方法，不复制原始内容。
