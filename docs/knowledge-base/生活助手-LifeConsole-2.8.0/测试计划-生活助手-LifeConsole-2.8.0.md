# 测试计划：Life Console 2.8.0

状态：Gate 2 已由 PO 于 2026-08-31 确认；TDD 定向测试与无端口回归已通过，完整 CI 待 Draft PR 更新后复验。

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
- 绿灯：组件 28/28、iOS 安装契约 4/4、无本机端口 Vitest 回归 594/594 通过。
- 构建：`npm run build` 退出码 0，130 个模块完成转换；Production 构建因本地未注入所需 Supabase 公共环境变量而未执行，不伪造变量绕过构建守卫。
- 治理：`check_project_governance.py`、`check_git_privacy.sh` 与 `git diff --check` 通过。
- 环境限制：受管沙箱禁止回环端口，Miniflare、Hub 与 Playwright 本地执行分别出现 `EPERM` 或测试服务无法启动；这些用例必须由 Draft PR CI 复验，当前不记为通过。
