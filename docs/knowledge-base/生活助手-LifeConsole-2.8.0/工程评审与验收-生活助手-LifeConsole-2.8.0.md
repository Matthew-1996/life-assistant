# 工程评审与验收：Life Console 2.8.0

状态：进行中。高度与底距修订已获 PO 认可；20px 侧距修订已通过 TDD 与完整本地回归，等待 Draft PR CI 与新 Preview 技术验收。合并与 Production 均未授权。

## 1. 工程评审

- 改动限于 AppShell 导航表现、移动端安全区 / 几何、内联 SVG 图标及对应测试；不改 Supabase、Owner 数据、API、备份或自动化。
- 移动端使用 `position: fixed` 的 62px 浮动胶囊，左右各 20px、圆角 31px，34px 安全区下物理底距为 21px；页面内容保留到底部，由半透明背景、模糊、描边与阴影维持可读性。
- 四个导航按钮保留原标签、顺序、点击与 `aria-current` 语义；图标为随代码交付的内联 SVG，不引入外部字体、图标 CDN 或新网络依赖。
- 未实现向下滚动自动收起；导航始终常驻。桌面布局继续使用顶部导航。
- Preview 使用候选模式与合成数据，不连接真实数据或持久化，不提供 API、Function、Cron 或离线缓存。

## 2. 开发与门禁证据

- TDD 红灯分别验证缺少 `svg[aria-hidden=true]` 与缺少 `viewport-fit=cover`，随后以最小实现转绿。
- Vitest 620/620；Life Console Python 93/93；Playwright 合成浏览器 17/17；工作区工具共运行 372 项，其中 371 通过、1 项按 CI 私有契约规则跳过。
- 通用 Vite build 与合成 Preview build 均完成 130 个模块转换；Production build 守卫正确拒绝本机 Vercel 配置中的脱敏占位值，未绕过、未发布 Production 制品。
- Draft PR #84 的 node、python、privacy 三项 CI 分别以 2m13s、1m04s、6s 通过。
- `git diff --check`、项目治理、当前差异与 `origin/main..HEAD` 历史隐私检查通过。
- `python3 tools/validate_project.py` 已执行；隔离 worktree 仍因未包含 Git 排除的私人真相源 / 运维文件、两处既有测试夹具启发式命中及一条旧研究链接而返回失败。本次 Preview 文档差异未新增这些命中，因此不把项目总体验证标记为通过。

## 3. Preview 技术验收

- PO 于 2026-08-31 当次授权创建 Preview；首版候选为[受保护的合成数据 Preview](https://life-console-production-lbvbo3rna-test11-b88a.vercel.app)，应用内容提交为 `4e2b5a2`。
- 首次临时构建输出因缺少框架版本元数据而失败；该失败部署已精确删除，修正临时元数据后重新部署成功。未调整应用实现或安全策略。
- 当前候选状态 Ready，target 为 preview；10 个静态文件、0 Functions、0 Cron；首页与 Manifest 返回 200，`/api/daily-news` 返回 404。
- 响应保持 `noindex`、`connect-src 'none'`、`script-src 'self'`、`X-Frame-Options: DENY` 与 `nosniff`；浏览器控制台无 error / warning。
- 默认桌面浏览器加载成功，无白屏、错误浮层或根节点缺失；四页导航与合成工作台均正常渲染。
- 393×852 真实浏览器视口实测：导航 `left=12px`、`right=12px`、`height=64px`、`border-radius=32px`、`bottom=8px`，页面宽度 393px 且无根级横向溢出。
- 工作台、记录、进展、系统逐项点击后均正确更新 `aria-current=page`，页面内容切换成功，导航几何保持不变。
- 内部长内容滚动 650px 后导航仍位于视口底部、`position: fixed`、可见且无 transform，不存在自动收起。

PO 随后在同一设备真机截图中确认首版导航整体偏高，并提供招商银行 App 作为尺寸参照，因此上述首版 Preview 不再作为最新产品验收件。修订候选将外壳调整为 62px 高 / 31px 圆角，并在 34px 底部安全区下将物理底距从约 42px 下调到约 21px；替换 Preview 证据见下一节。

## 4. 招商银行参照替换 Preview

- 当前验收件为[招商银行参照替换 Preview](https://life-console-production-ka0l2h263-test11-b88a.vercel.app)，应用内容提交为 `d3a8e60`；首版 Preview 仅保留历史审计意义，不再作为产品验收件。
- TDD 红灯在旧实现上准确得到 64px 高 / 8px 无安全区底距；修订后 390×844 几何和 402×874 / 34px 安全区用例 2/2 通过，后者得到 62px 高 / 21px 物理底距。
- 完整验证：Playwright 18/18、Vitest 620/620、Life Console Python 93/93、工作区工具 372 项通过 / 1 项跳过；通用与 Preview build 均完成 130 个模块转换。
- Draft PR #84 最新 node、python、privacy CI 分别以 2m04s、1m00s、8s 通过。
- 部署状态 Ready，target 为 preview；10 个静态文件、0 Functions、0 Cron；首页 / Manifest 为 200，`/api/daily-news` 为 404；`noindex`、严格 CSP、`nosniff` 与 `X-Frame-Options: DENY` 保持不变。
- 402×874 远端浏览器实测外壳 62px 高、31px 圆角、左右各 12px；四页切换、滚动 650px 后常驻、52px 点击高度、无横向溢出与控制台无 error / warning 均通过。
- 普通浏览器没有 iPhone safe-area，34px 安全区下的 21px 底距由可控 token 的独立几何用例验证；仍需 PO 在同一 iPhone 上完成材质、Home Indicator 与主屏幕 PWA 观感验收。

## 5. 20px 侧距修订

- 对比图约 50px 的视觉曲率换算为约 31px CSS 半径；本轮保持高度、圆角、底距、内部点击区与交互不变，仅将左右间距由 12px 改为 20px。
- 定向 TDD 在旧实现上因实测 12px 而失败，最小样式修订后通过。
- 完整本地验证：Playwright 18/18、Vitest 620/620、Life Console Python 93/93、工作区工具 372 项通过 / 1 项跳过；通用与 Preview build 均完成 130 个模块转换。
- 新 Preview 还需等待 Draft PR CI、部署检查和远端浏览器技术验收，不将本地结果写成远端或真机证据。

## 6. 未完成门禁

- 当前浏览器技术验收不能替代真实 iPhone Safari 与主屏幕 PWA 的产品验收，尤其是 Home Indicator、真实 safe-area、软键盘、弹层遮挡和材质观感。
- 等待 PO 对当前 Preview 给出产品验收结论。
- PR #84 保持 Draft；合并与 Production 均需后续单独明确授权。
