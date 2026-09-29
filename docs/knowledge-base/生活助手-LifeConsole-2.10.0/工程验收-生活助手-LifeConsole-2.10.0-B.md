# 阶段 B 工程验收 · Life Console 2.10.0

日期：2026-09-28。状态：待验收（站内候选，工程测试已完成）。PO 在阶段 A 收口说明后回复“继续”，授权工作台界面与合成联调。本次不代表真实数据迁移、订阅、合并或上线许可。

## 交付与范围

- 原 TodoPanel、范围/状态筛选/列表/甘特和布局保持。健身计划独占其下方；仅移除 TodayPage 的锚点展示及相关局部草稿/冲突逻辑。共享 checkin、记录页和数据模型未删改。
- 月历周一开始，42 格、上下月/今天/相邻月选择；默认上海今天，每日摘要两项及超出计数，日详情按时间显示。
- 新增/编辑原生侧边 dialog；日期默认选中日，事件与起止时间由用户填写；地点空显示待定，备注纯文本保留换行。重叠只提醒、不阻止，改动草稿关闭先确认。
- 创建未知结果锁定原提交与幂等键，后续认证错误也不丢键；编辑冲突保留草稿，读取当前版本核对后重提；已删不可复活。删除须确认，冲突后可取消并刷新。成功改期跳新日期。
- 读取完整范围所有游标页后才替换；任一页失败不展示半页/伪空态，旧月份或旧会话响应不落入当前页面。草稿仅当前组件内存，刷新/关闭面板/退出会话可能丢失，不持久化到 iCloud 或浏览器存储。
- 真实适配器在 Supabase/self-hosted 模式认证后接入；服务缺失明确不可用，不回退合成数据。candidate-only repository 动态导入、仅内存演示；生产包排除其合成内容。未开放 Apple 订阅入口。

## 验证证据

| 项目 | 结果 | 限定 |
|---|---|---|
| 健身界面测试 | 12 项通过 | 多预约、长文本安全、失败原键重试、401 后原键、冲突改期、删除恢复、分页故障、切月失效、来源变化、重复提交、草稿确认与重叠 |
| UI → FitnessRepository → SQL RPC | 1 项通过 | PGlite 隔离库，验证创建、跨月改期、revision 与软删；fetch 桥接不是实际 PostgREST HTTP 错误全契约 |
| 新增原生 Chrome | 3 项通过 | 1440、1280、390px；完整 Todo 在上、健身在下、无横向溢出、CRUD、长备注、Esc、初始焦点/回焦、键盘约束；无 pageerror |
| 现有浏览器回归 | 4 项通过 | desktop/mobile 四页面、底部导航不遮挡按钮、1440/1280/1024/390px 工作台布局 |
| 完整 npm test | 679 Vitest + 93 Python 通过 | 87 Vitest 文件；含生产包边界与契约生成无差异 |
| npm run build | 通过 | 类型检查与 Vite 构建；产物未部署 |
| 项目 Python | 372 项运行，成功，1 跳过 | 通用工具回归 |
| 独立代码审阅 | 已关闭 2 个 P2，无剩余 P0–P2 | 幂等键跨认证错误保留、删除冲突恢复均先复现失败再修复；最终新增交互只读复核通过 |

退休锚点 UI 的 9 项旧用例随展示移除；保留共享 checkin API 测试。两项 dashboard 刷新竞态测试改由仍存在的记录保存入口触发，未删除该行为覆盖。新增原生浏览器测试先发现焦点未进入字段，修复 showModal 后显式聚焦；候选 App 的原有只读门禁阻止提交时，通过既有 candidate-local-write 标记只允许该合成内存模块，不改变真实权限。

环境限定：JSDOM 补齐 Node Blob/File 只用于运行 PGlite 的联调测试；DOM dialog shim 不计作原生验证。原生验证使用独立合成应用 localhost，不读取或代理历史 file:// 设计稿。agent-browser CLI 不在当前环境，采用项目已有 Playwright/Chrome。未做 iOS Safari 实机验收或视觉像素比对，不把窄屏 Chromium 当成 iOS 结论。

## 复验命令

在 `apps/life-console`，使用锁定依赖：

```sh
npm test
npm run build
node node_modules/@playwright/test/cli.js test --config playwright.fitness.config.ts
node node_modules/@playwright/test/cli.js test tests/playwright/synthetic-write.spec.ts tests/playwright/life-console-250.spec.ts --grep 'keeps mobile controls|2.5 workbench|2.5 four-page'
```

第一组浏览器配置只启动绑定 127.0.0.1 的 candidate 合成预览，测试中屏蔽外部 HTTPS。可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定已安装浏览器，默认优先本机 Chrome，再使用 Playwright 浏览器。运行结果在临时目录，不提交截图、构建文件或依赖。

## 项目门禁与剩余事项

治理、隐私与差异检查通过。`validate_project.py` 仍有隔离 worktree 缺失私人文件、两个既有测试秘密模式提示及既有研究链接失效；新增 B 文档链接有效。未通过复制私人资料或削弱检查抹平基线问题。

站内候选可供 PO 验收，尚未合并/上线。真实 PostgREST 与服务器环境联调、备份 v4 与隔离恢复、迁移/Owner 配置仍须发布前门禁。ICS 服务及实际 Apple 更新验证未实施，可延后；不把内存候选保存称为真实预约保存。
