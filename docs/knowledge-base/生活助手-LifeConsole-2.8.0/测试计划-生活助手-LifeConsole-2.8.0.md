# 测试计划：Life Console 2.8.0

状态：Gate 2 已由 PO 于 2026-08-31 确认；20px 侧距修订已完成 TDD、完整本地回归、Draft PR CI、纯静态 Preview 技术验收与 PO 产品验收，已进入待上线阶段。

## 1. 测试范围

- AppShell 导航语义与四页切换。
- iOS 全屏 viewport、顶部 / 底部 safe-area。
- 390×844 及移动断点下的浮动导航几何。
- 内容透出、最后控件滚动可达性、Toast 与弹层层级。
- PWA 安全边界、严格 CSP、无 Service Worker / Cache Storage 回归。
- 桌面顶部导航与现有功能回归。

## 2. 自动化用例

### 组件 / 契约

1. 四个导航按钮保持原标签、顺序、点击行为和 `aria-current`。
2. 每个移动导航项有 `aria-hidden` 图标，文字仍是可访问名称。
3. viewport 包含 `viewport-fit=cover`；Manifest 与 Apple 元数据保持有效。
4. 源码和构建产物继续拒绝 Service Worker、Cache API 与 PWA 缓存插件。

### Playwright

1. 390×844 中导航外层高 62px、左右各 20px、圆角 31px；402×874 且 34px 底部安全区下，物理底距为 21px。
2. 四个点击目标均不小于 44×44px，无重叠、折行或横向溢出。
3. 页面内容几何上延伸到导航下方，导航 z-index 高于普通内容。
4. 最后一个可操作控件 `scrollIntoView({ block: "end" })` 后完整位于导航顶部以上。
5. Todo 编辑 Sheet、删除确认和其他全屏遮罩在导航之上。
6. 移动 Toast 与导航不重叠。
7. 工作台、记录、进展、系统四页均无根级横向滚动。
8. 桌面宽度下顶部导航结构和点击行为保持不变。

## 3. 构建与门禁

```bash
git diff --check
python3 tools/check_project_governance.py
tools/check_git_privacy.sh
python3 tools/validate_project.py
python3 -m unittest discover -s tools -p 'test_*.py'
cd apps/life-console
npm test
npm run build:supabase-production
npm run test:e2e:synthetic
```

Production 构建只使用去敏 / 合法的环境配置；不得把占位符、凭据或真实数据写入日志和文档。

## 4. 真实 iPhone 验收

1. Safari 普通浏览：顶部状态区、品牌栏、底部浮动导航与 Home Indicator 无遮挡。
2. 主屏幕 PWA：独立窗口启动后四页导航尺寸、侧距、底距和内容透出符合设计稿。
3. 依次聚焦 Todo、日记筛选和其他底部输入控件，软键盘出现后控件仍可见、可操作。
4. 打开 Todo 编辑、删除确认等弹层，导航不穿透、不抢焦点。
5. 上下滚动长页面，导航始终可见且不自动收起。
6. 浅色卡片、蓝色 Hero 和灰色背景经过导航下方时，图标与文字持续可读。
7. 飞行模式行为继续沿用 2.6.0 的系统网络错误边界，不出现离线能力宣称。

## 5. 门禁

- 自动测试通过不构成产品验收。
- Preview、真实 iPhone 产品验收、PR 合并与 Production 分别需要 PO 当次明确授权；本版本四项门禁均已于 2026-08-31 获得明确授权。
- 真实 iPhone 验收失败时记录具体设备 / iOS / Safari 或 PWA 模式与几何证据，不以桌面模拟替代。

## 6. 2026-08-31 本地执行记录

- 红灯：组件用例因缺少 `svg[aria-hidden=true]` 失败；iOS 安装契约因缺少 `viewport-fit=cover` 失败，均确认由目标能力缺失触发。
- 绿灯：Vitest 620/620；Life Console Python 93/93；Playwright 合成浏览器 17/17；工作区工具共运行 372 条，其中 371 通过、1 条按 CI 私有契约规则跳过。
- 构建：`npm run build` 退出码 0，130 个模块完成转换；Playwright 启动前的 Sites 合成构建同样成功。
- Production 构建守卫：本机 Vercel 拉取配置不含可用于构建的有效公开 publishable key，守卫按预期拒绝；未伪造变量、未输出配置内容、未发布制品，交由具备合法测试环境变量的 CI 复验。
- 治理：`check_project_governance.py`、当前差异与 `origin/main..HEAD` 历史隐私检查、`git diff --check` 均通过。
- 远端 CI：Draft PR #84 的 node、python、privacy 三项检查分别于 2m13s、1m04s、6s 通过。

## 7. 2026-08-31 Preview 技术验收

