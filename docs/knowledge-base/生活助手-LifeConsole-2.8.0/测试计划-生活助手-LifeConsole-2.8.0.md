# 测试计划：Life Console 2.8.0

状态：Gate 2 已由 PO 于 2026-08-31 确认；TDD、完整本地回归与 Draft PR CI 已通过，等待 Preview 产品验收授权。

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

1. 390×844 中导航外层高 64px、左右至少 12px、圆角约为半高。
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
- Preview、真实 iPhone 产品验收、PR 合并与 Production 分别需要 PO 当次明确授权。
- 真实 iPhone 验收失败时记录具体设备 / iOS / Safari 或 PWA 模式与几何证据，不以桌面模拟替代。

## 6. 2026-08-31 本地执行记录

- 红灯：组件用例因缺少 `svg[aria-hidden=true]` 失败；iOS 安装契约因缺少 `viewport-fit=cover` 失败，均确认由目标能力缺失触发。
- 绿灯：Vitest 620/620；Life Console Python 93/93；Playwright 合成浏览器 17/17；工作区工具共运行 372 条，其中 371 通过、1 条按 CI 私有契约规则跳过。
- 构建：`npm run build` 退出码 0，130 个模块完成转换；Playwright 启动前的 Sites 合成构建同样成功。
- Production 构建守卫：本机 Vercel 拉取配置不含可用于构建的有效公开 publishable key，守卫按预期拒绝；未伪造变量、未输出配置内容、未发布制品，交由具备合法测试环境变量的 CI 复验。
- 治理：`check_project_governance.py`、当前差异与 `origin/main..HEAD` 历史隐私检查、`git diff --check` 均通过。
- 远端 CI：Draft PR #84 的 node、python、privacy 三项检查分别于 2m13s、1m04s、6s 通过。
