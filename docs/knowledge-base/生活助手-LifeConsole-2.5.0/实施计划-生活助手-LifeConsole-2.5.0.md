# Life Console 2.5.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Workspace policy does not authorize subagents for this task.

**Goal:** 在保持 Owner-scoped Supabase、严格 CSP 和现有四页框架的前提下，交付 Todo、可恢复日记删除、14 天趋势、每周寄语和每日新闻。

**Architecture:** 私人状态通过 Supabase 表、RLS 和 revision-safe RPC 管理；React 通过 Repository ports 访问。每日新闻使用 Owner-authenticated Vercel API 与 Runtime Cache，外部输入只含公开信息；每周寄语由 Owner Agent 写入 Supabase。

**Tech Stack:** React 19、TypeScript 5.9、Vite 7、Supabase PostgreSQL/RLS、Vitest、PGlite、Playwright、Vercel Functions/Runtime Cache、Python unittest。

**Spec:** `docs/knowledge-base/生活助手-LifeConsole-2.5.0/生活助手-LifeConsole-2.5.0.md`、`设计方案-生活助手-LifeConsole-2.5.0.md`、`技术方案-生活助手-LifeConsole-2.5.0.md`

## Global Constraints

- 生产功能代码只能在 PO 通过正式视觉、设计和技术 Gate 2 后开始。
- 所有新行为先写红灯测试并确认因缺失功能失败，再写最小实现。
- Supabase 是 Todo、寄语和日记删除状态的唯一真相源；新闻只在 Runtime Cache。
- 不读取或修改真实日记；Preview 写入须另行确认且仅使用合成记录。
- `script-src 'self'` 不变；只给 `img-src` 增加 `https://images.unsplash.com`。
- 不实现硬删除、Todo 自动延后 DDL、心率/HRV、新闻全文或原生日历同步。

---

### Task 1: Owner 数据模型与原子 RPC

**Files:**
- Create: `apps/life-console/supabase/migrations/20260819233000_life_console_250.sql`
- Test: `apps/life-console/tests/supabase/life-console-250-migration.test.ts`
- Test: `apps/life-console/tests/supabase/life-console-250-rls.test.ts`

**Interfaces:**
- Produces: `todo_items`、`todo_status_events`、`dashboard_messages`；六个固定 RPC。
- Consumes: 既有 `idempotency_keys`、`audit_events`、`journals` revision trigger 和 `auth.uid()` 模式。

- [ ] **Step 1: 写 migration 结构红灯**

```ts
expect(schema).toContain("create table public.todo_items");
expect(schema).toContain("create function public.transition_todo");
expect(schema).toContain("create function public.restore_journal");
```

- [ ] **Step 2: 运行红灯**

Run: `npx vitest run tests/supabase/life-console-250-migration.test.ts`
Expected: FAIL，migration 文件或固定对象不存在。

- [ ] **Step 3: 写最小 DDL、RLS 与 RPC**

```sql
create table public.todo_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 240),
  priority text not null default 'P1' check (priority in ('P0','P1','P2')),
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','completed')),
  planned_start_at timestamptz not null default transaction_timestamp(),
  due_at timestamptz not null check (due_at > planned_start_at),
  actual_started_at timestamptz,
  completed_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

RPC 必须锁定目标行、验证 `expected_revision`、事务内更新时间和事件，并只返回当前 Owner 行。

- [ ] **Step 4: 写并运行双 Owner、幂等、revision、时间与软删除测试**

Run: `npx vitest run tests/supabase/life-console-250-migration.test.ts tests/supabase/life-console-250-rls.test.ts`
Expected: PASS；Owner B 无法读写 Owner A；重复 key 同请求返回同 id；stale revision 拒绝。

- [ ] **Step 5: 提交**

```bash
git add apps/life-console/supabase/migrations/20260820_life_console_250.sql apps/life-console/tests/supabase/life-console-250-*.test.ts
git commit -m "feat(life-console): add 2.5 owner data model"
```

### Task 2: 领域类型、Repository 与备份 v3

**Files:**
- Create: `apps/life-console/src/domain/todos.ts`
- Create: `apps/life-console/src/domain/daily-news.ts`
- Create: `apps/life-console/src/supabase/todos.ts`
- Create: `apps/life-console/src/supabase/dashboard-messages.ts`
- Create: `apps/life-console/src/supabase/health.ts`
- Modify: `apps/life-console/src/supabase/journals.ts`
- Modify: `apps/life-console/src/supabase/reviews.ts`
- Modify: `apps/life-console/src/supabase/backups.ts`
- Test: `apps/life-console/tests/supabase/life-console-250-repositories.test.ts`
- Test: `apps/life-console/tests/supabase/backups-v3.test.ts`

**Interfaces:**
- Produces: `TodoRepositoryPort`、`DashboardMessageRepositoryPort`、`HealthRepositoryPort`、`DailyNewsClient` 和 v2/v3 backup reader。
- Consumes: Task 1 RPC 返回行。

- [ ] **Step 1: 写领域类型与 Repository API 红灯**

```ts
export type TodoPriority = "P0" | "P1" | "P2";
export type TodoStatus = "not_started" | "in_progress" | "completed";

