# 项目管理：Life Console 2.4.0

## 1. 当前状态

- 主阶段：Gate 2 通用实现完成
- 子状态：等待后续候选部署与真实数据处理单独授权
- 分支：`agent/life-console-240-unified-journal`
- PR：Draft PR [#54](https://github.com/Matthew-1996/life-assistant/pull/54)
- 真实数据：未读取、未处理
- 部署：未执行

## 2. 已完成

- 现行 Agent、Life Console、Repository 和数据库字段链路审计。
- Gate 1：统一日记契约 1.0、原文先保存、异步整理、已确认人物档案可补充、历史不批量重写。
- 官方 DeepSeek 模型、JSON Output、思考模式、API Key 与隐私政策调研。
- PRD、需求、设计、技术和测试方案 draft.1。
- Gate 2：统一字段、证据依据、Agent 主处理、Vercel 服务端 DeepSeek 兜底、`deepseek-v4-flash` 非思考模式和纯合成 POC 已确认；真实 DeepSeek 数据处理仍未授权。
- 版本内实施计划已形成，按 Inline Execution 与 TDD 执行。
- 唯一 JSON 契约、TypeScript/Python 校验器、raw-first 数据库状态机与 Repository 已完成。
- Agent 主写入、纯合成 DeepSeek 服务端兜底、统一前端渲染与异步状态反馈已完成。
- 全量本地门禁通过；独立 worktree 的完整项目验证受缺少私人 iCloud 文件限制，已在工程验收中如实记录。

## 3. 阶段计划

每个连续工作块不超过 4 小时：

1. Gate 2：确认混合处理架构、DeepSeek 数据处理边界和合成 POC 范围。已完成。
2. 阶段 A：统一 Schema、Prompt、生成类型和纯合成契约测试。已完成。
3. 阶段 B：Agent processor 与 Supabase revision RPC；仍只用合成数据。已完成代码与合成测试，未部署迁移。
4. 阶段 C：Vercel Function + DeepSeek 合成 POC；不接真实日记。已完成注入式合成 POC，未调用真实服务。
5. 阶段 D：候选环境端到端验收；真实非敏感单条测试需另行授权。
6. 阶段 E：Production、真实入口切换与上线；需独立授权。

## 4. 开放风险

- DeepSeek 对 API 输入的训练/保留边界需账号设置与正式政策复核。
- Agent 与 DeepSeek 不保证逐字相同，需要用语义契约验收。
- 个人关系投影属于新的线上私人数据，真实值必须逐项授权。
- 版本化迁移尚未应用到候选或 Production，线上仍不能使用 2.4.0 新状态机。
- 现有候选 bundle 大于 500 kB，属于后续性能优化项，不阻断当前合成验收。

## 5. 决策日志

| 日期 | 决定 | 状态 |
|---|---|---|
| 2026-08-16 | 统一日记契约 1.0；原文先保存、异步整理 | PO 已确认 |
| 2026-08-16 | 仅使用已确认个人档案补充人物关系 | PO 已确认；真实条目待逐项授权 |
| 2026-08-16 | Agent 优先、DeepSeek 候选兜底 | Gate 2 已确认；只允许纯合成 POC |
| 2026-08-16 | 历史日记不批量重写 | PO 已确认 |
| 2026-08-16 | 统一字段、证据依据、Agent 主处理、Vercel DeepSeek 兜底和纯合成 POC | Gate 2 已确认；不含真实数据、密钥、部署或合并 |
| 2026-08-16 | Gate 2 通用代码与纯合成测试完成 | Draft PR #54；未部署、未接 Key、未处理真实数据 |
