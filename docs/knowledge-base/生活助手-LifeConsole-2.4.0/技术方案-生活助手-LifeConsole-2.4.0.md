# 技术方案：Life Console 2.4.0

## 1. 总体架构

```text
Agent 对话 ──保存原文──┐
                      ├─ Supabase journals（唯一原文）
Life Console ─保存原文─┘          │
                                  ├─ Agent processor（首选，仅 Agent 入口）
                                  └─ Vercel normalize API → DeepSeek（非 Agent 兜底）
                                               │
                                 统一 Schema 校验 + revision RPC
                                               │
                                  journals.metadata（唯一整理结果）
```

## 2. 单一约束源

当前只维护一个机器可读工件：

- `apps/life-console/contracts/journal-normalization-v1.json`：同时保存 contract version、prompt version、唯一 system Prompt、字段 Schema 与长度限制，不含真实人物或日记。
- TypeScript `normalization-contract.ts` 与 Python `journal_normalization_contract.py` 都读取这一工件；不得复制第二份 Prompt 或字段定义。

`journal/QUICK_CAPTURE.md`、Agent Skill、Life Console 和自动化只引用契约版本，不复制规则正文。项目校验器检查重复 Prompt、版本漂移和未引用 Schema。

## 3. 数据模型草案

`journals` 保持原文真相，并增加或规范：

- `content`：唯一原文；整理完成 RPC 不得修改。
- `event_time`、`time_precision`、`source`、`privacy`
- `raw_revision`
- `normalization_status`
- `normalization_contract_version`
- `normalization_prompt_version`
- `normalization_processor`
- `normalized_source_revision`
- `normalized_at`
- `normalization_error_code`
- `metadata`：统一整理 JSON；不得混入原文副本。

`metadata` 中可验证的条目统一使用对象而非裸字符串，例如：

```json
{
  "text": "展示给用户的整理文字",
  "basis": "explicit_text",
  "evidence": "必须能在当前原文中精确找到的短片段"
}
```

人物档案补充使用 `basis=confirmed_profile` 与人物投影 revision，不把整份个人档案复制进日记。主题与标签是分类结果；推测必须明确标记不确定性，不能被下游当作事实。

新增 `journal_normalization_jobs`，以用户、任务键及 journal/source revision/contract/processor 组合防重，记录任务状态和尝试次数；不记录原文或模型输出日志。

新增最小 `journal_context_entities` 投影，只保存逐项获批的人物规范称呼、别名、关系和 revision。它不是 `USER.md` 副本，也不包含职业、健康或其他长期资料。

## 4. Agent processor

1. Agent 调云端 Repository 创建原文，取得 journal ID 与 revision。
2. Agent 读取同一 Prompt、Schema 和获批人物投影。
3. Agent 生成结构化 JSON，并在本机完成 Schema 与事实边界预检。
4. Agent 通过 Owner 会话调用 `complete_journal_normalization` RPC，携带 expected source revision。
5. 只有 RPC 返回 completed 才回复“整理完成”；否则回复“原文已保存、整理待完成”。

Agent 不直接拼 Markdown 保存；Markdown/页面均从结构化 JSON 渲染。

## 5. DeepSeek 兜底 processor

候选调用：

- 官方 OpenAI-compatible `POST https://api.deepseek.com/chat/completions`
- 模型：`deepseek-v4-flash`
- `thinking: {type: "disabled"}`
- `response_format: {type: "json_object"}`
- 单轮请求、非流式、低随机性、限制输出 token
- 返回后执行严格本地 Schema、数组长度、文本长度、枚举和禁止新增事实校验

官方资料表明，旧 `deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 退役；不得使用旧别名。JSON Output 偶尔可能返回空内容，因此空内容、截断、非 stop、Schema 错误只重试一次，仍失败即标记 `failed`，不自动切换 `v4-pro`。

官方资料：

- [Chat Completion 与 JSON Output](https://api-docs.deepseek.com/api/create-chat-completion)
- [JSON Output 注意事项](https://api-docs.deepseek.com/guides/json_mode/)
- [当前模型与定价](https://api-docs.deepseek.com/quick_start/pricing)
- [思考模式开关](https://api-docs.deepseek.com/guides/thinking_mode)

## 6. 服务端与认证

- DeepSeek API Key 只进入 Vercel Production/Preview Secret，不进入浏览器、Git、日志、文档、Supabase 或错误回执。
- Vercel Function 接收当前 Supabase Owner JWT，使用该 JWT 读取和更新当前用户记录；不向浏览器暴露高权限 Supabase 密钥。
- Function 只接受 journal ID、source revision 和 task key，不接受客户端自报的完整人物字典。
- 服务端从 Supabase读取当篇原文和最小获批人物投影；请求/响应 body 禁止日志化。
- 完成 RPC 同时校验 user、source revision、任务租约与 contract version，避免旧结果覆盖更正后的原文。

## 7. 触发与重试

- Agent 来源：创建后由当前 Agent立即处理。
- Web 来源：`create_journal_v2` 成功后才调用 Vercel Function；Function 完成或失败都不改变“原文已保存”的事实。页面重新打开时可恢复 pending/failed 状态并由用户重试。
- 本阶段不使用数据库触发器直接发外网请求，不使用无限 cron，也不因模型失败回写本地文件。
- POC 通过后再评审是否增加有限后台队列；当前简单方案避免引入 service-role 和无人值守私人数据外发。

## 8. 隐私评估

DeepSeek 开放平台协议要求 API Key 不得暴露在客户端，并要求开发者说明下游个人信息处理。其公开隐私政策说明可能收集用户输入并用于服务改进/技术训练，且输入会在中国境内处理和存储。公开材料不足以证明 API 输入默认不训练或零保留。

因此上线前必须：

1. PO 明确授权当篇日记原文和最小人物投影发送至 DeepSeek。
2. 检查 DeepSeek 账号是否提供并已关闭“Improve the model for everyone”等训练选项；保留去敏设置证据。
3. 若无法确认数据用途或关闭训练，DeepSeek 兜底不得进入真实日记 Production，只保留 Agent 整理和待整理状态。
4. 不发送历史日记、健康数据、完整个人档案或第三方秘密。

官方依据：

- [DeepSeek 开放平台服务协议](https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-terms-of-service.html)
- [DeepSeek 隐私政策](https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html)

## 9. 兼容与迁移

- 新记录按 v1 契约写入。
- 旧 `metadata` 在读取层映射为 legacy，不自动改写。
- 当前仅存基础字段的新记录可显示 pending，但不自动发起历史整理。
- 现有 Markdown 结构化日记迁移另行设计，不在本版本自动执行。

## 10. Gate 2 实现结论

- `create_journal_v2` 先保存原文，稳定 `record_key` 与短期幂等键共同防重。
- begin/complete/fail 三类 RPC 绑定 Owner、任务键与 `raw_revision`；原文变化后旧任务完成会返回 conflict。
- Agent 写入端先校验统一契约，再提交 `processor=agent`；无有效整理结果时保留 pending。
- 浏览器只把 journal ID、source revision 与 task key 发给同源 Vercel Function；Function 使用用户 Supabase JWT，不使用 service-role。
- DeepSeek 边界固定 `deepseek-v4-flash`、非思考、JSON Object、非流式；只对空或无效模型内容重试一次，不自动切换 Pro。
- `DEEPSEEK_API_KEY` 只允许服务端环境变量；配置生成物、CSP 和浏览器 bundle 不包含 Key 或供应商端点。
- 本轮全部供应商响应为注入式合成 fixture，没有真实 API 请求、Key、账号、费用或真实日记处理。
