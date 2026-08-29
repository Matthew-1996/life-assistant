# 项目管理：Life Console 2.7.0

## 1. 当前状态

- 主阶段：验收。
- 子状态：紧凑浮层替换 Preview 的技术与真实浏览器验收已通过，等待 PO 产品验收。
- 范围：Todo 状态展示筛选，仅前端。
- 数据：不改 Supabase、Owner 数据、API、备份或自动化。
- PR：Draft PR [#79](https://github.com/Matthew-1996/life-assistant/pull/79) 已创建，node、python、privacy 三项 CI 已通过。
- 授权：本地开发、Draft PR 与本次合成数据 Preview 已执行；不包含合并或 Production。

## 2. 决策日志

| 日期 | 决策 | 状态 |
|---|---|---|
| 2026-08-28 | 提出“今日 / 全部”默认隐藏已完成，并保留状态回捞能力 | 方案待 2.6.0 完成后接力 |
| 2026-08-29 | PO 确认 2.6.0 已完成，本任务继续 | 已恢复 |
| 2026-08-29 | 确认两个 Tab 共用多选筛选，默认未开始 + 进行中，列表与甘特图同源 | Gate 1 / Gate 2 已确认 |
| 2026-08-29 | 实施范围限于本地开发与 Draft PR | 已确认；不得延伸为发布授权 |
| 2026-08-29 | 本地 TDD 候选、全量测试、Production 构建、治理与隐私门禁通过 | 已完成；待独立代码评审与 Draft PR |
| 2026-08-29 | 独立代码评审发现 1 个 Important 空状态边界与 1 个 Minor PMO 状态问题 | 均已修正；新增失败用例后定向 10/10、全量 611 项复验通过，待独立复审 |
| 2026-08-29 | 独立复审确认原 Important 已解决，无新 Critical / Important | 已通过；仅修正复审指出的 PMO 轻微文案滞后 |
| 2026-08-29 | 创建 Draft PR #79 | 已完成；待 CI，不构成 Preview、合并或 Production 授权 |
| 2026-08-29 | Draft PR #79 首轮 node 因既有 Daily News NodeNext 类型检查 5.446 秒超过 5 秒限制失败；未修改代码或超时后原样重跑 | node、python、privacy 三项全部通过 |
| 2026-08-29 | PO 当次确认进入 Preview | 已生成只含合成数据的受保护 Preview；不延伸为合并或 Production 授权 |
| 2026-08-29 | 首个 Preview 缺少 Todo 合成数据，无法验证筛选行为 | 未作为验收件；补齐纯内存候选 repository 后替换 |
| 2026-08-29 | 独立审查发现上海午夜跨日边界 | 固定 00:30 红测复现并修复；复审无 Critical / Important |
| 2026-08-29 | 替代 Preview 静态、安全头、桌面交互与 390px 几何验收通过 | 等待 PO 产品验收 |
| 2026-08-29 | PO 认为三个大按钮视觉过重，确认改为紧凑多选入口；展开内容须浮在原内容上方，不下推布局 | 已确认并进入实现；不扩大合并或 Production 授权 |
| 2026-08-29 | 紧凑浮层独立复审发现键盘焦点移出后仍覆盖表单 | 先补 Tab / Shift+Tab 红测再修正；复审无剩余 Critical / Important，本地完整门禁通过 |
| 2026-08-29 | PO 指出浮层内 checkbox 仍过大，确认缩小框体但保留整行点击区域 | 14×14px 框体、38px 行目标；红绿测试、独立复审、CI 与替换 Preview 真实浏览器验收均通过 |
| 2026-08-29 | 紧凑 checkbox 替换 Preview Ready | 内容提交 `309ad1c`；桌面与 390×844 验收通过，等待 PO 产品验收 |

## 3. 门禁

| 门禁 | 当前状态 | 恢复条件 |
|---|---|---|
| Gate 1 PRD | completed | PO 于 2026-08-29 确认需求范围 |
| Gate 2 设计 / 技术 | completed | PO 于 2026-08-29 确认共用多选投影方案 |
| 本地开发 | approved | 按 TDD 与治理门禁实施 |
| Draft PR | completed | PR #79 已创建，三项 CI 已通过 |
| Preview | in_review | 技术与真实浏览器验收通过；待 PO 产品验收 |
| PR 合并 | pending | PO 根据验收与 CI 结果当次明确授权 |
| Production | pending | 合并后由 PO 当次明确授权发布 |

## 4. 当前下一步

1. 请 PO 验收替换 Preview。
2. PR 合并与 Production 继续保持 pending，直到分别当次明确授权。