export interface TodoRepositoryPort {
  listToday(now: Date): Promise<TodoItem[]>;
  listAll(): Promise<TodoItem[]>;
  create(input: CreateTodoInput): Promise<TodoItem>;
  update(input: UpdateTodoInput): Promise<TodoItem>;
  transition(input: TransitionTodoInput): Promise<TodoItem>;
  listStatusEvents(todoId: number): Promise<TodoStatusEvent[]>;
}
```

- [ ] **Step 2: 运行红灯**

Run: `npx vitest run tests/supabase/life-console-250-repositories.test.ts`
Expected: FAIL，模块或方法不存在。

- [ ] **Step 3: 实现 Repository 映射与 journal/review 扩展**

普通日记查询固定 `.is("deleted_at", null)`；已删除查询固定 `.not("deleted_at", "is", null)`；软删除/恢复只调用 RPC。Review 映射保留 `structured_data` 原对象。

- [ ] **Step 4: 写 backup v3 红灯并实现双版本 reader**

```ts
export const BACKUP_FORMAT_VERSION = "life-console-backup/3";
export const READABLE_BACKUP_FORMATS = [
  "life-console-backup/2",
  "life-console-backup/3",
] as const;
```

Run: `npx vitest run tests/supabase/backups-v3.test.ts tests/supabase/backups.test.ts`
Expected: PASS；v2 新资源为空，v3 round-trip 包含 Todo/事件/寄语且不含新闻。

- [ ] **Step 5: 提交**

```bash
git add apps/life-console/src/domain apps/life-console/src/supabase apps/life-console/tests/supabase
git commit -m "feat(life-console): add repositories and backup v3"
```

### Task 3: 确定性投影与趋势算法

**Files:**
- Create: `apps/life-console/src/features/todos/todo-projections.ts`
- Create: `apps/life-console/src/features/progress/trend-observations.ts`
- Create: `apps/life-console/src/features/reviews/review-projection.ts`
- Test: `apps/life-console/tests/features/todo-projections.test.ts`
- Test: `apps/life-console/tests/features/trend-observations.test.ts`
- Test: `apps/life-console/tests/features/review-projection.test.ts`

**Interfaces:**
- Produces: `sortTodos`、`isOverdue`、`selectTodayTodos`、`observeTrend`、`projectReviewFields`。
- Consumes: Task 2 domain types。

- [ ] **Step 1: 写纯函数红灯**

```ts
expect(observeTrend([3, 4, 4], [2, 2, 3])).toEqual({
  state: "up",
  label: "较前 7 天上升",
});
expect(observeTrend([3, 4], [2, 3, 4])).toEqual({
  state: "insufficient",
  label: "数据不足",
});
```

- [ ] **Step 2: 运行红灯并确认因函数缺失失败**

Run: `npx vitest run tests/features/todo-projections.test.ts tests/features/trend-observations.test.ts tests/features/review-projection.test.ts`

- [ ] **Step 3: 实现最小纯函数**

趋势阈值使用相对变化：绝对变化小于前窗均值的 5% 视为稳定；前窗为 0 时只比较绝对值。任何窗口有效样本少于 3 返回 `insufficient`。

- [ ] **Step 4: 运行专项与类型检查**

Run: `npx vitest run tests/features`
Expected: PASS，无诊断用语、未知字段回退为自动换行文本。

- [ ] **Step 5: 提交**

```bash
git add apps/life-console/src/features apps/life-console/tests/features
git commit -m "feat(life-console): add deterministic projections"
```

### Task 4: 工作台、Todo 与甘特

**Files:**
- Create: `apps/life-console/src/features/todos/TodoPanel.tsx`
- Create: `apps/life-console/src/features/todos/TodoEditorSheet.tsx`
- Create: `apps/life-console/src/features/todos/TodoGantt.tsx`
- Create: `apps/life-console/src/features/news/DailyNewsPanel.tsx`
- Create: `apps/life-console/src/features/messages/WeeklyMessageHero.tsx`
- Modify: `apps/life-console/src/features/today/TodayPage.tsx`
- Modify: `apps/life-console/src/App.tsx`
- Test: `apps/life-console/tests/ui/today-250.test.tsx`
- Test: `apps/life-console/tests/ui/todo-panel.test.tsx`

**Interfaces:**
- Consumes: Task 2 Repository ports、Task 3 projections。
- Produces: 精简工作台和可测试的 Todo/list/gantt 组件。

- [ ] **Step 1: 写工作台信息架构和 Todo 交互红灯**

```tsx
expect(screen.queryByText("隐私与保存链路")).not.toBeInTheDocument();
expect(screen.getByRole("group", { name: "起床状态" })).toBeInTheDocument();
expect(screen.getByText("0 / 4 已填写")).toBeInTheDocument();
await user.type(screen.getByLabelText("Todo 项目"), "合成验收任务");
await user.click(screen.getByRole("button", { name: "新建 Todo" }));
expect(repository.create).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: 运行红灯**

