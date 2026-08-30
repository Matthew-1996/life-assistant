# 上线证据：Life Console 2.6.0

首次发布日期：2026-08-29
最近维护发布：2026-08-31

Life Console 2.6.0 已发布到 [正式站点](https://project-wpabq.vercel.app/)。PR [#77](https://github.com/Matthew-1996/life-assistant/pull/77) 通过 Node、Python、隐私 CI 后 squash merge；Production 源码精确对应 merge commit `c97660b1df4c40b1742dca6d2a401c42aba91230`。

## 1. 发布范围

- 增加 iOS Home Screen Web App Manifest、180×180 Apple Touch Icon、512×512 图标和 Apple Web App 元数据。
- 保持仅联网可用：不增加 Service Worker、自定义离线页、Cache Storage、离线读写、后台同步或 Android 适配。
- 包含经 PO 逐轮验收的 390px 底部导航安全区、Todo 移动端单列、日记日期筛选和 Todo 日期时间输入边界修复。
- 不改变 Supabase、Owner 认证、API、数据库、Cron、模型、自动化或私人数据范围。

## 2. 合并与构建

| 项目 | 结果 |
|---|---|
| PO 门禁 | 最新受保护 Preview 确认“没问题了”，随后明确要求继续开发上线 |
| PR | #77 squash merge；Node、Python、隐私 CI 全部通过 |
| 合并前本地门禁 | Vitest 606、应用 Python 93、Playwright 13、仓库工具 372（1 个既有跳过）通过 |
| Production 构建 | 129 个模块完成；使用既有 `supabase-production` 模式与 Production 配置 |
| 数据边界 | 无 migration、无 Owner 写入、无 Cron / 模型调用 |

## 3. Production 只读验收

| 边界 | 结果 |
|---|---|
| 部署 | 既有 `life-console-production` 项目为 READY；稳定正式别名指向准确 merge commit |
| 首页 | HTTP 200；React 渲染出 Life Console Online 页面，无错误覆盖层 |
| 安全头 | 严格 CSP 保持 `script-src 'self'`；`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY` |
| Manifest | HTTP 200、`application/manifest+json`；`start_url=/`、`scope=/`、`display=standalone` |
| 图标 | Apple Touch Icon 为 180×180 PNG，与合并后的本地制品逐字节一致 |
| 离线边界 | `/service-worker.js` 404；浏览器 Service Worker 注册数 0、Cache Storage 名称数 0 |
| 未登录 API | 空 POST `/api/journal-normalize-health` 返回 `401 / no-store`，未进入模型或数据路径 |
| 390px 布局 | 四页共 108 个可见主内容表单控件：互叠、横向越界、底栏自身交集、根横向溢出均为 0 |
| iOS 日期控件 | Todo“计划开始”/“DDL”和日记日期筛选均与各自标签同宽 `320px`，右侧溢出 0 |

## 4. 隐私与副作用

发布后验收仅检查公开静态资产、安全头、页面几何和未登录鉴权门禁。没有提交页面表单，没有读取或记录日记正文、健康值、Owner 标识或凭据，没有触发 Cron、DeepSeek 或其他模型，也没有写数据库。

## 5. 发布后真机复验

正式域名已经具备安装条件。PO 仍需在 iPhone 上删除旧 Preview 主屏幕图标，从正式域名重新“添加到主屏幕”，然后复验：

1. 图标和名称为 Life Console；
2. 从主屏幕进入独立窗口，并能恢复 Owner 登录；
3. 飞行模式下重新启动或刷新时显示 iOS 原生网络错误，恢复网络后可重新加载。

该发布后复验不影响已经产生的 Production 上线事实，但在 PO 回报前不标记为已完成。

## 6. Todo 编辑弹窗 iOS 日期时间宽度快速维护

- PO 于 2026-08-31 确认受保护 Preview“已验收，符合预期”，随后明确授权合并 PR #82 并完成上线部署。
- PR [#82](https://github.com/Matthew-1996/life-assistant/pull/82) 的 Node、Python、隐私 CI 全部通过后 squash merge；准确 `main` 为 `4274998be90f2ac55fd8f1abdbd21de428703a2a`。功能 worktree、本地分支与远端分支均已在合并后清理。
- 合并前门禁：Vitest 83 个文件 / 618 项、应用 Python 75 + 7 + 10 + 1 项、Playwright 15/15、仓库工具 372 项全部通过（仓库工具 1 项既有跳过）；默认构建 130 个模块完成。回环端口用例在允许本地监听后原样复跑，没有放宽断言或超时。
- Production 从准确 `main` 触发 Vercel 远端构建；Production 环境守卫先于 TypeScript / Vite 执行并通过，130 个模块构建完成。未使用可能包含敏感占位符的本地 `--prebuilt` 制品。
- 新部署为 READY，target 为 Production；稳定正式别名 [project-wpabq.vercel.app](https://project-wpabq.vercel.app/) 已指向新制品。按准确合并 SHA 查询可唯一命中该 Production 部署，近 30 分钟错误日志数量为 0。
- 正式首页和 Manifest 均为 200；严格 CSP 保持 `script-src 'self'`，并保留 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`。`/service-worker.js` 返回 404；未登录空 POST `/api/journal-normalize-health` 返回 `401 / no-store`。
- 真实浏览器在 390×844 下只读打开 Todo 编辑弹窗：Todo 项目、优先级、计划开始、DDL 四个控件均为 `45–345px`、宽 `300px`；两个日期时间控件右侧溢出为 0，根页面与 body 宽均为 390px，控制台无警告或错误。验收后关闭弹窗并恢复默认视口。
- 本次没有提交表单、改变 Todo 状态、读取或记录日记正文、触发 Cron / 模型，且没有数据库迁移或真实数据写入。发布后真机安装 / 离线复验门禁保持不变。
