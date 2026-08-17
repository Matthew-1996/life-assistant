# 工程评审与验收：Life Console 2.4.0

## 1. 当前状态

2.4.0 已正式上线。PR #54 已通过独立安全、并发与隐私复审及全部 CI，并以 squash merge 合入 `main`；main Production 为 `READY / PROMOTED`，正式 alias 精确对应 merge commit。合并后复用了 macOS Keychain 中既有 Owner 会话执行纯合成健康探针并通过。此前授权的唯一 failed journal 已由 Agent 原子完成并经精确只读复验，DeepSeek 未接收该条真实原文；没有创建新账号或新 Key，没有充值、批量重写历史、处理其他日记、发送人物资料或删除数据。

## 2. 测试策略

### 契约测试

- Schema 要求所有统一字段和枚举；未知字段 fail closed。
- 原文不进入 metadata 副本，metadata 不能覆盖原文。
- 明确事实、感受、推测和规划线索边界分别覆盖。
- 人物映射必须带 `explicit_text` 或 `confirmed_profile` 依据。
- 所有 `explicit_text` 证据片段必须能在对应原文 revision 中精确匹配；伪造证据拒绝写入。

### 黄金案例

使用纯合成生活文本覆盖：多事件、明确感受、未来愿望、未知时间、关系称谓、无可提取字段、疑似诊断、秘密片段。Agent fixture 与 DeepSeek mock 输出都必须通过同一 Schema 和渲染快照。

不要求两个模型逐字相同；要求：

- 字段齐全、空值一致；
- 不新增事实；
- 明确感受不进入推测；
- 未来愿望进入规划线索；
- 未获批人物不补姓名；
- 同一前端组件渲染。

### 状态与并发

- 原文保存成功、整理失败仍可读取。
- 同一任务重试不生成第二份整理结果。
- 原文修订后旧结果不得覆盖新 revision。
- 用户人工编辑后自动重试不得覆盖。
- 模型超时、空输出、截断、限流、余额不足和 Schema 错误均返回去敏错误。

### 安全

- 浏览器 bundle、Git 历史、日志、Supabase 行和 PR 不含 API Key。
- Vercel Function 未登录拒绝，非 Owner 延续现有策略。
- DeepSeek 请求只含当篇原文和最小人物投影。
- 不运行真实历史批处理。

## 3. POC 门禁

1. 先以不少于 12 条纯合成案例对 Agent 与 `deepseek-v4-flash` 做盲测评分。
2. 事实准确率、字段完整率和禁止推断必须全部满足方案阈值；任一模型失败则不进入真实数据候选。
3. DeepSeek 隐私设置与数据处理授权未完成时，只可使用合成文本。
4. 候选通过后再由 PO 决定是否授权一条人工输入的非敏感真实日记做端到端验收。

## 4. Gate 2 初始授权边界（历史）

- 创建或充值 DeepSeek 账号；
- 保存真实 DeepSeek API Key；
- 发送真实日记或人物资料；
- 数据库 Production 迁移；
- Vercel Production 部署；
- 历史批量整理；
- PR 转 Ready、合并或资源删除。

2026-08-17 PO 明确放开本版本收口所需的 Production 纯合成探针、唯一 failed journal、PR #54 Ready/合并和 release-evidence；其他真实数据、人物资料、充值、删除与批处理仍不在范围。

## 5. 2026-08-16 Gate 2 验证证据

| 门禁 | 结果 |
|---|---|
| 统一契约 TypeScript + Python | 10 项通过（5 + 5） |
| 数据库迁移与 Journal Repository | 15 项通过 |
| Agent 云端写入与契约 | 18 项通过 |
| DeepSeek 服务端、请求服务与 Vercel 配置 | 26 项通过，全部为注入式合成响应 |
| 统一渲染、异步写入和候选 UI 聚焦回归 | 50 项通过 |
| `python3 -m unittest discover -s tools -p 'test_*.py'` | 365 项运行，364 通过、1 跳过；沙箱外回环权限复跑通过 |
| `npm test` | Vitest 50 文件 / 434 项通过；随附 Python 92 项通过 |
| `npm run build` | 通过，常规 JS 326.25 kB（gzip 97.44 kB） |
| `npm run build:supabase-candidate` | 通过；JS 578.24 kB（gzip 165.05 kB），仅既有 >500 kB 非阻断 warning |
| 治理、Git 隐私、`git diff --check` | 通过 |

