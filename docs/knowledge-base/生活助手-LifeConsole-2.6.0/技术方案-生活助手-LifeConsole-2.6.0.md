# 技术方案：Life Console 2.6.0

状态：Gate 2 已由 PO 于 2026-08-29 确认，可按本方案进入 TDD 实现。

## 1. 总体方案

```text
iPhone Share Menu
  → Add to Home Screen
  → Web App Manifest (`display: standalone`)
  → same-origin `/`
  → existing Vite / React / Supabase Production app

No Service Worker
No Cache Storage
No offline application shell
No new API or database path
```

WebKit 当前允许任意网站添加到主屏幕；Manifest 仍用于稳定声明应用名称、图标、标识、启动路径和独立显示模式。为兼容不同 iOS 版本，同时提供标准 Manifest 与 Apple 元数据。

## 2. 静态资产与元数据

### `public/manifest.webmanifest`

固定字段：

- `id: "/"`
- `name: "Life Console"`
- `short_name: "Life Console"`
- `start_url: "/"`
- `scope: "/"`
- `display: "standalone"`
- `background_color` 与 `theme_color` 使用现有浅色品牌色
- `icons` 只引用同源 PNG，至少包含 180×180 iOS 图标与 512×512 母版

不声明 orientation、shortcuts、share_target、protocol_handlers、screenshots 或 Android 专属 maskable 图标。

### `index.html`

- 增加 `<link rel="manifest" href="/manifest.webmanifest">`。
- 增加 `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`。
- 增加 `theme-color`、`apple-mobile-web-app-capable=yes`、`apple-mobile-web-app-title=Life Console` 和默认状态栏样式。
- 保留现有 viewport，不增加 `viewport-fit=cover`，避免为最小适配引入新的顶部安全区布局变化。

### 图标源

- `assets/life-console-icon-source.svg` 复用现有 Life Console 渐变、L 形标识与蓝色圆点，但使用不透明满幅方形背景，不预先裁切 iOS 圆角。
- 180×180 与 512×512 PNG 从该母版导出并规范化为无 Alpha 的 RGB PNG；iOS 在主屏幕展示时负责最终形状裁切。

## 3. 明确禁止的实现

- 不增加 `service-worker.js`、`sw.js`、`navigator.serviceWorker.register`、Workbox 或 `vite-plugin-pwa`。
- 不调用 Cache API，不声明离线回退，不缓存 HTML、JS、CSS、API 或 Supabase 响应。
- 不修改 `createLifeConsoleSupabaseClient` 的 Session 持久化行为。
- 不修改 API `cache: "no-store"`、严格 CSP、RLS、数据库 Schema 或 Vercel Function。
- 不新增网络状态监听、心跳探针或全屏离线遮罩。

## 4. 构建与部署

- Vite `public/` 静态资源原样进入所有构建模式。
- Production 与合成 Preview 必须返回 Manifest 和 PNG 的正确内容类型；未知 API 路由仍保持现有 404 边界。
- 所有新增资源同源，CSP 不增加来源；`script-src 'self'` 保持不变。
- 回滚只需恢复上一 Vercel Production；没有数据库、缓存或用户数据需要迁移或清理。

## 5. 测试策略

### TDD 自动测试

1. 先写失败的静态契约测试，要求 `index.html` 引用 Manifest、iOS 图标和必要元数据。
2. 先写失败的 Manifest 契约测试，校验字段、同源路径、PNG 尺寸、无 Alpha 与文件存在。
3. 先写失败的边界测试，扫描源码和构建产物，拒绝 Service Worker 注册、PWA 缓存插件和 Service Worker 文件。
4. 构建后验证 Manifest、图标、首页与严格 CSP；复跑现有 390px Playwright 回归。

### 真实 iPhone 验收

1. 从 Preview 添加到主屏幕，核对名称和图标。
2. 从图标启动，核对独立窗口、登录恢复和四页导航。
3. 飞行模式下重新启动或刷新，确认出现系统网络错误而非缓存应用。
4. 恢复网络后重新打开，确认正常加载。

浏览器自动化不能替代真实 iPhone Home Screen 安装验收。

## 6. 参考依据

- [WebKit：Home Screen Web Apps、Manifest 独立显示与图标优先级](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [WebKit：Safari 15.4 Manifest 与图标支持](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)
- [WebKit：iOS 26 添加到主屏幕行为](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
