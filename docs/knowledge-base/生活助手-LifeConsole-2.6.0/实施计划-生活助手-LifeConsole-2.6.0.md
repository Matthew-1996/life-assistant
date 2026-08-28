# Life Console 2.6.0 iOS 主屏幕安装 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不引入 Service Worker 或离线数据面的前提下，让 Life Console 可作为 iOS Home Screen Web App 安装并以独立窗口启动。

**Architecture:** 使用 Vite `public/` 交付同源 Manifest 与 PNG 图标，`index.html` 声明标准 Manifest 和 iOS 元数据。测试直接解析 HTML、Manifest、PNG 头和真实 Production 构建产物，既证明安装资产存在，也固定无 Service Worker 的安全边界。

**Tech Stack:** Vite 7、React 19、Vitest 3、Cheerio、Node.js 文件 API、macOS `sips` 静态图标转换。

**Spec:** `docs/knowledge-base/生活助手-LifeConsole-2.6.0/生活助手-LifeConsole-2.6.0.md`

## Global Constraints

- 仅适配 iPhone / iOS Home Screen Web App；Android 与应用商店为非目标。
- 不增加 Service Worker、Workbox、`vite-plugin-pwa`、Cache API、自定义离线页、网络监听或后台能力。
- 不修改 Owner 登录、Supabase Session、API `no-store`、数据库、RLS、自动化和私人数据。
- Manifest、图标和 HTML 元数据全部同源；Production CSP 保持 `script-src 'self'` 且不新增来源。
- 从主屏幕启动使用 `display: "standalone"`；离线重新启动或刷新继续使用 Safari / iOS 原生错误。
- 所有生产文件先有失败测试；真实 iPhone 安装验收与 Production 发布保持独立 PO 门禁。

---

### Task 1: 固化 Gate 1 / Gate 2 与实施状态

**Files:**
- Modify: `docs/knowledge-base/README.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.6.0/README.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.6.0/生活助手-LifeConsole-2.6.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.6.0/需求评审报告-生活助手-LifeConsole-2.6.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.6.0/设计方案-生活助手-LifeConsole-2.6.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.6.0/技术方案-生活助手-LifeConsole-2.6.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.6.0/项目管理-生活助手-LifeConsole-2.6.0.md`
- Create: `docs/knowledge-base/生活助手-LifeConsole-2.6.0/实施计划-生活助手-LifeConsole-2.6.0.md`

**Interfaces:**
- Consumes: PO 于 2026-08-29 对 Gate 1 / Gate 2 的明确确认。
- Produces: 可执行的书面基线；不产生应用行为。

- [ ] **Step 1: 更新 Gate 状态**

把 PRD、需求评审、设计和技术方案分别标为 Gate 1 / Gate 2 已确认；PMO 进入“待联调 / 进行中”，并继续标明未实现、未 Preview、未上线。

- [ ] **Step 2: 校验文档**

Run:

```bash
git diff --check
python3 tools/check_project_governance.py
tools/check_git_privacy.sh
```

Expected: 三条命令退出码均为 0；治理和隐私脚本打印 `PASS`。

- [ ] **Step 3: 提交 Gate 与计划**

```bash
git add docs/knowledge-base/README.md docs/knowledge-base/生活助手-LifeConsole-2.6.0
git commit -m "docs: approve Life Console 2.6.0 PWA design"
```

### Task 2: 用失败契约定义 iOS 安装资产

**Files:**
- Create: `apps/life-console/tests/vercel/ios-installation.test.ts`

**Interfaces:**
- Consumes: `apps/life-console/index.html`、`apps/life-console/public/` 和 Vite `build()`。
- Produces: 安装元数据、PNG 尺寸和无 Service Worker 构建边界的自动化契约。

- [ ] **Step 1: 安装锁定依赖**

Run:

```bash
cd apps/life-console && npm ci
```

Expected: 安装成功，不修改 `package-lock.json`。

- [ ] **Step 2: 写失败测试**

创建 `tests/vercel/ios-installation.test.ts`，使用 `cheerio.load()` 解析 `index.html`，并实现以下真实边界：

```ts
it("declares an iOS standalone home-screen app", () => {
  expect($("link[rel='manifest']").attr("href")).toBe("/manifest.webmanifest");
  expect($("link[rel='apple-touch-icon']").attr("href")).toBe("/apple-touch-icon.png");
  expect($("meta[name='apple-mobile-web-app-capable']").attr("content")).toBe("yes");
  expect($("meta[name='apple-mobile-web-app-title']").attr("content")).toBe("Life Console");
  expect($("meta[name='apple-mobile-web-app-status-bar-style']").attr("content")).toBe("default");
  expect($("meta[name='theme-color']").attr("content")).toBe("#f5f5f7");

  expect(manifest).toMatchObject({
    id: "/",
    name: "Life Console",
    short_name: "Life Console",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5f7",
    theme_color: "#f5f5f7",
  });
});
```

