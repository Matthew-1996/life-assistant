# 工程评审与验收：Life Console 2.6.0

状态：本地工程与第四次响应式修复后的受保护合成 Preview 验收通过；等待 PO 在真实 iPhone 复验，尚无 Production 证据。

## 1. 当前基线

- 2.5.0 Production 已有 390px 响应式布局与 iOS 底部安全区样式。
- 开发前首页没有 Manifest、Apple Touch Icon 或 iOS Web App 元数据。
- 开发前 Vite 配置没有 PWA 插件，源码没有 Service Worker 注册。

2.6.0 在这一基线上只增加静态安装资产，继续不引入 PWA 插件或 Service Worker。

## 2. 验收矩阵

| 域 | 必须通过 |
|---|---|
| Manifest | 字段、启动路径、scope、standalone、同源图标有效 |
| iOS 元数据 | Manifest、Apple Touch Icon、标题、主题色、状态栏声明存在 |
| 图标 | 180×180 与 512×512 PNG 尺寸、格式和非透明品牌图形正确 |
| 缓存边界 | 无 Service Worker、无 Cache API、无 PWA 缓存依赖或构建产物 |
| 安全 | 严格 CSP、API no-store、认证和 Supabase 数据边界不变 |
| 响应式 | 390px 首页与四页无新增横向溢出或安全区遮挡 |
| 离线 | 飞行模式重新启动 / 刷新出现 iOS 原生网络错误，不进入缓存应用 |
| 真机 | 添加到主屏幕、图标、名称、独立窗口、登录恢复均通过 |

## 3. 门禁命令

实现后至少运行：

```bash
git diff --check
python3 tools/check_project_governance.py
tools/check_git_privacy.sh
python3 -m unittest discover -s tools -p 'test_*.py'
cd apps/life-console && npm test
cd apps/life-console && npm run build:supabase-production
cd apps/life-console && npm run test:e2e:synthetic
```

提交与合并前再执行 `tools/check_git_privacy.sh --history origin/main..HEAD`，并等待远端 CI。

## 4. 本地工程证据

2026-08-29 在隔离 worktree、分支 `agent/life-console-pwa-ios-260` 完成：

- TDD 红灯：新增契约首次运行 3/3 失败，分别暴露缺失的 HTML 元数据、Manifest / PNG 和构建资产；随后新增 PNG 无 Alpha 契约先得到 1 个预期失败。
- TDD 绿灯：`npx vitest run tests/vercel/ios-installation.test.ts` 3/3 通过，读取真实 HTML、Manifest、PNG IHDR 和 Production 构建产物。
- 完整应用门禁：`npm test` 退出码 0；Vitest 81 个文件、606 个测试通过，Python 75 + 7 + 10 + 1，共 93 个测试通过。
- Production 构建：`npm run build:supabase-production` 退出码 0，129 个模块完成转换；Manifest 与两张 PNG 由安装契约确认进入真实构建产物。
- 浏览器回归：第二次重叠修复后 `npm run test:e2e:synthetic` 11/11 通过，包含手机视口、移动端控件与底部导航不重叠、Todo 表单控件彼此不重叠、Production CSP 和写入冲突 / 删除计划流程。
- 仓库门禁：`git diff --check`、治理检查和 Git 隐私检查均退出码 0；根目录工具测试 372 个通过、1 个既有跳过。
- 缓存边界：安装契约确认源码与构建产物不含 `service-worker`、`sw.js`、Workbox 或 `serviceWorker.register`；未增加 Cache API、自定义离线页或离线数据。

沙箱内首次全量运行时，本机回环监听被系统以 `EPERM` 拒绝：Vitest 的 4 个 Miniflare 文件 / 26 个用例和根目录 4 个回环用例因此失败。未修改实现或测试超时；在允许监听 `127.0.0.1` 的本机测试环境原样重跑后，上述完整套件全部通过。

## 5. 390px 重叠修复证据

- Preview 首次检查发现固定底部导航会覆盖滚到视口底部的正文按钮。真实浏览器复现中，“起床状态”的“完成”按钮底边为 `843.875px`，导航栏顶边为 `780px`。
- PO 于 2026-08-29 确认保留底部导航，并让移动端正文使用独立滚动区，在导航栏与 iOS 安全区上方结束。
- 新增 Playwright 行为测试后，旧样式按预期失败；最小 CSS 修复将移动端壳限制在 `100dvh`，正文滚动区为底部导航和安全区预留空间。相同测试随后通过。
- 完整验证使用提交 `65b25ad`：Vitest 81 个文件 / 606 项、应用 Python 93 项、Playwright 10/10、Production 构建 129 个模块、根工具 372 项通过（1 项既有跳过），治理与 Git 隐私检查通过。
- 首次把完整 Vitest、构建和 Playwright 并行运行时，Miniflare 初始化因本地资源争用统一超时；停止并行运行后，在同一提交上单独重跑完整 `npm test` 全部通过，未放宽测试超时或修改相关实现。