Run: `npx vitest run tests/ui/today-250.test.tsx tests/ui/todo-panel.test.tsx`

- [ ] **Step 3: 拆分 Today 并实现最小 UI**

容器只负责编排 hero、Todo 8 栏、新闻 4 栏和锚点；Repository 状态、表单和 Gantt 分别留在聚焦组件。今日锚点保留 2.4.0 四项、四种语义、revision 保存链路和草稿恢复，仅新增非空状态进展显示。内容区不足 1180px 时 Todo/新闻转为上下布局，所有 Grid 子项使用 `minmax(0, …)`；提交中不得顺带修改 Records/Progress。

- [ ] **Step 4: 运行交互、可访问性和甘特边界测试**

Run: `npx vitest run tests/ui/today-250.test.tsx tests/ui/todo-panel.test.tsx`
Expected: PASS；重复提交禁用、DDL 校验、状态、逾期、14 天窗口、今日锚点进展/修改可见；1440px、1280px、1024px 和 390px 的页面根节点无横向溢出。

- [ ] **Step 5: 提交**

```bash
git add apps/life-console/src/features/today apps/life-console/src/features/todos apps/life-console/src/features/news apps/life-console/src/features/messages apps/life-console/src/App.tsx apps/life-console/tests/ui
git commit -m "feat(life-console): rebuild the 2.5 workbench"
```

### Task 5: 记录、软删除与复盘阅读

**Files:**
- Create: `apps/life-console/src/features/journals/JournalCard.tsx`
- Create: `apps/life-console/src/features/journals/DeletedJournalsPanel.tsx`
- Create: `apps/life-console/src/features/journals/DeleteJournalDialog.tsx`
- Modify: `apps/life-console/src/features/records/RecordsPage.tsx`
- Modify: `apps/life-console/src/features/journals/SupabaseJournalsPanel.tsx`
- Modify: `apps/life-console/src/features/reviews/SupabaseReviewsPanel.tsx`
- Test: `apps/life-console/tests/ui/records-250.test.tsx`
- Test: `apps/life-console/tests/ui/journal-delete-restore.test.tsx`

**Interfaces:**
- Consumes: Task 2 Journal/Review ports、Task 3 review projection。
- Produces: 三段 Records 页面和软删除/恢复交互。

- [ ] **Step 1: 写移除区块、折叠和确认红灯**

```tsx
expect(screen.queryByText("原文保存预览")).not.toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "删除日记" }));
expect(screen.getByRole("dialog", { name: "移到已删除" })).toBeVisible();
expect(repository.softDelete).not.toHaveBeenCalled();
```

- [ ] **Step 2: 运行红灯后实现最小组件拆分**

Run: `npx vitest run tests/ui/records-250.test.tsx tests/ui/journal-delete-restore.test.tsx`

