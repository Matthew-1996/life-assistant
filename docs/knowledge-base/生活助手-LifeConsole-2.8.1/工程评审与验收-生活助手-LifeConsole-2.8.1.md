# 工程评审与验收：Life Console 2.8.1

## 当前证据

| 检查 | 结果 |
|---|---|
| 实现前基线 | 在允许 Miniflare 本地监听后，Vitest 620/620，Life Console Python 93/93 |
| TDD 红灯 | 投影测试错误返回昨日开放项并遗漏今日稍后项；Repository 仍生成 `lte now` |
| TDD 绿灯 | 初始定向 2 文件 / 9 测试通过；扩展到合成 Preview 后 4 文件 / 20 测试通过；独立审查补齐禁止 `lte now` 和候选未来时刻直接断言后 4 文件 / 21 测试通过 |
| 完整回归 | 审查修订后 Vitest 621/621；Life Console Python 93/93；工作区 Python 372 通过 / 1 跳过 |
| 生产构建 | `npm run build` 通过，TypeScript 与 Vite Production build 退出码为 0 |
| 治理、隐私与差异 | 治理完整性、当前 Git 隐私、`git diff --check` 通过 |
| Draft PR CI | [#86](https://github.com/Matthew-1996/life-assistant/pull/86) 的 Node、Python、privacy 三项检查全部通过 |
| 便携性校验 | 独立 worktree 不包含故意不跟踪的私人真相源、长期导出和个人自动化，并报告 2 个既存测试 fixture 高风险词命中与 1 个既存本地断链；未复制私人文件伪造通过 |

## 验收边界

本地工程候选通过不自动等于 Preview 验收、合并或 Production 上线。Preview 只使用合成同日未来时刻 Todo，不读写真实 Owner Todo；合并与 Production 继续以各自证据为准。

## 合成 Preview 验收

- PO 于 2026-08-31 授权进入 Preview；应用内容提交为 `4e0c307`。
- [验收 Preview](https://life-console-production-8nmm1kqq0-test11-b88a.vercel.app)为 `READY / preview`，Build Output 为 10 个静态文件、0 Functions、0 Cron。
- 首页与 Manifest 返回 200，`/api/daily-news` 返回 404；CSP 保持 `connect-src 'none'` 与 `script-src 'self'`，同时具有 `nosniff`、`DENY` 和 `no-referrer`。
- 真实浏览器中“今日”处于选中状态；合成 Todo“准备本周采购”在页面当前时间 16:40、计划开始时间 20:19 时已同时出现在列表和甘特中。
- 页面有实际内容、无错误浮层，浏览器控制台无 error / warning。Preview 不连接 Supabase，未读取或写入 Owner Todo。

结论：Preview 已满足 2.8.1 成功标准，可以进入已获授权的 PR 合并门禁；本结论仍不等于 Production 已发布。