- PO 已当次授权创建合成数据 Preview；首版候选为[受保护的合成数据 Preview](https://life-console-production-lbvbo3rna-test11-b88a.vercel.app)，应用内容提交为 `4e2b5a2`。
- 部署状态 Ready，target 为 preview；10 个静态文件、0 Functions、0 Cron；首页与 Manifest 返回 200，`/api/daily-news` 返回 404。
- 安全边界保持 `noindex`、`connect-src 'none'`、`script-src 'self'`、`X-Frame-Options: DENY` 与 `nosniff`；浏览器控制台无 error / warning。
- 393×852 浏览器视口实测：导航左右各 12px、高 64px、圆角 32px、底部 8px，无根级横向溢出；四项点击目标均可切换并正确更新 `aria-current`。
- 长内容滚动 650px 后导航仍保持固定、可见、无位移或自动收起；工作台、记录、进展、系统四页切换后几何保持一致。
- 本项为真实浏览器的响应式技术验收，不冒充真实 iPhone Safari 或主屏幕 PWA 产品验收。

## 8. 2026-08-31 招商银行参照修订

- PO 在首版 Preview 真机检查中指出导航整体偏高，并提供同一设备上的招商银行 App 截图作为尺寸参照；随后明确要求按该参照修改。
- 同尺寸截图测量：首版 Life Console 外壳约 64px 高、距物理屏幕底部约 42px；招商银行参照约 62px 高、底距约 21px。主要差异来自整个导航被安全区额外抬高，而非图标尺寸。
- 红灯：更新几何用例后，旧实现实测为 64px / 8px（无安全区浏览器）并且不响应 34px 测试安全区 token；两项用例均按预期失败。
- 绿灯：修订为 62px 高、31px 圆角、12px 侧距，并使用 `max(8px, safe-area - 13px)` 后，390×844 与 402×874 / 34px 安全区两项定向用例 2/2 通过。
- 完整回归：Playwright 18/18；允许本机回环监听后原样复跑 Vitest 620/620、Life Console Python 93/93。首次受限沙箱中的 26 个 Miniflare 失败均由 `listen EPERM 127.0.0.1` 触发，未修改测试或超时。
- 工作区工具 372 项通过、1 项按 CI 私有契约规则跳过；通用 build 与替换 Preview build 均完成 130 个模块转换。
- Draft PR #84 最新 node、python、privacy CI 分别以 2m04s、1m00s、8s 通过。
- [招商银行参照替换 Preview](https://life-console-production-ka0l2h263-test11-b88a.vercel.app)状态 Ready，target 为 preview；10 个静态文件、0 Functions、0 Cron；首页 / Manifest 为 200，`/api/daily-news` 为 404，安全响应头保持不变。
- 402×874 远端浏览器实测：62px 高、31px 圆角、左右 12px、无横向溢出；四个入口切换、滚动 650px 后常驻、52px 点击高度和控制台无 error / warning 均通过。普通浏览器没有 iPhone safe-area，因此 34px 安全区下的 21px 底距由上述独立几何用例验证，不混写为真机证据。

## 9. 2026-08-31 20px 侧距修订

- 同机对比图中约 50px 的转角半径换算为约 31px CSS 半径，因此保持 62px 高 / 31px 圆角，仅将两侧最小间距从 12px 改为 20px。
- 红灯：390×844 几何用例改为期望左右各 20px 后，旧实现实测为 12px，按预期失败。
- 绿灯：仅将横向定位改为 `max(20px, env(safe-area-inset-left/right))`，同一用例通过；62px 高、31px 圆角和底部定位断言同时保持通过。
- 完整本地回归：Playwright 18/18、Vitest 620/620、Life Console Python 93/93、工作区工具 372 项通过 / 1 项跳过；通用与 Preview build 均完成 130 个模块转换。
- `git diff --check`、项目治理、索引与 `origin/main..HEAD` 历史隐私检查均通过。`validate_project.py` 仍仅报告隔离 worktree 缺少 Git 排除的私人真相源 / 运维文件、两处既有测试夹具启发式命中及一条旧研究链接，本轮差异未新增命中。
- 应用提交 `68243b5` 的 node、python、privacy CI 分别以 1m52s、1m05s、8s 通过。
- 首次远端源码构建错误识别了五个 API Functions；该候选未交付并已精确删除。随后从已验证的合成构建产物生成隔离 Build Output，部署为纯静态 Preview。
- [20px 侧距 Preview](https://life-console-production-no4wccgkq-test11-b88a.vercel.app)状态 Ready、target 为 preview；10 个静态文件、0 Functions、0 Cron。经认证的首页 / Manifest 为 200，`/api/daily-news` 为 404；`noindex`、严格 CSP、`nosniff` 与 `DENY` 保持不变。
- 402×874 远端浏览器实测：62px 高、31px 圆角、左右各 20px、底距 8px、四个 85×52px 点击区，无横向溢出。四页切换均正确更新 `aria-current=page`，滚动 650px 后导航仍常驻且无 transform，控制台无 error / warning。
