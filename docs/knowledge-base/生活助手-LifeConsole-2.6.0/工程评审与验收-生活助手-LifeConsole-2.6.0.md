# 工程评审与验收：Life Console 2.6.0

状态：验收方案 draft.1；尚无实现、Preview 或 Production 证据。

## 1. 当前基线

- 2.5.0 Production 已有 390px 响应式布局与 iOS 底部安全区样式。
- 当前首页没有 Manifest、Apple Touch Icon 或 iOS Web App 元数据。
- 当前 Vite 配置没有 PWA 插件，源码没有 Service Worker 注册。

以上只证明开发前基线，不是 2.6.0 验收结果。

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

## 4. 尚待产生的证据

- TDD 红灯与绿灯记录。
- 构建产物静态资源和无 Service Worker 证明。
- 受保护合成 Preview 的 HTTP、CSP、390px 浏览器证据。
- PO 在真实 iPhone 上的安装与飞行模式验收结论。
- 独立的 PR 合并与 Production 发布确认。

任何本地、CI 或 Preview 通过都不自动授权 Production 发布。
