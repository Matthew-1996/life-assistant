# 工程评审与验收：Life Console 2.6.0

状态：本地工程与受保护合成 Preview 验收通过；尚无真实 iPhone 或 Production 证据。

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
- 浏览器回归：`npm run test:e2e:synthetic` 10/10 通过，包含手机视口、移动端控件与底部导航不重叠、Production CSP 和写入冲突 / 删除计划流程。
- 仓库门禁：`git diff --check`、治理检查和 Git 隐私检查均退出码 0；根目录工具测试 372 个通过、1 个既有跳过。
- 缓存边界：安装契约确认源码与构建产物不含 `service-worker`、`sw.js`、Workbox 或 `serviceWorker.register`；未增加 Cache API、自定义离线页或离线数据。

沙箱内首次全量运行时，本机回环监听被系统以 `EPERM` 拒绝：Vitest 的 4 个 Miniflare 文件 / 26 个用例和根目录 4 个回环用例因此失败。未修改实现或测试超时；在允许监听 `127.0.0.1` 的本机测试环境原样重跑后，上述完整套件全部通过。

## 5. 390px 重叠修复证据

- Preview 首次检查发现固定底部导航会覆盖滚到视口底部的正文按钮。真实浏览器复现中，“起床状态”的“完成”按钮底边为 `843.875px`，导航栏顶边为 `780px`。
- PO 于 2026-08-29 确认保留底部导航，并让移动端正文使用独立滚动区，在导航栏与 iOS 安全区上方结束。
- 新增 Playwright 行为测试后，旧样式按预期失败；最小 CSS 修复将移动端壳限制在 `100dvh`，正文滚动区为底部导航和安全区预留空间。相同测试随后通过。
- 完整验证使用提交 `65b25ad`：Vitest 81 个文件 / 606 项、应用 Python 93 项、Playwright 10/10、Production 构建 129 个模块、根工具 372 项通过（1 项既有跳过），治理与 Git 隐私检查通过。
- 首次把完整 Vitest、构建和 Playwright 并行运行时，Miniflare 初始化因本地资源争用统一超时；停止并行运行后，在同一提交上单独重跑完整 `npm test` 全部通过，未放宽测试超时或修改相关实现。

## 6. 受保护合成 Preview 证据

- 修复版部署 `dpl_8dSLdf5h2EWMPZ9g6EivmM3FEmv9` 状态为 `READY`、目标为 `preview`：<https://life-console-synthetic-preview-khl2ywqiy-test11-b88a.vercel.app>。
- 制品使用 Build Output API，仅包含 9 个静态文件、0 Functions、0 Cron；匿名访问返回 Vercel SSO 302 与 `cache-control: no-store`，未变更 Production。
- 认证请求下：首页、Manifest 与两张 PNG 图标均为 200；`/api/daily-news` 为 404；CSP 保持 `script-src 'self'` 与 `connect-src 'none'`。远端 Manifest、180×180 RGB PNG 和 512×512 RGB PNG 与本地候选制品逐字节一致。
- 真实浏览器在 390×844 下逐页检查工作台、记录、进展、系统：根页面横向溢出为 0、错误覆盖层为 0、控制台日志为空。对四页共 38 个可见主内容控件逐一执行滚动定位后，与底部导航的交集数为 0。
- 原重叠位置复验中，按钮底边为 `771.98px`，正文滚动区底边为 `772px`，导航栏顶边为 `780px`，保留约 8px 间距；`window.scrollY` 保持 0，滚动只发生在正文区域。
- Preview HTML 可读回 Manifest、Apple Touch Icon、`apple-mobile-web-app-capable=yes` 和 `Life Console` 标题。普通浏览器标签页不是 standalone 模式；添加到主屏幕后是否独立窗口打开仍由真实 iPhone 验收。

## 7. 尚待产生的证据

- PO 在真实 iPhone 上的安装、独立窗口、登录恢复与飞行模式验收结论。
- 独立的 PR 合并与 Production 发布确认。

任何本地、CI 或 Preview 通过都不自动授权 Production 发布。