## 6. 第一次修复版 Preview 证据（已被二次修复版替代）

- 修复版部署 `dpl_8dSLdf5h2EWMPZ9g6EivmM3FEmv9` 状态为 `READY`、目标为 `preview`：<https://life-console-synthetic-preview-khl2ywqiy-test11-b88a.vercel.app>。
- 制品使用 Build Output API，仅包含 9 个静态文件、0 Functions、0 Cron；匿名访问返回 Vercel SSO 302 与 `cache-control: no-store`，未变更 Production。
- 认证请求下：首页、Manifest 与两张 PNG 图标均为 200；`/api/daily-news` 为 404；CSP 保持 `script-src 'self'` 与 `connect-src 'none'`。远端 Manifest、180×180 RGB PNG 和 512×512 RGB PNG 与本地候选制品逐字节一致。
- 真实浏览器在 390×844 下逐页检查工作台、记录、进展、系统：根页面横向溢出为 0、错误覆盖层为 0、控制台日志为空。对四页共 38 个可见主内容控件逐一执行滚动定位后，与底部导航的交集数为 0；该检查没有计算正文控件彼此之间的交集，因此未捕获 Todo 表单内部重叠。
- 原重叠位置复验中，按钮底边为 `771.98px`，正文滚动区底边为 `772px`，导航栏顶边为 `780px`，保留约 8px 间距；`window.scrollY` 保持 0，滚动只发生在正文区域。
- Preview HTML 可读回 Manifest、Apple Touch Icon、`apple-mobile-web-app-capable=yes` 和 `Life Console` 标题。普通浏览器标签页不是 standalone 模式；添加到主屏幕后是否独立窗口打开仍由真实 iPhone 验收。

## 7. Todo 表单二次重叠修复与 Preview 证据

- PO 于 2026-08-29 反馈 390px 下“新建 Todo”仍与其他组件重合。真实 Preview 几何测量确认：Todo 快速表单保留两列，DDL 所在列宽 `142.5px`，但 `datetime-local` 输入实际宽 `162.5px`，向右溢出 20px，并与“新建 Todo”按钮产生约 10px 交集。
- 新 Playwright 测试对 Todo 表单 5 个真实输入 / 选择 / 按钮做两两矩形交集检查。旧样式按预期失败并明确输出 `Todo DDL ↔ 新建 Todo`；移动端只增加一条规则，将 `.todo-quick-form` 纳入既有单列网格后，同一测试通过。
- 提交 `9c4d348` 的完整本地门禁：Vitest 81 个文件 / 606 项、应用 Python 93 项、Playwright 11/11、默认与 Production 构建均为 129 个模块、根工具 372 项通过（1 项既有跳过），治理与 Git 隐私检查通过。
- 二次修复版部署 `dpl_BTcVwuQzXZ7rGcstoFP7UWheWNH7` 状态为 `READY`、目标为 `preview`：<https://life-console-synthetic-preview-fpvhb5oui-test11-b88a.vercel.app>。制品仍为 9 个静态文件、0 Functions、0 Cron；匿名访问返回受保护 SSO 302，认证后首页 / Manifest 为 200、`/api/daily-news` 为 404，CSP 保持 `script-src 'self'` 与 `connect-src 'none'`。
- 二次修复版真实浏览器在 390×844 下确认 Todo 表单为单列 `320px`。工作台、记录、进展、系统共 38 个可见交互控件的两两交集数为 0，与底部导航交集数为 0；四页根横向溢出为 0、错误覆盖层为 0、控制台日志为空。

## 8. 记录页 iOS 日期筛选边界修复与 Preview 证据

