# 工程评审与验收：Life Console 2.7.0

状态：PO 已确认将原三按钮方案细化为紧凑浮层，并确认整行均可点击；最新交互修复的本地完整门禁与独立复审已通过，等待替换 Preview 与 PO 产品验收。合并与 Production 未授权。

## 1. 工程评审

- 产品实现限于 `TodoPanel`、`TodoGantt`、Todo 样式与对应测试；Preview 另接入无网络、无持久化的工厂级合成 Todo repository。
- 筛选作用在 repository 返回后的前端投影，不改数据读写边界。
- 列表与甘特图共用 `visibleItems`，避免两份筛选逻辑漂移。
- 紧凑触发器仅承载选择摘要，原生 checkbox 保留键盘和可访问性语义；浮层不参与文档流，不下推原有表单与列表。

## 2. 开发中证据

- 行为测试在实现前新增 4 个失败用例，分别暴露默认已完成仍可见、无法回捞、流转后仍可见与缺少筛选空状态。
- 独立审查后又先增加“空仓库 + 全不选”失败用例，再修正空状态优先级。
- 最小实现后，Todo 面板定向测试 10/10 通过。
- 390px 合成几何测试 1/1 通过；测试数据为本地合成数据。
- PO 对初版三按钮视觉提出细化后，新增浮层多选、点击外部、`Escape` 焦点恢复及“不下推表单”的失败测试；独立复审发现焦点移出浮层后仍展开的键盘缺口，先用 Tab / Shift+Tab 红测复现，再修正为焦点离开筛选容器时关闭。复审确认无剩余 Critical / Important。
- PO 继续指出下拉 checkbox 本体过大；定位为全局 `input` 的 100% × 44px 规则误作用。先用真实几何红测确认三个状态均超限，再以更高优先级将本体固定为 14×14px，保留 38px 整行点击区域。独立复审无 Critical / Important。
- PO 确认视觉后要求整行都能操作。390px Playwright 先在距选项行右边缘 8px、明确远离 checkbox 的位置复现失败：`relatedTarget === null` 的同步 `blur` 在原生 label 激活前关闭浮层。最小修复仅对焦点目标未知的分支延后一拍读取最终 `document.activeElement`；同一点连续点击可各切换一次且菜单保持展开。独立复审无 Critical / Important / Minor。

## 3. 全量门禁证据

- Draft PR 最新整行点击实现提交 `5463d37`：node、python、privacy 三项均通过。
- 最新交互细化本地完整门禁：Vitest 82 个文件、617 项，应用 Python 75 + 7 + 10 + 1 项，Playwright 14 项，根工具 372 项（1 项既有跳过）全部通过。
- `npm run build:supabase-production` 与 `npm run build:vercel-preview`：130 个模块转换成功；制品边界测试确认合成 Todo 仅进入 Candidate bundle。
- `npm run test:e2e:synthetic`：14/14 通过，包含 390px 筛选、Todo 表单、iOS 日期控件与底栏回归。
- 根工具测试：372 项通过，1 项既有跳过。
- `git diff --check`、项目治理检查和 Git 隐私检查通过。

首次沙箱执行的回环端口用例因 `listen EPERM 127.0.0.1` 失败；允许本机回环监听后原样重跑全部通过。未修改相关实现、断言或超时。

Draft PR #79 首轮 node CI 的既有 Daily News NodeNext 类型检查在共享 runner 耗时 5.446 秒，超过既有 5 秒用例超时；同一轮其余 610 项、python 与 privacy 通过。未改代码、断言或超时后原样重跑，node、python、privacy 三项均通过。

## 4. Preview 技术验收

- PO 于 2026-08-29 当次确认进入 Preview；当前候选为 [受保护的合成数据 Preview](https://life-console-production-6xg2v146c-test11-b88a.vercel.app)，内容提交为 `309ad1c`。
- 首个静态 Preview 因缺少合成 Todo，无法验证本需求，未作为验收件；补齐候选专用内存 repository、失败测试、复审与 CI 后生成替代 Preview。
- 替代 Preview 状态为 Ready，target 为 preview；10 个静态文件、0 Functions、0 Cron；`/api/*` 返回 404；响应包含 `noindex`、`connect-src 'none'`、`script-src 'self'`、`X-Frame-Options: DENY`。
- 桌面真实浏览器验证：触发器 32px 高；三个 checkbox 均为 14×14px，选项行均为 38px；浮层展开前后新建表单文档位置差为 0；默认两项选中、回捞已完成、今日/全部保持、点击外部关闭及 `Escape` 关闭并回焦均通过。
- 390×844 真实浏览器验证：checkbox 仍为 14×14px、选项行 38px，浮层完整位于 Todo 面板内，页面无横向溢出；展开前后 Todo 面板和表单的 `offsetTop` 不变。点击时仅浏览器将内部滚动容器自动滚动 48px，不是布局重排或下推。
- 独立复审发现的上海 00:00–00:59 完成时间跨日问题已先用固定 00:30 失败用例复现，再修正并复审通过，无剩余 Critical / Important。

当前 Preview 仍对应 `309ad1c`，不包含最新整行点击修复；替换 Preview 需再次取得当次部署授权。待补全：替换 Preview 技术验收与 PO 产品验收决定。PR 合并与 Production 继续保持独立门禁。
