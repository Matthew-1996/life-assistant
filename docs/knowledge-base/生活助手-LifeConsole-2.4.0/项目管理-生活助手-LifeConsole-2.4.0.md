# 项目管理：Life Console 2.4.0

## 1. 当前状态

- 主阶段：Production 已部署，等待 PR #54 代码审查与后续真实单条验收决策
- 子状态：统一契约、数据库状态机和 DeepSeek 兜底运行条件已上线；历史仍保持 legacy
- 分支：`agent/life-console-240-unified-journal`
- PR：Draft PR [#54](https://github.com/Matthew-1996/life-assistant/pull/54)
- 真实数据：PO 已授权仅重整本次明确指出的一条失败日记；Agent 优先、DeepSeek 仅兜底；历史不批量重写
- 部署：已部署到 [正式站点](https://project-wpabq.vercel.app/)

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
- 复用既有 macOS Keychain DeepSeek 凭据完成纯合成真实接口校验，并配置为 Vercel Production-only Sensitive 变量。
- Supabase 2.4.0 migration 已应用；既有 14 条日记保持 `legacy`，新整理任务为 0。
- 修复 Vercel NodeNext ESM 解析、Node 请求适配和 Production 构建配置缺失，最终正式站点与接口验收通过。

## 3. 阶段计划

每个连续工作块不超过 4 小时：

1. Gate 2：确认混合处理架构、DeepSeek 数据处理边界和合成 POC 范围。已完成。
2. 阶段 A：统一 Schema、Prompt、生成类型和纯合成契约测试。已完成。
3. 阶段 B：Agent processor 与 Supabase revision RPC。已完成代码、合成测试和 Production migration。
4. 阶段 C：Vercel Function + DeepSeek 合成 POC。注入式测试及真实接口纯合成连通性均通过，不接真实日记。
5. 阶段 D：真实非敏感单条端到端质量验收。待 PO 后续决定；当前未执行。
6. 阶段 E：Production 上线。已完成；PR 仍为 Draft，未合并。

## 4. 开放风险

- DeepSeek 对 API 输入的训练/保留边界需账号设置与正式政策复核。
- Agent 与 DeepSeek 不保证逐字相同，需要用语义契约验收。
- 个人关系投影属于新的线上私人数据，真实值必须逐项授权。
- 现有候选 bundle 大于 500 kB，属于后续性能优化项，不阻断当前合成验收。
- 依赖安装报告一项既有 high severity 审计项；本版本未在无单独评审的情况下自动升级依赖。
- 真实日记首次 DeepSeek 质量验收尚未执行；上线结论只覆盖合成连通性、鉴权和状态机。

## 5. 决策日志

| 日期 | 决定 | 状态 |
|---|---|---|
| 2026-08-16 | 统一日记契约 1.0；原文先保存、异步整理 | PO 已确认 |
| 2026-08-16 | 仅使用已确认个人档案补充人物关系 | PO 已确认；真实条目待逐项授权 |
| 2026-08-16 | Agent 优先、DeepSeek 候选兜底 | Gate 2 已确认；只允许纯合成 POC |
| 2026-08-16 | 历史日记不批量重写 | PO 已确认 |
| 2026-08-16 | 统一字段、证据依据、Agent 主处理、Vercel DeepSeek 兜底和纯合成 POC | Gate 2 已确认；不含真实数据、密钥、部署或合并 |
| 2026-08-16 | Gate 2 通用代码与纯合成测试完成 | Draft PR #54；未部署、未接 Key、未处理真实数据 |
| 2026-08-16 | 复用此前已配置的真实 DeepSeek API，不要求用户重复配置 | PO 已授权；只报告存在性与合成验证结论 |
| 2026-08-16 | 2.4.0 migration 与 Vercel Production 上线 | 已完成；历史 14 条保持 legacy，任务数 0 |
| 2026-08-16 | 不用真实日记做上线探针 | 已执行；Owner 页面、配置存在性、合成 provider 调用和未认证 401 分层验收 |
| 2026-08-16 | PR #54 继续保持 Draft | 已执行；不转 Ready、不合并 |
| 2026-08-16 | 修复最新日记整理失败，并重新整理该条；Agent 优先，DeepSeek 仅兜底且需验证链路可用 | PO 已明确授权；不扩展到其他历史日记 |
| 2026-08-16 | 保存前预览不得伪装成结构化整理；字段顺序、标签、Prompt 与 Schema 均来自唯一契约 | 缺陷修复决定 |