用 PNG IHDR 的第 16–23 字节读取宽高，逐字面量断言 180×180 和 512×512。调用真实 Vite Production 构建，断言输出包含 `manifest.webmanifest` 与两个 PNG，并且输出文件名和文本不包含 `service-worker`、`sw.js`、`workbox` 或 `serviceWorker.register`。

- [ ] **Step 3: 运行测试并观察正确红灯**

Run:

```bash
cd apps/life-console && npx vitest run tests/vercel/ios-installation.test.ts
```

Expected: FAIL；原因是 Manifest、Apple Touch Icon、元数据或 PNG 文件不存在，而不是测试语法或依赖错误。

### Task 3: 添加最小安装配置与图标

**Files:**
- Modify: `apps/life-console/index.html`
- Create: `apps/life-console/public/manifest.webmanifest`
- Create: `apps/life-console/public/apple-touch-icon.png`
- Create: `apps/life-console/public/life-console-icon-512.png`
- Test: `apps/life-console/tests/vercel/ios-installation.test.ts`

**Interfaces:**
- Consumes: 现有 `public/favicon.svg` 品牌图形。
- Produces: iOS 主屏幕安装配置；不产生运行时脚本或缓存。

- [ ] **Step 1: 添加 HTML 元数据**

在现有 favicon 后增加：

```html
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<meta name="theme-color" content="#f5f5f7" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="Life Console" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
```

- [ ] **Step 2: 添加 Manifest**

创建：

```json
{
  "id": "/",
  "name": "Life Console",
  "short_name": "Life Console",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#f5f5f7",
  "theme_color": "#f5f5f7",
  "icons": [
    { "src": "/apple-touch-icon.png", "sizes": "180x180", "type": "image/png" },
    { "src": "/life-console-icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 3: 从现有 SVG 导出 PNG**

使用系统 `sips` 从 `public/favicon.svg` 导出 180×180 与 512×512 PNG；不引入新的 npm 图片依赖。输出由测试读取真实 PNG IHDR 校验。

- [ ] **Step 4: 运行定向测试并观察绿灯**

Run:

```bash
cd apps/life-console && npx vitest run tests/vercel/ios-installation.test.ts
```

Expected: 所有 iOS 安装测试 PASS；Production 构建中存在批准资产且没有 Service Worker。

- [ ] **Step 5: 提交实现**

```bash
git add apps/life-console/index.html apps/life-console/public/manifest.webmanifest apps/life-console/public/apple-touch-icon.png apps/life-console/public/life-console-icon-512.png apps/life-console/tests/vercel/ios-installation.test.ts
git commit -m "feat: add iOS home-screen installation"
```

### Task 4: 全量验证与本地工程证据

**Files:**
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.6.0/工程评审与验收-生活助手-LifeConsole-2.6.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.6.0/项目管理-生活助手-LifeConsole-2.6.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.6.0/README.md`

**Interfaces:**
- Consumes: Task 3 的提交与完整验证输出。
- Produces: 去敏本地验收记录；不产生 Preview 或 Production 授权。

- [ ] **Step 1: 运行应用门禁**

Run:

```bash
cd apps/life-console && npm test
cd apps/life-console && npm run build:supabase-production
cd apps/life-console && npm run test:e2e:synthetic
```

Expected: 全部退出码 0；构建与浏览器回归没有新增错误。

- [ ] **Step 2: 运行仓库门禁**

Run:

```bash
git diff --check
python3 tools/check_project_governance.py
tools/check_git_privacy.sh
python3 -m unittest discover -s tools -p 'test_*.py'
```

Expected: 全部退出码 0；如隔离 worktree 的既有私人文件缺失影响某项，必须如实记录而不得复制私人资料。

- [ ] **Step 3: 更新工程证据**

只记录命令、退出状态、测试计数、构建结论和无 Service Worker 边界；不记录 Owner 数据、凭据、资源 ID 或部署 ID。PMO 保持 Preview、真机验收、合并和 Production 为独立 pending 门禁。

- [ ] **Step 4: 提交并推送 Draft PR**

```bash
git add docs/knowledge-base/生活助手-LifeConsole-2.6.0
git commit -m "docs: record local iOS installation verification"
git push
```

Expected: Draft PR #77 仍为 Draft；未创建 Preview、未合并、未发布 Production。