- PO 于 2026-08-29 反馈记录页“筛选日记日期”控件超出边界。Chromium 390px 下输入与筛选容器同为 `320px`，但源码同时对输入使用 `width: 100%` 和左右各 `14px` padding；WebKit [Bug 301648](https://bugs.webkit.org/show_bug.cgi?id=301648) 已确认 iOS 26 会对这类 date/time 输入错误计算 100% 宽度，并且问题在 iPhone / iPad 上仍未修复。
- 新 Playwright 几何测试使用真实生产 CSS 与同构筛选标记，把 WebKit 多算的左右 padding 表示为 `calc(100% + 28px)`。旧样式按预期失败：输入右边为 `399px`、筛选容器右边为 `371px`；移动端让筛选标签成为可收缩网格，日期输入改用 `width: auto; min-width: 0; max-width: 100%` 后，同一测试通过，同时保留 iOS 原生日历控件外观。
- 提交 `4898454` 的完整本地门禁：Vitest 81 个文件 / 606 项、应用 Python 93 项、Playwright 12/12、默认与 Production 构建均为 129 个模块、根工具 372 项通过（1 项既有跳过），治理与 Git 隐私检查通过。
- 首个新部署 `dpl_3UsDu2KwpP9Sbor8CiRM8uySHNjS` 虽为 READY，但首页静态文件因路由头顺序没有取得预期 CSP，验收时被拒绝且未作为交付结果。修正临时 Build Output 路由后，最终部署 `dpl_5GxRbybcxVTf8dxdt9qmhe9xrXTk` 状态为 `READY`、目标为 `preview`：<https://life-console-synthetic-preview-8hi8d12kr-test11-b88a.vercel.app>。
- 最终制品仍为 9 个静态文件、0 Functions、0 Cron；匿名访问返回 Vercel SSO 302 与 `cache-control: no-store`，认证后首页 / Manifest 为 200、`/api/daily-news` 为 404；CSP 保持 `script-src 'self'`、`connect-src 'none'`，并保留 2.5.0 已批准的 `images.unsplash.com` 图片域。
- 最终 Preview 的真实浏览器 390×844 检查中，日期输入与筛选容器左右边界均为 `35–355px`，计算样式为 `width: 320px; min-width: 0; max-width: 100%`。工作台、记录、进展、系统共 38 个可见交互控件的两两交集数为 0，与底部导航交集数为 0；四页根横向溢出为 0、错误覆盖层为 0、控制台日志为空。

## 9. Todo iOS 日期时间边界修复与 Preview 证据

- PO 于 2026-08-29 反馈 Todo 的“计划开始”和“DDL”两个组件超出边界。Chromium 390px 下两个输入、标签和表单当前均为 `320px`，但源码同时使用 `width: 100%` 与左右各 `10px` padding；与记录页相同，WebKit [Bug 301648](https://bugs.webkit.org/show_bug.cgi?id=301648) 覆盖 `datetime-local`，因此 iOS 会把这 20px 计入原生输入的额外宽度。
- 新 Playwright 几何测试在两个真实 Todo `datetime-local` 控件上模拟 WebKit 多算的 20px。旧样式按预期失败并同时输出 `Todo 计划开始`、`Todo DDL`；移动端把 Todo 标签设为可收缩，并将两个输入改为 `width: auto; min-width: 0; max-width: 100%` 后，同一测试通过。
- 提交 `6120ab1` 的完整本地门禁：Vitest 81 个文件 / 606 项、应用 Python 93 项、Playwright 13/13、默认与 Production 构建均为 129 个模块、根工具 372 项通过（1 项既有跳过），治理、Git 隐私和差异检查通过。
- 修复版部署 `dpl_HSVSZjeb9jdHonoN8r6oq9zaXdXG` 状态为 `READY`、目标为 `preview`：<https://life-console-synthetic-preview-6susynxst-test11-b88a.vercel.app>。制品仍为 9 个静态文件、0 Functions、0 Cron；匿名访问返回受保护 SSO 302 与 `cache-control: no-store`，认证后首页 / Manifest 为 200、`/api/daily-news` 为 404，CSP 保持 `script-src 'self'` 与 `connect-src 'none'`。
- 真实浏览器 390×844 检查中，两个 Todo 日期时间输入及各自标签的左右边界均为 `35–355px`、宽 `320px`，计算样式为 `width: 320px; min-width: 0; max-width: 100%`，各自右侧溢出为 0。工作台、记录、进展、系统共 32 个可见主内容表单控件的两两交集数为 0、横向越界数为 0；底栏按钮自身交集数为 0，四页根横向溢出为 0。

## 10. 尚待产生的证据

- PO 在真实 iPhone 上对第四次响应式修复版的控件布局、安装、独立窗口、登录恢复与飞行模式验收结论。
- 独立的 PR 合并与 Production 发布确认。

任何本地、CI 或 Preview 通过都不自动授权 Production 发布。