- [ ] **Step 3: 实现删除/恢复和复盘滚动**

确认按钮调用 expected revision；冲突保留弹窗并提示刷新。复盘正文使用 `max-height: 320px; overflow: auto; overflow-wrap: anywhere`。

- [ ] **Step 4: 运行 Records 与既有日记/复盘回归**

Run: `npx vitest run tests/ui/records-250.test.tsx tests/ui/journal-delete-restore.test.tsx tests/ui/supabase-journals-panel.test.tsx tests/ui/supabase-reviews-panel.test.tsx`

- [ ] **Step 5: 提交**

```bash
git add apps/life-console/src/features/records apps/life-console/src/features/journals apps/life-console/src/features/reviews apps/life-console/tests/ui
git commit -m "feat(life-console): simplify records and restore journals"
```

### Task 6: 进展页与 14/7 天视图

**Files:**
- Create: `apps/life-console/src/features/progress/TrendSection.tsx`
- Create: `apps/life-console/src/features/progress/SleepTimesTable.tsx`
- Modify: `apps/life-console/src/features/progress/ProgressPage.tsx`
- Test: `apps/life-console/tests/ui/progress-250.test.tsx`

**Interfaces:**
- Consumes: `HealthRepositoryPort` 和 `observeTrend`。
- Produces: 目标、14 天趋势、7 天睡眠三段式页面。

- [ ] **Step 1: 写信息架构、缺失语义和睡眠红灯**

```tsx
expect(screen.queryByText(/自然周进展/)).not.toBeInTheDocument();
expect(screen.getByText("数据不足")).toBeVisible();
expect(screen.getByRole("columnheader", { name: "离床" })).toBeVisible();
```

- [ ] **Step 2: 运行红灯并实现最小视图**

Run: `npx vitest run tests/ui/progress-250.test.tsx`

- [ ] **Step 3: 覆盖四个健康指标与主观信号**

不得从日记或设备推断主观值；所有缺失点保留空洞，不插值。

- [ ] **Step 4: 运行 Progress 回归并提交**

Run: `npx vitest run tests/ui/progress-250.test.tsx tests/ui/supabase-progress-page.test.tsx`

```bash
git add apps/life-console/src/features/progress apps/life-console/tests/ui
git commit -m "feat(life-console): add deterministic progress trends"
```

### Task 7: 每日新闻 API 与 Runtime Cache

**Files:**
- Create: `apps/life-console/api/daily-news.ts`
- Create: `apps/life-console/api/cron/daily-news.ts`
- Create: `apps/life-console/src/server/daily-news-service.ts`
- Create: `apps/life-console/src/server/gdelt-client.ts`
- Create: `apps/life-console/src/server/daily-news-cache.ts`
- Create: `apps/life-console/src/server/daily-news-validator.ts`
- Modify: `apps/life-console/package.json`
- Modify: `apps/life-console/scripts/supabase-candidate-config.mjs`
- Test: `apps/life-console/tests/server/daily-news-*.test.ts`
- Test: `apps/life-console/tests/vercel/daily-news-handlers.test.ts`

**Interfaces:**
- Produces: Owner endpoint、Cron endpoint、GDELT/DeepSeek/cache 注入式服务。
- Consumes: Task 2 `DailyNewsDigest`。

- [ ] **Step 1: 写鉴权、白名单、去重、配比和降级红灯**

```ts
expect(await cronRequest(unauthorized)).toMatchObject({ status: 401 });
const selected = selectTopFive(fixtures);
expect(new Set(selected.map((item) => item.category))).toEqual(
  new Set(["technology", "finance", "politics"]),
);
expect(new Set(selected.map((item) => item.region))).toEqual(
  new Set(["domestic", "international"]),
);
expect(await service.getDigest()).toMatchObject({ state: "stale" });
```

- [ ] **Step 2: 运行红灯**

Run: `npx vitest run tests/server/daily-news-*.test.ts tests/vercel/daily-news-handlers.test.ts`

- [ ] **Step 3: 实现注入式服务和固定 Schema**

外部请求统一 AbortController 超时和响应体上限；模型输入只包含公开字段；缓存写入必须在完整 5 条结果校验后发生。

- [ ] **Step 4: 配置 Cron、区域和 CSP 图片域测试**

Run: `npx vitest run tests/vercel`
Expected: Cron 为每天 23:00 UTC（上海次日 07:00），两个端点同区，浏览器配置只新增 Unsplash 图片域。

