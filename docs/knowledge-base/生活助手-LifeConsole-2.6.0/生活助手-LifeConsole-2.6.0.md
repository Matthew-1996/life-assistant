# PRD：Life Console 2.6.0

状态：Gate 1 已由 PO 于 2026-08-29 确认；按已批准范围进入实施计划与 Gate 2 方案执行。

## 1. 背景与目标

Life Console 2.5.0 已具备 390px 移动布局，但 Production 没有 Web App Manifest、iOS 主屏幕图标或独立窗口声明。用户希望把网站放到 iPhone 主屏幕，并选择最简单的 iOS 适配：离线时接受 Safari / iOS 原生网络错误，不建设自定义离线能力。

成功目标：

1. 用户可以从 iPhone 的浏览器分享菜单把 Life Console 添加到主屏幕。
2. 主屏幕显示明确的 Life Console 名称与专用图标。
3. 从主屏幕启动时以独立 Web App 窗口打开，而不是普通浏览器标签页。
4. 不新增 Service Worker、Cache Storage、离线页面、离线读写或后台能力。
5. 不改变 Owner 登录、Supabase 真相源、API、数据库、自动化和私人数据边界。

## 2. 产品范围

- 增加 Web App Manifest，固定应用标识、名称、启动路径、作用域、独立显示模式和主题色。
- 增加 iOS `apple-touch-icon`，避免系统使用字母或页面截图作为主屏幕图标。
- 增加兼容 iOS Home Screen Web App 的 HTML 元数据。
- 保持现有 390px 页面布局、四页导航、Owner 登录和错误反馈；不新增安装引导弹窗或设置入口。
- 交付一份“分享 → 添加到主屏幕 → 打开为网页 App”的简短安装说明。

## 3. 在线与离线语义

- 本版本没有 Service Worker，不缓存应用壳或私人数据，也不拦截导航。
- 在离线状态下重新启动、刷新或导航时，由 Safari / iOS 展示原生网络错误；产品不伪造可用状态。
- 如果页面已在线加载后网络中断，当前已渲染内容可能暂时留在屏幕上，直到刷新、导航或新的网络请求失败。本版本不主动监听网络状态、不遮挡已加载页面。
- 所有真实读写继续依赖现有 Supabase / API 网络链路；本版本不新增离线提交、排队、重试或本地真相源。
- 现有 Supabase Session 持久化和加密临时草稿机制不因本版本改变；“不新增离线缓存”特指不新增 PWA Service Worker / Cache Storage 数据面。

## 4. 非目标

- Android、桌面浏览器或应用商店打包。
- Service Worker、自定义离线页、预缓存、运行时缓存、后台同步和推送通知。
- `beforeinstallprompt`、安装横幅、二维码或自动判断是否已安装。
- 修改认证持久化、退出策略、日记草稿、Owner 数据或 Supabase Schema。
- 因 PWA 适配顺带修复 2.5.0 已搁置的每日新闻展示。

## 5. 成功标准

- Manifest 可通过 HTTPS 正确读取，字段与图标文件有效。
- iPhone 添加到主屏幕后显示指定名称与图标；从图标启动进入独立窗口。
- 390px 页面没有新增横向溢出，底部导航没有被 iOS 安全区遮挡。
- 构建产物中不存在 Service Worker 注册或新增 Cache Storage 逻辑。
- Preview 与 Production 严格 CSP 不增加 `unsafe-eval`、外部域名或新数据权限。
- 飞行模式下重新启动或刷新不会进入自定义离线应用界面；恢复网络后可重新加载。
- 自动化测试、合成 Preview 和真实 iPhone 验收均通过后，才可申请 Production 发布确认。

## 6. PO 门禁

1. Gate 1：已确认，包括“断网后已加载页面不会被主动遮挡”的限制。
2. Gate 2：已确认图标方向、Manifest / iOS 元数据、禁止 Service Worker 和测试方案。
3. Preview 验收、PR 合并、Production 发布和发布后真实 iPhone 复验分别需要当次明确确认。
