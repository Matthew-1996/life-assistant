# 工程评审与验收：Life Console 2.4.0

## 1. 当前状态

Gate 2 通用代码完成，2.4.0 数据库迁移与 Vercel Production 已于 2026-08-16 上线，Draft PR #54 继续保持 Draft。复用了 macOS Keychain 中既有 DeepSeek 凭据，并以不含个人数据的合成请求验证真实接口；没有创建新账号或新 Key，没有发送真实日记、批量重写历史、切源或合并 PR。

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

## 4. Gate 2 授权不包含

- 创建或充值 DeepSeek 账号；
- 保存真实 DeepSeek API Key；
- 发送真实日记或人物资料；
- 数据库 Production 迁移；
- Vercel Production 部署；
- 历史批量整理；
- PR 转 Ready、合并或资源删除。

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
- 真实 DeepSeek 接口的纯合成连通性：通过；真实日记处理与模型质量 POC 未执行。
- Production 数据库迁移和部署：通过。
- 历史日记批量重整：未执行。
- PR #54：保持 Draft，不转 Ready、不合并。