- [ ] **Step 5: 提交**

```bash
git add apps/life-console/api apps/life-console/src/server apps/life-console/tests/server apps/life-console/tests/vercel apps/life-console/package.json apps/life-console/package-lock.json apps/life-console/scripts/supabase-candidate-config.mjs
git commit -m "feat(life-console): add cached daily news"
```

### Task 8: 样式拆分、响应式与全量门禁

**Files:**
- Create: `apps/life-console/src/styles/tokens.css`
- Create: `apps/life-console/src/styles/shared.css`
- Create: `apps/life-console/src/styles/today.css`
- Create: `apps/life-console/src/styles/records.css`
- Create: `apps/life-console/src/styles/progress.css`
- Modify: `apps/life-console/src/styles.css`
- Create: `apps/life-console/public/favicon.svg`
- Test: `apps/life-console/tests/playwright/life-console-250.spec.ts`

**Interfaces:**
- Consumes: Tasks 4–7 UI。
- Produces: 390px/1440px 稳定布局和关闭 favicon 404 的 Production 资产。

- [ ] **Step 1: 写移动/桌面溢出与关键区块 Playwright 红灯**

```ts
expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
  await page.evaluate(() => document.documentElement.clientWidth),
);
```

- [ ] **Step 2: 拆分样式并运行组件测试**

Run: `npx vitest run tests/ui`

- [ ] **Step 3: 运行 Playwright 两种 viewport、删除弹窗、甘特和降级态**

Run: `npm run test:e2e:synthetic`
Expected: 全部通过，无 `unsafe-eval`、错误覆盖层或应用 console error。

- [ ] **Step 4: 运行完整门禁**

Run: `tools/setup_git_collaboration.sh`
Run: `tools/check_git_privacy.sh`
Run: `npm test`
Run: `npm run build:supabase-production`
Run: `git diff --check origin/main...HEAD`

- [ ] **Step 5: 更新工程验收并提交**

```bash
git add apps/life-console/src/styles apps/life-console/src/styles.css apps/life-console/public/favicon.svg apps/life-console/tests/playwright docs/knowledge-base/生活助手-LifeConsole-2.5.0
git commit -m "test(life-console): complete 2.5 synthetic acceptance"
```

### Task 9: Preview、PO 验收与 Production 收口

**Files:**
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.5.0/工程评审与验收-生活助手-LifeConsole-2.5.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.5.0/项目管理-生活助手-LifeConsole-2.5.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.5.0/上线证据-生活助手-LifeConsole-2.5.0.md`

**Interfaces:**
- Consumes: 完整功能分支和所有阶段门禁。
- Produces: 去敏 Preview/Production 证据和可回滚的上线状态。

- [ ] **Step 1: 部署合成 Preview 并完成只读浏览器验收**

不得配置真实 Secret 或写 Owner 数据；记录页面、CSP、console 和合成 fixture 结论。

- [ ] **Step 2: 取得 Owner Preview 写入确认后执行合成记录验收**

只创建带合成标记的 Todo、寄语和日记；验证软删除/恢复后记录去敏结果。

- [ ] **Step 3: 取得 migration、自动化、PR 合并和 Production 分别确认**

每个门禁单独记录确认时间和范围；上线前校验 GitHub、Vercel、Supabase 账号与项目绑定。

- [ ] **Step 4: 发布并执行上线后验证**

验证登录、四页桌面/移动、Todo、日记恢复、趋势、新闻/寄语降级、CSP 和控制台；手动触发新闻 Cron，核对寄语自动化 `next_run` 的上海时间。

- [ ] **Step 5: 提交去敏证据并清理**

```bash
git add docs/knowledge-base/生活助手-LifeConsole-2.5.0
git commit -m "docs(life-console): record 2.5 release evidence"
```

合并证据 PR 后删除活动分支/worktree；数据库加法表保留，不删除用户数据。

## Self-review

- 需求覆盖：工作台、Todo、甘特、日记删除/恢复、复盘、趋势、睡眠、寄语、新闻、备份、CSP 和上线均有对应任务。
- 占位扫描：计划不含未定义接口；所有外部写入均有明确门禁。
- 类型一致性：Todo 枚举、Repository 方法、RPC 名称和 backup 版本与技术方案一致。
