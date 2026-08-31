# 技术方案：Life Console 2.8.0

状态：Gate 2 已由 PO 于 2026-08-31 确认；20px 侧距修订已通过本地、CI 与纯静态 Preview 技术验收。

## 1. 当前结构

- `src/components/shell/AppShell.tsx` 在同一导航数据源中渲染桌面顶部导航和移动底部导航。
- `src/styles/legacy-surfaces.css` 在 720px 以下把 `.topbar nav` 设为固定定位：高度 56px、左右 12px、底部 `max(8px, env(safe-area-inset-bottom))`。
- `.workspace` 当前通过底部 `margin-bottom` 提前避开导航，因此内容并没有从导航下方经过。
- `index.html` 当前 viewport 未声明 `viewport-fit=cover`；这是 2.6.0 为降低顶部安全区改动而作的明确选择。

## 2. 目标架构

```text
full-screen iOS viewport (`viewport-fit=cover`)
  ├─ safe top bar (`safe-area-inset-top`)
  ├─ scrollable workspace and page content
  │    └─ bottom content reserve / scroll padding
  ├─ fixed floating tab bar
  │    └─ four semantic buttons with inline SVG icons
  └─ higher overlays: sheets / dialogs / mobile toast
```

不新增 React Portal、浮层库、路由库、第三方图标包、后端模块或数据接口。

## 3. 预计修改模块

### `index.html`

- viewport 增加 `viewport-fit=cover`。
- 保持 Manifest、Apple 元数据、状态栏模式与严格 CSP 边界不变。

### `src/components/shell/AppShell.tsx`

- 为每个导航配置增加稳定的图标标识。
- 使用应用内联 SVG 组件渲染 20px 单色线性图标，`aria-hidden="true"`。
- 保留现有按钮、标签、`aria-current` 和 `onNavigate` 行为。
- 桌面端可以隐藏图标，避免改变现有顶部导航信息密度。

### `src/styles/legacy-surfaces.css`

- 顶部容器高度 / padding 纳入 `safe-area-inset-top`。
- 移除移动 `.workspace` 为导航预留的外部 `margin-bottom`。
- 为 `.page-content` 和滚动容器增加由导航高度、间距和底部安全区组成的底部留量。
- 将移动导航改为 62px 高、31px 圆角的固定浮层。
- 左右位置使用 `max(20px, env(safe-area-inset-left/right))`。
- 以 `--mobile-safe-area-bottom: env(safe-area-inset-bottom)` 作为可验证的安全区 token；底部位置使用 `max(8px, calc(var(--mobile-safe-area-bottom) - 13px))`，在 34px iPhone 安全区下得到 21px。
- 增加 WebKit 与标准 `backdrop-filter`，并提供 `@supports` 不可用时的高不透明回退。
- 调整当前页内层表面、图标、标签、焦点和 reduced-motion 样式。
- 将移动 `.candidate-toast` 的 bottom 锚点移到导航顶部以上。

### 测试

- 在现有 UI 单测中覆盖图标、标签、`aria-current` 与点击导航行为。
- 在 `tests/playwright/synthetic-write.spec.ts` 扩展移动几何断言。
- 在 `tests/vercel/ios-installation.test.ts` 增加 viewport 全屏契约与 PWA 安全边界回归。

## 4. CSS 几何模型

定义移动导航常量：

```text
bar height = 62px
physical bottom gap = max(8px, safe bottom - 13px)
safe bottom = --mobile-safe-area-bottom = env(safe-area-inset-bottom)
minimum content gap above bar = 24px
```

内容底部留量至少为：

```text
62px + physical bottom gap + 24px
```

外层导航不参与文档流；滚动容器继续拥有独立滚动。点击与焦点目标必须在最终滚动位置完全位于导航顶部以上。

## 5. 层级与交互

- 导航继续使用当前 `z-index: 40` 量级。
- Todo Sheet / 删除确认等现有 `z-index: 70` 遮罩保持在导航之上。
- Toast 不能同时处于导航下方；移动 bottom 位置由导航总高度计算。
- 不增加滚动监听、`IntersectionObserver`、计时器、动画状态或导航折叠状态。
- 不改变页面状态保存或导航事件流。

## 6. PWA 与数据边界

- 不增加 Service Worker、Cache API、离线应用壳或后台同步。
- 不缓存 Supabase、认证、API 或私人数据。
- 不修改 Session 持久化、Owner Auth Gate、API `no-store`、CSP、RLS 或数据库。
- 所有图标由同源代码渲染，无新网络来源和 CSP 白名单。
- 普通 Safari 与 `display: standalone` 使用相同代码；真实 iPhone 分别验收。

## 7. TDD 顺序

1. 先写失败的 AppShell 语义测试：四个图标存在、图标不替代文字、当前页语义不变。
2. 先写失败的 viewport 契约测试：要求 `viewport-fit=cover`，同时拒绝 Service Worker / 缓存边界回归。
3. 先写失败的 390×844 几何测试，并在 402×874 下将安全区 token 设为 34px：验证 62px 高度、31px 圆角、21px 物理底距、内容透出及最后控件可滚到导航上方。
4. 先写失败的层级测试：Sheet / Dialog 在导航之上，Toast 在导航之上且不重叠。
5. 完成最小实现，运行定向测试、完整 `npm test`、Production build 与 Playwright。
6. 仅在 PO 单独授权后创建合成数据 Preview；真实 iPhone 验收不能由桌面浏览器替代。

## 8. 回滚

- 代码回滚只需恢复 2.7.0 的 `index.html`、AppShell 导航标记和移动端样式。
- 不涉及数据迁移、缓存清理、数据库回滚或用户记录修复。
- Production 回滚仍使用上一已知可用 Vercel 制品；本技术方案本身不含发布授权。

## 9. Gate 2 评审项

1. 确认启用 `viewport-fit=cover`，接受同时调整顶部和底部安全区。
2. 初版确认 64px 高度、32px 圆角、12px 侧距、`safe-area + 8px` 底距；经两轮 Preview 真机参照反馈，PO 最终确认为 62px、31px CSS 圆角、20px 侧距，并在 34px 安全区下使用 21px 物理底距。
3. 确认增加四个内联 SVG 图标并持续显示文字标签。
4. 确认不实现滚动自动收起或原生 Liquid Glass 专有行为。
