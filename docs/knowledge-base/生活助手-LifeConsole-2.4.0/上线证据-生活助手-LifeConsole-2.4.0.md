# 上线证据：Life Console 2.4.0

## 1. 结论

Life Console 2.4.0 已于 2026-08-17 正式上线。功能 PR [#54](https://github.com/Matthew-1996/life-assistant/pull/54) 已通过独立安全、并发与隐私复审及全部 GitHub CI，并以 squash merge 合入 `main`。Vercel Production 已达到 `READY / PROMOTED`，正式 alias 为 <https://project-wpabq.vercel.app/>，部署源码精确对应 merge commit `bbb58861a55d020972b80c4e0f7929fd39e8e123`。

本文件只记录去敏门禁结果，不包含凭据、日记 ID、原文、日记内容哈希、revision、人物资料、模型正文或供应商响应体。

## 2. 正式发布门禁

| 门禁 | 结果 |
|---|---|
| 功能合并 | PR #54 已 squash merge；merge commit `bbb58861a55d020972b80c4e0f7929fd39e8e123` |
| GitHub CI | privacy、python、node 全部通过 |
| 独立复审 | 无 P0/P1/P2 阻断；此前发现的 10 项安全、并发、隐私与契约问题均已关闭 |
| Production 部署 | Vercel Production 为 `READY / PROMOTED`；正式 alias 指向上述 merge commit；不在 GitHub 记录精确服务部署标识 |
| Supabase 状态机 | migration `20260817022619_enforce_agent_normalization_priority` 已应用；begin/complete/fail 均为 SECURITY INVOKER，anon 无 execute，authenticated 有 execute，锁顺序统一为 job → journal |
| 合并后合成探针 | 使用 Keychain Owner 会话；`HTTP 200 / provider_ok / no-store`；未读写任何日记 |
| 唯一授权单条复验 | 目标唯一、状态 completed、processor 为 Agent、统一契约有效、source revision 一致、job 集合未变化；本轮只读且 DeepSeek 未调用 |
| 数据边界 | 未处理其他日记，未发送人物资料，未运行历史批处理，未创建或输出凭据，未充值、购买、删除数据 |

## 3. 代码与测试证据

- 合并前最新功能提交的 GitHub privacy、python、node 检查全绿。
- 独立专项复跑：Node 5 个文件 / 48 项通过；Python 27 项通过。
- 新状态机迁移由 11 项 PGlite 回归覆盖，包括 completed/processing 幂等、Agent 优先级、跨 processor 完成与统一锁顺序。
- Production build、治理检查、`git diff --check`、当前分支与 Git 历史隐私扫描通过。
- 本机完整 Vitest 曾受 iCloud worktree 回环端口权限和冷启动时限影响；精确回归与干净 GitHub CI 均未复现功能失败，因此没有把受环境影响的本机全量结果冒充为全绿证据。

## 4. 非阻断残余风险

- 当前有锁顺序静态断言和 PGlite 状态机回归，但尚无真实双连接死锁压力测试。
- 显式 provider API 未来若重新接入浏览器 UI，必须重新取得逐条真实数据授权，并再次审查人物投影边界。
- Python 与 TypeScript 共用唯一契约 JSON；Python 仍是该契约的手写语义消费者，后续 Schema 变更需保持 parity 回归。
- 既有依赖审计项与大于 500 kB 的候选 bundle 继续作为后续维护项，不阻断 2.4.0 上线。

## 5. 发布边界

本次正式发布只包含通用代码、Production 状态机、纯合成 provider 健康验证，以及此前经 PO 明确授权的唯一失败日记验收。该条由 Agent 完成；DeepSeek 未接收其原文。没有扩大到其他记录、人物资料或历史批量整理。
