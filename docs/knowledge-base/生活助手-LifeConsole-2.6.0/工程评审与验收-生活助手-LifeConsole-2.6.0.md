# 工程评审与验收：Life Console 2.6.0

状态：本地工程验收通过；尚无 Preview、真实 iPhone 或 Production 证据。

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
- 浏览器回归：`npm run test:e2e:synthetic` 9/9 通过，包含手机视口、Production CSP 和写入冲突 / 删除计划流程。
- 仓库门禁：`git diff --check`、治理检查和 Git 隐私检查均退出码 0；根目录工具测试 372 个通过、1 个既有跳过。
- 缓存边界：安装契约确认源码与构建产物不含 `service-worker`、`sw.js`、Workbox 或 `serviceWorker.register`；未增加 Cache API、自定义离线页或离线数据。

沙箱内首次全量运行时，本机回环监听被系统以 `EPERM` 拒绝：Vitest 的 4 个 Miniflare 文件 / 26 个用例和根目录 4 个回环用例因此失败。未修改实现或测试超时；在允许监听 `127.0.0.1` 的本机测试环境原样重跑后，上述完整套件全部通过。

## 5. 尚待产生的证据

- 受保护合成 Preview 的 HTTP、CSP、Manifest、图标和 390px 浏览器证据。
- PO 在真实 iPhone 上的安装、独立窗口、登录恢复与飞行模式验收结论。
- 独立的 PR 合并与 Production 发布确认。

任何本地、CI 或 Preview 通过都不自动授权 Production 发布。