`tools/validate_project.py` 在独立 Git worktree 中不能作为全绿证据：它按设计要求读取未复制到 worktree 的 iCloud 私人文件、自动化、工作簿及本地集成文件，同时命中一条已有历史文档失效链接。2.4.0 新增的统一契约专项校验 5 项全部通过；不得把根工作区旧代码的校验结果冒充为本分支验证。

## 6. 2026-08-16 Production 上线证据

| 验收项 | 结果 |
|---|---|
| 既有 DeepSeek 凭据 | macOS Keychain 条目存在；纯合成最小请求返回 HTTP 200，响应结构有效；明文未写入 Git、iCloud 或文档，临时传输文件与剪贴板已清理 |
| Vercel Secret | `DEEPSEEK_API_KEY` 已作为 Production-only Sensitive 环境变量存在；浏览器 bundle 和部署配置均不含值 |
| Supabase migration | `unified_journal_normalization` 已应用；8 个 journal 状态字段、2 张新表和 3 个 revision-safe RPC 均存在 |
| RLS 与顾问 | 两张新表 RLS 已启用；安全和性能顾问均无报错或警告 |
| 历史数据边界 | 14 条既有日记保持 `legacy`；整理任务数为 0；未批量重写历史原文或 metadata |
| Vercel 函数兼容 | 新增 NodeNext 编译门禁和 Node request/Web Request 适配回归；未认证探测由 500 恢复为 `401 unauthenticated` |
| Production 页面 | [正式站点](https://project-wpabq.vercel.app/) 为 Supabase 在线生产模式，既有 Owner 会话可访问；未创建合成或真实验收日记 |
| 最终全量门禁 | Vitest 51 文件 / 436 项通过；Python 75 + 7 + 9 + 1 = 92 项通过；Production 构建与 `git diff --check` 通过 |

上线时先后发现并关闭两个环境差异：Vercel NodeNext 不解析无扩展名 ESM 导入；Vercel Node 函数请求对象不是 Web `Request`。另一次发布缺少本地 Production 构建配置，页面短暂落入本地模式；最终发布固定使用不含密钥的 `life-console.production.json`，并确认 `build:supabase-production` 生效。

依赖安装仍报告一项既有 high severity 审计项，尚未在本版本内自动升级依赖；候选 bundle 大于 500 kB 仍是非阻断性能风险。

## 7. 当前验收结论

- Gate 2 授权范围：通过。
- 真实 DeepSeek 接口的纯合成连通性：`HTTP 200 / provider_ok / no-store`，通过。
- 唯一授权真实日记：Agent 原子完成；metadata 契约有效，原文 revision/SHA-256 不变，job 集合不扩张，其他日记未触发；DeepSeek 未调用。
- Production 数据库迁移、main 部署与 release-evidence：通过。
- 历史日记批量重整：未执行。
- PR #54：独立复审无阻断，privacy/python/node CI 全绿，已 Ready 并 squash merge。

## 7.1 2026-08-17 正式发布复验

| 验收项 | 结果 |
|---|---|
| 功能合并 | PR #54 已 squash merge；merge commit `bbb58861a55d020972b80c4e0f7929fd39e8e123` |
| main Production | Vercel `READY / PROMOTED`；正式 alias 精确指向 merge commit |
| 合并后合成探针 | Keychain Owner 会话；`HTTP 200 / provider_ok / no-store`；未读写真实日记 |
| 唯一授权单条只读复验 | 目标唯一、completed、Agent、契约有效、source revision 一致、job 集合未变化；本轮无写入 |
| 授权边界 | 未处理其他日记，未发送人物资料，未调用 DeepSeek 真实数据兜底 |
| 去敏上线记录 | 见[上线证据](上线证据-生活助手-LifeConsole-2.4.0.md) |

## 8. 2026-08-16 日记整理失败回归

已确认：原文保存成功，DeepSeek 请求当次返回服务不可用；数据库随后把 failed job 原样返回，complete RPC 又只接受 processing job，导致用户承诺的“稍后重试”实际不可执行。

修复验收范围：

- 唯一契约增加字段展示顺序与中文标签，项目校验器验证其与 Schema 完整一致。
- 保存前改为原文保存预览，不生成或展示伪摘要；保存后 Agent 与 DeepSeek 继续使用同一 Prompt、Schema、字段和渲染组件。
- failed job 在总尝试次数小于 2 时可原地恢复 processing；completed 幂等，达到上限 fail closed。
- DeepSeek 增加 20 秒超时、一次有限瞬态重试与去敏错误分类。
- 新增 Owner 鉴权的纯合成健康探针，不读写真实日记。
- PO 只授权本次指出的一条日记：先由 Agent 按统一契约重整；仅 Agent 无法完成时才允许 DeepSeek 兜底。其他历史记录不处理。

### 2026-08-17 收口验收结果

| 验收项 | 结果 |
|---|---|
| 去敏健康诊断 | 固定 reason 枚举；日志仅含 route、reason、HTTP 状态、耗时与 Vercel request ID；22 项专项测试通过 |
| Schema 单一来源 | 从 `journal-normalization-v1.json` 自动注入；Prompt `1.0.1`；契约/健康/DeepSeek 27 项通过 |
| Production 合成探针 | Owner Keychain 已登录，`HTTP 200 / provider_ok / no-store` |
| 并发状态修复 | Prompt 升级原地重开一次；failed provider 不覆盖 completed Agent；PGlite 8/8 |
| Production migration | `20260816220627_preserve_completed_journal_normalization` 已应用；SECURITY INVOKER，anon 无 execute，authenticated 有 execute |
| 唯一真实单条 | Agent completed；统一契约有效；原文 revision 与 SHA-256 不变；job 总数不变；其他日记未触发；DeepSeek 未调用 |
| 统一渲染 | `JournalStructuredView` 5/5 通过；未打开批量 Production 页面 |
| 独立审查修复 | 浏览器自动外发已关闭；已完成/处理中任务不重复调用 provider；Agent 优先与统一锁顺序由 11 项 PGlite 回归覆盖；未整理列表不再用原文截断伪装摘要 |
| GitHub CI | 每次功能推送的 privacy、python、node 均通过；最终 merge 仍以最新提交 CI 为门禁 |

本机完整 Python/Vitest 在 iCloud worktree 中出现过回环端口权限、并发锁竞争和硬编码 5 秒冷启动超时；对应回环、PGlite、组件和 Production build 均已精确复跑通过，干净 GitHub CI 未复现功能失败。`tools/validate_project.py` 仍按设计因独立 worktree 缺少私人 iCloud 文件而失败，不作为本分支伪造的全绿证据。

## 9. 2026-08-17 Production CSP 空白页热修复

线上真实浏览器稳定复现：页面返回 200，但 Ajv 在浏览器入口执行 `new Function`，被 Production `script-src 'self'` CSP 拒绝，React 在挂载前中止。该结论同时由空 DOM、浏览器 CSP `EvalError` 与源码导入链支持。

修复保留严格 CSP，不添加 `unsafe-eval`；仅将 Ajv Schema 编译和证据校验拆到服务端模块，前端共享契约仍使用同一 JSON 真相源。

| 验收项 | 当前结果 |
|---|---|
| TDD 红灯 | 真实 Chromium 在 Production CSP 下精确失败于 `unsafe-eval` |
| TDD 绿灯 | 同一回归在服务端拆分后通过，全局导航可见 |
| 服务端契约回归 | normalization contract + DeepSeek + Vercel config 30/30 通过 |
| 全量 Vitest | 54 文件 / 464 项通过 |
| Production build | 通过；常规 JS 326.98 kB（gzip 97.70 kB） |
| Playwright | 4/4 通过，包含严格 CSP 真实启动回归 |
| Draft PR | #56 已建档并保持 Draft，未合并 |
| Production | Vercel `READY`；正式 alias 指向当前热修复提交；首页 200，严格 CSP / `nosniff` 存在，未登录 POST 健康门禁 401 |
| 真实浏览器 | 全新会话渲染全局导航和 Online 工作台；新会话控制台无 error/warn |
