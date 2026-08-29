# 工程评审与验收：Life Console 2.7.0

状态：本地候选、全量验证、独立代码复审、Draft PR #79 三项 CI 与合成数据 Preview 技术验收已通过。等待 PO 验收；合并与 Production 未授权。

## 1. 工程评审

- 产品实现限于 `TodoPanel`、`TodoGantt`、Todo 样式与对应测试；Preview 另接入无网络、无持久化的工厂级合成 Todo repository。
- 筛选作用在 repository 返回后的前端投影，不改数据读写边界。
- 列表与甘特图共用 `visibleItems`，避免两份筛选逻辑漂移。
- 原生 checkbox 保留键盘和可访问性语义。

## 2. 开发中证据

- 行为测试在实现前新增 4 个失败用例，分别暴露默认已完成仍可见、无法回捞、流转后仍可见与缺少筛选空状态。
- 独立审查后又先增加“空仓库 + 全不选”失败用例，再修正空状态优先级。
- 最小实现后，Todo 面板定向测试 10/10 通过。
- 390px 合成几何测试 1/1 通过；测试数据为本地合成数据。

## 3. 全量门禁证据

- Draft PR 最新 CI：Vitest 82 个文件、615 项通过；应用 Python 75 + 7 + 10 + 1 项通过；node、python、privacy 三项均通过。
- `npm run build:supabase-production` 与 `npm run build:vercel-preview`：130 个模块转换成功；制品边界测试确认合成 Todo 仅进入 Candidate bundle。
- `npm run test:e2e:synthetic`：14/14 通过，包含 390px 筛选、Todo 表单、iOS 日期控件与底栏回归。
- 根工具测试：372 项通过，1 项既有跳过。
- `git diff --check`、项目治理检查和 Git 隐私检查通过。

首次沙箱执行的回环端口用例因 `listen EPERM 127.0.0.1` 失败；允许本机回环监听后原样重跑全部通过。未修改相关实现、断言或超时。

Draft PR #79 首轮 node CI 的既有 Daily News NodeNext 类型检查在共享 runner 耗时 5.446 秒，超过既有 5 秒用例超时；同一轮其余 610 项、python 与 privacy 通过。未改代码、断言或超时后原样重跑，node、python、privacy 三项均通过。

## 4. Preview 技术验收

- PO 于 2026-08-29 当次确认进入 Preview；当前候选为 [受保护的合成数据 Preview](https://life-console-production-p3zs4aeii-test11-b88a.vercel.app)。
- 首个静态 Preview 因缺少合成 Todo，无法验证本需求，未作为验收件；补齐候选专用内存 repository、失败测试、复审与 CI 后生成替代 Preview。
- 替代 Preview 状态为 Ready，target 为 preview；10 个静态文件、0 Functions、0 Cron；`/api/*` 返回 404；响应包含 `noindex`、`connect-src 'none'`、`script-src 'self'`、`X-Frame-Options: DENY`。
- 真实浏览器已验证今日/全部筛选保持、默认隐藏已完成、列表/甘特同步回捞、状态流转后即时隐藏、全不选双空态和 390px 几何边界。
- 独立复审发现的上海 00:00–00:59 完成时间跨日问题已先用固定 00:30 失败用例复现，再修正并复审通过，无剩余 Critical / Important。

待补全：PO 对 Preview 的产品验收决定。PR 合并与 Production 继续保持独立门禁。
