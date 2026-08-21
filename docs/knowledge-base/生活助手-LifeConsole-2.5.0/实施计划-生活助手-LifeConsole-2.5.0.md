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
- Create: `apps/life-console/supabase/migrations/20260819161427_life_console_250.sql`（Supabase CLI 2.111.0 生成）
- Test: `apps/life-console/tests/supabase/life-console-250-migration.test.ts`
- Test: `apps/life-console/tests/supabase/life-console-250-rls.test.ts`

**Interfaces:**
- Produces: `todo_items`、`todo_status_events`、`dashboard_messages`；六个固定 RPC。
- Consumes: 既有 `idempotency_keys`、`audit_events`、`journals` revision trigger 和 `auth.uid()` 模式。

- [x] **Step 1: 写 migration 结构红灯**

```ts
expect(catalogTables).toEqual([
  "dashboard_messages",
  "todo_items",
  "todo_status_events",
]);
expect(transitionResult.status).toBe("completed");
expect(restoredJournal.deleted_at).toBeNull();
```

- [x] **Step 2: 运行红灯**

Run: `npx vitest run tests/supabase/life-console-250-migration.test.ts`
Expected: FAIL，migration 文件或固定对象不存在。

- [x] **Step 3: 写最小 DDL、RLS 与 RPC**

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

- [x] **Step 4: 写并运行双 Owner、幂等、revision、时间与软删除测试**

Run: `npx vitest run tests/supabase/life-console-250-migration.test.ts tests/supabase/life-console-250-rls.test.ts`
Expected: PASS；Owner B 无法读写 Owner A；重复 key 同请求返回同 id；stale revision 拒绝。

- [x] **Step 5: 提交**

```bash
git add apps/life-console/supabase/migrations/20260819161427_life_console_250.sql apps/life-console/tests/supabase/life-console-250-*.test.ts
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
- Modify: `apps/life-console/supabase/migrations/20260819161427_life_console_250.sql`
- Modify: `apps/life-console/local_agent/backup_store.py`
- Modify: `tools/life_console_backup_agent.py`
- Modify: `tools/verify_life_console_cloud_backup.py`
- Test: `apps/life-console/tests/supabase/life-console-250-repositories.test.ts`
- Test: `apps/life-console/tests/supabase/backups-v3.test.ts`

**Interfaces:**
- Produces: `TodoRepositoryPort`、`DashboardMessageRepositoryPort`、`HealthRepositoryPort`、`DailyNewsClient` 和 v2/v3 backup reader。
- Consumes: Task 1 RPC 返回行。

- [x] **Step 1: 写领域类型与 Repository API 红灯**

```ts
export type TodoPriority = "P0" | "P1" | "P2";
export type TodoStatus = "not_started" | "in_progress" | "completed";

export interface TodoRepositoryPort {
  listToday(now: Date): Promise<TodoItem[]>;
  listAll(): Promise<TodoItem[]>;
  create(input: CreateTodoInput): Promise<TodoItem>;
  update(input: UpdateTodoInput): Promise<TodoItem>;
  transition(input: TransitionTodoInput): Promise<TodoItem>;
  delete(input: DeleteTodoInput): Promise<TodoItem>;
  listStatusEvents(todoId: number): Promise<TodoStatusEvent[]>;
}
```

- [x] **Step 2: 运行红灯**

Run: `npx vitest run tests/supabase/life-console-250-repositories.test.ts`
Expected: FAIL，模块或方法不存在。

- [x] **Step 3: 实现 Repository 映射与 journal/review 扩展**

普通日记查询固定 `.is("deleted_at", null)`；已删除查询固定 `.not("deleted_at", "is", null)`；软删除/恢复只调用 RPC。Review 映射保留 `structured_data` 原对象。

- [x] **Step 4: 写 backup v3 红灯并实现双版本 reader**

```ts
export const BACKUP_FORMAT_VERSION = "life-console-backup/3";
export const READABLE_BACKUP_FORMATS = [
  "life-console-backup/2",
  "life-console-backup/3",
] as const;
```

Run: `npx vitest run tests/supabase/backups-v3.test.ts tests/supabase/backups.test.ts`
Expected: PASS；v2 新资源为空，v3 round-trip 包含 Todo/事件/寄语且不含新闻。

- [x] **Step 5: 提交**

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

- [x] **Step 1: 写纯函数红灯**

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

- [x] **Step 2: 运行红灯并确认因函数缺失失败**

Run: `npx vitest run tests/features/todo-projections.test.ts tests/features/trend-observations.test.ts tests/features/review-projection.test.ts`

- [x] **Step 3: 实现最小纯函数**

趋势阈值使用相对变化：绝对变化小于前窗均值的 5% 视为稳定；前窗为 0 时只比较绝对值。任何窗口有效样本少于 3 返回 `insufficient`。

- [x] **Step 4: 运行专项与类型检查**

Run: `npx vitest run tests/features`
Expected: PASS，无诊断用语、未知字段回退为自动换行文本。

- [x] **Step 5: 提交**

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
- Modify: `apps/life-console/src/main.tsx`
- Modify: `apps/life-console/src/styles.css`
- Test: `apps/life-console/tests/ui/today-250.test.tsx`
- Test: `apps/life-console/tests/ui/todo-panel.test.tsx`
- Test: `apps/life-console/tests/playwright/synthetic-write.spec.ts`

**Interfaces:**
- Consumes: Task 2 Repository ports、Task 3 projections。
- Produces: 精简工作台和可测试的 Todo/list/gantt 组件。

- [x] **Step 1: 写工作台信息架构和 Todo 交互红灯**

```tsx
expect(screen.queryByText("隐私与保存链路")).not.toBeInTheDocument();
expect(screen.getByRole("group", { name: "起床状态" })).toBeInTheDocument();
expect(screen.getByText("0 / 4 已填写")).toBeInTheDocument();
await user.type(screen.getByLabelText("Todo 项目"), "合成验收任务");
await user.click(screen.getByRole("button", { name: "新建 Todo" }));
expect(repository.create).toHaveBeenCalledTimes(1);
```

- [x] **Step 2: 运行红灯**

Run: `npx vitest run tests/ui/today-250.test.tsx tests/ui/todo-panel.test.tsx`

- [x] **Step 3: 拆分 Today 并实现最小 UI**

容器只负责编排 hero、Todo 8 栏、新闻 4 栏和锚点；Repository 状态、表单和 Gantt 分别留在聚焦组件。今日锚点保留 2.4.0 四项、四种语义、revision 保存链路和草稿恢复，仅新增非空状态进展显示。内容区不足 1180px 时 Todo/新闻转为上下布局，所有 Grid 子项使用 `minmax(0, …)`；提交中不得顺带修改 Records/Progress。

- [x] **Step 4: 运行交互、可访问性和甘特边界测试**

Run: `npx vitest run tests/ui/today-250.test.tsx tests/ui/todo-panel.test.tsx`
Expected: PASS；重复提交禁用、DDL 校验、状态、逾期、14 天窗口、今日锚点进展/修改可见；1440px、1280px、1024px 和 390px 的页面根节点无横向溢出。

- [x] **Step 5: 提交**

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

- [x] **Step 1: 写移除区块、折叠和确认红灯**

```tsx
expect(screen.queryByText("原文保存预览")).not.toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "删除日记" }));
expect(screen.getByRole("dialog", { name: "移到已删除" })).toBeVisible();
expect(repository.softDelete).not.toHaveBeenCalled();
```

- [x] **Step 2: 运行红灯后实现最小组件拆分**

Run: `npx vitest run tests/ui/records-250.test.tsx tests/ui/journal-delete-restore.test.tsx`

- [x] **Step 3: 实现删除/恢复和复盘滚动**

确认按钮调用 expected revision；冲突保留弹窗并提示刷新。复盘正文使用 `max-height: 320px; overflow: auto; overflow-wrap: anywhere`。

- [x] **Step 4: 运行 Records 与既有日记/复盘回归**

Run: `npx vitest run tests/ui/records-250.test.tsx tests/ui/journal-delete-restore.test.tsx tests/ui/supabase-journals-panel.test.tsx tests/ui/supabase-reviews-panel.test.tsx`

- [x] **Step 5: 提交**

```bash
git add apps/life-console/src/features/records apps/life-console/src/features/journals apps/life-console/src/features/reviews apps/life-console/tests/ui
git commit -m "feat(life-console): simplify records and restore journals"
```

#### PO 验收反馈修正（2026-08-20）

- [x] 写入并观察记录页语义卡与纯合成 Preview 日记缺失的失败测试。
- [x] 删除语义卡，将 hero 改为单栏；在对话式记录下复用现有日记组件。
- [x] 向纯合成 Preview 注入只存活于页面内存的 `JournalRepositoryPort`，通过组件测试覆盖编辑、二次确认软删除、恢复与重新挂载重置。
- [x] 运行全量 Vitest、build 及 1440px/390px 浏览器验收，然后更新纯合成 Preview；同时以回归测试锁定 `/api/*` 必须在 SPA fallback 前返回 404。

### Task 6: 进展页与 14/7 天视图

**Files:**
- Create: `apps/life-console/src/features/progress/TrendSection.tsx`
- Create: `apps/life-console/src/features/progress/SleepTimesTable.tsx`
- Modify: `apps/life-console/src/features/progress/ProgressPage.tsx`
- Test: `apps/life-console/tests/ui/progress-250.test.tsx`

**Interfaces:**
- Consumes: `HealthRepositoryPort` 和 `observeTrend`。
- Produces: 目标、14 天趋势、7 天睡眠三段式页面。

- [x] **Step 1: 写信息架构、缺失语义和睡眠红灯**

```tsx
expect(screen.queryByText(/自然周进展/)).not.toBeInTheDocument();
expect(screen.getByText("数据不足")).toBeVisible();
expect(screen.getByRole("columnheader", { name: "离床" })).toBeVisible();
```

- [x] **Step 2: 运行红灯并实现最小视图**

Run: `npx vitest run tests/ui/progress-250.test.tsx`

- [x] **Step 3: 覆盖四个健康指标与主观信号**

不得从日记或设备推断主观值；所有缺失点保留空洞，不插值。

- [x] **Step 4: 运行 Progress 回归并提交**

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

- [x] **Step 1: 写鉴权、白名单、去重、配比和降级红灯**

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

- [x] **Step 2: 运行红灯**

Run: `npx vitest run tests/server/daily-news-*.test.ts tests/vercel/daily-news-handlers.test.ts`

- [x] **Step 3: 实现注入式服务和固定 Schema**

外部请求统一 AbortController 超时和响应体上限；模型输入只包含公开字段；缓存写入必须在完整 5 条结果校验后发生。

- [x] **Step 4: 配置 Cron、区域和 CSP 图片域测试**

Run: `npx vitest run tests/vercel`
Expected: Cron 为每天 23:00 UTC（上海次日 07:00），两个端点同区，浏览器配置只新增 Unsplash 图片域。

- [x] **Step 5: 提交**

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

- [x] **Step 1: 写移动/桌面溢出与关键区块 Playwright 红灯**

```ts
expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
  await page.evaluate(() => document.documentElement.clientWidth),
);
```

- [x] **Step 2: 拆分样式并运行组件测试**

Run: `npx vitest run tests/ui`

- [x] **Step 3: 运行 Playwright 两种 viewport、删除弹窗、甘特和降级态**

Run: `npm run test:e2e:synthetic`
Expected: 全部通过，无 `unsafe-eval`、错误覆盖层或应用 console error。

- [x] **Step 4: 运行完整门禁**

Run: `tools/setup_git_collaboration.sh`
Run: `tools/check_git_privacy.sh`
Run: `npm test`
Run: `npm run build:supabase-production`
Run: `git diff --check origin/main...HEAD`

- [x] **Step 5: 更新工程验收并提交**

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

- [x] **Step 1: 部署合成 Preview 并完成只读浏览器验收**

不得配置真实 Secret 或写 Owner 数据；记录页面、CSP、console 和合成 fixture 结论。

补充收口：Draft PR #58 首次 Node CI 暴露锁文件内私有镜像 tarball 地址；已按 TDD 增加真实锁文件 host 回归测试，将公共包地址规范化到公共 npm Registry，并在 Node 24 下以空缓存完成 `npm ci`、全量测试、Production build、Playwright 和 0 漏洞审计。该结论仍需推送后由 GitHub Runner 复验。

- [x] **Step 2: 取得 Owner Preview 写入确认后执行合成记录验收**

只创建带合成标记的 Todo、寄语和日记；Todo 全链路、日记软删除/恢复和远期寄语写入均已完成去敏验证。后续用户追加的 Todo 误建删除采用二次确认软删除，迁移、Repository、UI、审计与 Owner Preview 已完成。

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

- 需求覆盖：工作台、Todo、甘特、日记删除/恢复、复盘、趋势、睡眠、寄语、新闻、备份、CSP 和上线均有对应任务；2026-08-21 新闻可靠性补充由 Tasks 10–13 覆盖。
- 占位扫描：计划不含未定义接口；所有外部写入均有明确门禁。
- 类型一致性：Todo 枚举、Repository 方法、RPC 名称和 backup 版本与技术方案一致。

## 2026-08-21 每日新闻可靠性补充实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GDELT 不可用或候选配比不足时由新华网/BBC 官方公开源生成完整 Top 5，并保存最近 7 天可由 Owner 查询的去敏 Cron 运行记录。

**Architecture:** 保留 GDELT 主源；新增独立 Publisher discovery adapter，只有主源失败或无法通过 `selectTopFive` 时才读取固定新华网频道和 BBC RSS。新闻摘要仍只在完整候选校验后调用 DeepSeek；Cron 通过独立 Runtime Cache store 写运行收据，Owner 状态端点只读去敏记录。

**Tech Stack:** Node.js 22、TypeScript 5.9、Cheerio 1.2.0、Vitest 3、Vercel Functions 3.9 Runtime Cache。

**Spec:** `docs/knowledge-base/生活助手-LifeConsole-2.5.0/技术方案-生活助手-LifeConsole-2.5.0.md`

### Global Constraints

- 新闻正文、Owner 数据、模型完整请求/响应、环境变量和 Secret 不进入运行收据、Git 或测试 fixture。
- 固定可信 HTTPS 入口；外部响应必须有 8 秒超时、1 MB 体积上限和条目上限。
- 候选必须在最近 24 小时内，并同时满足科技/财经/政治与国内/国际配比；不足时整体失败。
- Runtime Cache 记录保留 7 天、可被平台逐出，不声明永久审计能力，也不新增 Supabase schema 或服务器级 Supabase 密钥。
- Production 合并、发布和手动 Cron 触发必须在 Preview/PO 验收后取得当次确认。

---

### Task 10: 新华网/BBC 官方备用源解析

**Files:**
- Create: `apps/life-console/src/server/publisher-news-client.ts`
- Create: `apps/life-console/tests/server/publisher-news-client.test.ts`
- Modify: `apps/life-console/package.json`
- Modify: `apps/life-console/package-lock.json`

**Interfaces:**
- Consumes: `PublicNewsCandidate`、`DailyNewsCategory`、`DailyNewsScope`。
- Produces: `discoverPublisherNewsCandidates(dependencies): Promise<PublicNewsCandidate[]>`；`PublisherNewsClientError` 只暴露稳定错误码。

- [x] **Step 1: 为 BBC RSS 写红灯**

```ts
const candidates = await discoverPublisherNewsCandidates({
  fetch: fixtureFetch({
    "https://feeds.bbci.co.uk/news/technology/rss.xml": bbcTechnologyRss,
    "https://feeds.bbci.co.uk/news/business/rss.xml": bbcBusinessRss,
    "https://feeds.bbci.co.uk/news/world/rss.xml": bbcWorldRss,
  }),
  now: () => new Date("2030-05-14T02:00:00.000Z"),
});
expect(candidates).toEqual(expect.arrayContaining([
  expect.objectContaining({ category: "technology", scope: "international" }),
  expect.objectContaining({ category: "finance", scope: "international" }),
  expect.objectContaining({ category: "politics", scope: "international" }),
]));
```

`fixtureFetch` 是本测试文件内的严格 URL→完整 `Response` 映射；未声明 URL 直接抛错，避免宽松 mock 掩盖错误入口。

Run: `npx vitest run tests/server/publisher-news-client.test.ts`
Expected: FAIL because `publisher-news-client.ts` does not exist.

- [x] **Step 2: 安装并锁定服务器端解析依赖**

Run: `npm install --save-exact cheerio@1.2.0`
Expected: `package.json` 和公共 npm registry lockfile 只增加 Cheerio 及其传递依赖；浏览器 bundle 不导入该模块。

- [x] **Step 3: 实现 BBC RSS 最小解析器并转绿**

```ts
export interface PublisherNewsClientDependencies {
  fetch: typeof globalThis.fetch;
  now?: () => Date;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export async function discoverPublisherNewsCandidates(
  dependencies: PublisherNewsClientDependencies,
): Promise<PublicNewsCandidate[]>;
```

固定读取三个 BBC HTTPS Feed；使用 Cheerio XML mode 解析 `item > title/link/pubDate/description`，只接收 `bbc.co.uk`/`bbc.com` HTTPS 文章并在 24 小时窗口内映射分类。

Run: `npx vitest run tests/server/publisher-news-client.test.ts`
Expected: BBC 三分类用例 PASS。

- [x] **Step 4: 为新华网当前频道与文章元数据写红灯**

```ts
expect(candidates).toEqual(expect.arrayContaining([
  expect.objectContaining({
    category: "technology",
    scope: "domestic",
    publishedAt: "2030-05-14T01:15:00.000Z",
    url: "https://www.news.cn/tech/20300514/synthetic/c.html",
  }),
]));
expect(requestedUrls).not.toContain("https://www.news.cn/tech/news_tech.xml");
```

Run: `npx vitest run tests/server/publisher-news-client.test.ts`
Expected: FAIL because Xinhua channel/article discovery is absent.

- [x] **Step 5: 实现新华网当前页面解析、失败隔离和边界保护**

固定读取科技、财经、时政当前频道；在 1 MB 页面上限内先收集全部可信去重文章链接，再按 URL 日期排序并最多抓取 2 篇最新文章元数据。文章页从公开标题、精确时间、description 和 source 投影候选；单个频道、Feed 或文章失败不得中断其他入口。畸形 XML/HTML、超时、响应过大、HTTP 链接、非可信域名、过期或未来时间全部丢弃。

Run: `npx vitest run tests/server/publisher-news-client.test.ts`
Expected: 正常、单入口失败、过期、恶意链接、超时和响应体上限全部 PASS。

- [x] **Step 6: 提交备用源解析器**

```bash
git add apps/life-console/src/server/publisher-news-client.ts apps/life-console/tests/server/publisher-news-client.test.ts apps/life-console/package.json apps/life-console/package-lock.json
git commit -m "feat(life-console): add trusted publisher news fallback"
```

### Task 11: 主备候选编排与诊断结果

**Files:**
- Create: `apps/life-console/src/server/daily-news-discovery.ts`
- Create: `apps/life-console/tests/server/daily-news-discovery.test.ts`
- Modify: `apps/life-console/src/server/daily-news-service.ts`
- Modify: `apps/life-console/tests/server/daily-news-service.test.ts`

**Interfaces:**
- Consumes: `discoverGdeltCandidates`、`discoverPublisherNewsCandidates`、`selectTopFive`。
- Produces: `DailyNewsDiscoveryResult = { candidates: PublicNewsCandidate[]; source: "gdelt" | "publisher_fallback" | "gdelt_plus_publisher_fallback" }`；`DailyNewsExecution = { result: DailyNewsResult; diagnostics: DailyNewsExecutionDiagnostics }`，其中 diagnostics 精确字段为 `discoverySource: "cache" | DailyNewsDiscoverySource | "none"`、`failureStage: "discovery" | "selection" | "summarization" | "cache_write" | null`、`errorCode: string | null`。

- [x] **Step 1: 写主源健康时不调用备用源红灯**

```ts
await expect(discoverDailyNewsCandidates({ primary, fallback })).resolves.toEqual({
  candidates: primaryMix,
  source: "gdelt",
});
expect(fallback).not.toHaveBeenCalled();
```

Run: `npx vitest run tests/server/daily-news-discovery.test.ts`
Expected: FAIL because the orchestrator does not exist.

- [x] **Step 2: 写主源异常和配比不足的备用源红灯**

```ts
await expect(discoverDailyNewsCandidates({
  primary: async () => { throw new GdeltClientError("gdelt_timeout"); },
  fallback: async () => fallbackMix,
})).resolves.toMatchObject({ source: "publisher_fallback" });

await expect(discoverDailyNewsCandidates({
  primary: async () => incompletePrimary,
  fallback: async () => complementaryFallback,
})).resolves.toMatchObject({ source: "gdelt_plus_publisher_fallback" });
```

Run: `npx vitest run tests/server/daily-news-discovery.test.ts`
Expected: both cases FAIL for missing fallback behavior.

- [x] **Step 3: 实现最小主备编排并转绿**

```ts
export type DailyNewsDiscoverySource =
  | "gdelt"
  | "publisher_fallback"
  | "gdelt_plus_publisher_fallback";

export async function discoverDailyNewsCandidates(
  dependencies: {
    primary(): Promise<PublicNewsCandidate[]>;
    fallback(): Promise<PublicNewsCandidate[]>;
  },
): Promise<DailyNewsDiscoveryResult>;
```

主源结果先用 `selectTopFive` 验证；失败才调用备用源。主源抛错时只使用备用源；主源仅配比不足时合并主备候选再验证。所有失败转为稳定 discovery code，不泄露外部响应文本。

Run: `npx vitest run tests/server/daily-news-discovery.test.ts`
Expected: all PASS。

- [x] **Step 4: 为服务级诊断写红灯**

```ts
await expect(service.getDigestWithDiagnostics({ allowRebuild: true })).resolves.toEqual({
  result: { state: "success", digest: expectedDigest },
  diagnostics: {
    discoverySource: "publisher_fallback",
    failureStage: null,
    errorCode: null,
  },
});
```

另写 discovery、selection、summarization、cache write 失败用例；最近成功降级必须保留原始稳定错误码。

Run: `npx vitest run tests/server/daily-news-service.test.ts`
Expected: FAIL because the service exposes no diagnostics method.

- [x] **Step 5: 实现诊断接口并保持 Owner API body 不变**

```ts
export interface DailyNewsServicePort {
  getDigest(options: { allowRebuild: boolean }): Promise<DailyNewsResult>;
  getDigestWithDiagnostics(
    options: { allowRebuild: boolean },
  ): Promise<DailyNewsExecution>;
}
```

`getDigest` 只返回 execution.result；Owner 浏览器契约不增加字段。Runtime factory 注入主备编排器，缓存命中诊断来源为 `cache`，失败只保存稳定 code。

Run: `npx vitest run tests/server/daily-news-discovery.test.ts tests/server/daily-news-service.test.ts tests/server/daily-news-external.test.ts`
Expected: all PASS。

- [x] **Step 6: 提交主备编排**

```bash
git add apps/life-console/src/server/daily-news-discovery.ts apps/life-console/src/server/daily-news-service.ts apps/life-console/tests/server/daily-news-discovery.test.ts apps/life-console/tests/server/daily-news-service.test.ts
git commit -m "feat(life-console): fall back from gdelt discovery"
```

### Task 12: Cron 运行收据与 Owner 状态接口

**Files:**
- Create: `apps/life-console/src/server/daily-news-runs.ts`
- Create: `apps/life-console/api/daily-news-runs.ts`
- Create: `apps/life-console/tests/server/daily-news-runs.test.ts`
- Modify: `apps/life-console/src/server/daily-news-service.ts`
- Modify: `apps/life-console/src/server/daily-news-cache.ts`
- Modify: `apps/life-console/api/cron/daily-news.ts`
- Modify: `apps/life-console/scripts/supabase-candidate-config.mjs`
- Modify: `apps/life-console/tests/vercel/daily-news-handlers.test.ts`

**Interfaces:**
- Consumes: `DailyNewsExecution` 和现有 Owner JWT verifier。
- Produces: `DailyNewsRunStorePort`、`createRuntimeDailyNewsRunStore`、`dailyNewsRunsOwnerRequest`、`GET /api/daily-news-runs`。

- [x] **Step 1: 写收据 schema、7 天 TTL 与去敏验证红灯**

```ts
await store.start({ runId: "run-synthetic", startedAt });
await store.finish("run-synthetic", {
  state: "empty",
  finishedAt,
  discoverySource: "publisher_fallback",
  failureStage: "selection",
  errorCode: "candidate_mix_unavailable",
  digestDate: null,
  digestGeneratedAt: null,
});
expect(await store.listRecent()).toEqual([expect.objectContaining({
  runId: "run-synthetic",
  state: "empty",
})]);
expect(JSON.stringify(await store.listRecent())).not.toContain("synthetic-secret");
```

Run: `npx vitest run tests/server/daily-news-runs.test.ts`
Expected: FAIL because the run store does not exist.

- [x] **Step 2: 实现 Runtime Cache 收据 store**

```ts
export interface DailyNewsRunStorePort {
  start(receipt: DailyNewsRunningReceipt): Promise<{ indexed: boolean }>;
  finish(runId: string, completion: DailyNewsRunCompletion): Promise<{ indexed: boolean }>;
  get(runId: string): Promise<DailyNewsRunReceipt | undefined>;
  listRecent(): Promise<DailyNewsRunReceipt[]>;
}
```

固定 schema version 1、最多 32 条、按 `startedAt` 倒序、TTL `604800` 秒。每个 run id 使用独立收据键，最近列表只保存 run id 索引；单实例索引变更串行化，`finish` 和 Owner 精确查询都直接读取独立收据。索引写入失败只返回 `indexed: false`，不中断已成功开始的独立收据完成更新；Cron 响应头标记可观测性降级。解析时 exact-key 校验；畸形、过期或逐出值视为空列表。运行中与完成收据只允许设计文档列出的字段。

Run: `npx vitest run tests/server/daily-news-runs.test.ts`
Expected: schema、TTL、排序、逐出和去敏用例 PASS。

- [x] **Step 3: 写 Cron 开始/完成/失败收据红灯**

```ts
const response = await dailyNewsCronRequest(authorizedRequest, environment, {
  service,
  runs,
  now: deterministicClock,
  randomId: () => "run-synthetic",
});
expect(runs.start.mock.invocationCallOrder[0]).toBeLessThan(
  runs.finish.mock.invocationCallOrder[0],
);
expect(response.headers.get("x-life-console-run-id")).toBe("run-synthetic");
```

未鉴权请求不得写收据；收据写失败仍返回真实新闻结果，并设置 `x-life-console-run-receipt: unavailable`；未捕获服务错误要尝试完成 `failed` 收据并返回去敏 503。

Run: `npx vitest run tests/vercel/daily-news-handlers.test.ts`
Expected: FAIL because Cron does not use the run store.

- [x] **Step 4: 实现 Cron 收据生命周期并转绿**

Cron 鉴权后立即开始收据，再调用 `getDigestWithDiagnostics`；按 `success | stale | empty | failed` 完成。Body 继续保持现有 `DailyNewsResult`，运行 id 和 store 状态只进入响应 header，避免影响现有客户端契约。

Run: `npx vitest run tests/vercel/daily-news-handlers.test.ts`
Expected: auth、生命周期、错误和 header 用例 PASS。

- [x] **Step 5: 写并实现 Owner 状态端点红灯/绿灯**

```ts
const response = await dailyNewsRunsOwnerRequest(ownerRequest, ownerEnvironment, {
  runs,
  verifyBearer: async () => true,
});
expect(response.status).toBe(200);
await expect(response.json()).resolves.toEqual({ runs: recentReceipts });
```

无/错误 JWT 为 401，认证服务失败为 503，非 GET 为 405；响应 `Cache-Control: no-store`。Production config 将 `api/daily-news-runs.ts` 固定在 `hkg1`，不新增 Cron 或浏览器 Secret。

Run: `npx vitest run tests/server/daily-news-runs.test.ts tests/vercel/daily-news-handlers.test.ts`
Expected: all PASS。

- [x] **Step 6: 提交运行记录与接口**

```bash
git add apps/life-console/src/server/daily-news-runs.ts apps/life-console/src/server/daily-news-service.ts apps/life-console/src/server/daily-news-cache.ts apps/life-console/api/cron/daily-news.ts apps/life-console/api/daily-news-runs.ts apps/life-console/scripts/supabase-candidate-config.mjs apps/life-console/tests/server/daily-news-runs.test.ts apps/life-console/tests/vercel/daily-news-handlers.test.ts
git commit -m "feat(life-console): persist daily news cron receipts"
```

### Task 13: 全量验证、Preview 与发布门禁

**Files:**
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.5.0/工程评审与验收-生活助手-LifeConsole-2.5.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.5.0/项目管理-生活助手-LifeConsole-2.5.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.5.0/上线证据-生活助手-LifeConsole-2.5.0.md`

**Interfaces:**
- Consumes: Tasks 10–12 和既有 2.5.0 门禁。
- Produces: 可审阅 Draft PR、合成 Preview、Owner 状态接口证据和独立 Production 门禁。

- [x] **Step 1: 运行精确内容服务测试**

Run: `npx vitest run tests/server/publisher-news-client.test.ts tests/server/daily-news-discovery.test.ts tests/server/daily-news-service.test.ts tests/server/daily-news-runs.test.ts tests/server/daily-news-external.test.ts tests/vercel/daily-news-handlers.test.ts`
Expected: all PASS, no warning or unhandled rejection。

- [x] **Step 2: 运行完整本地门禁**

Run: `python3 tools/check_project_governance.py`
Run: `tools/check_git_privacy.sh`
Run: `git diff --check origin/main...HEAD`
Run: `python3 -m unittest discover -s tools -p 'test_*.py'`
Run: `npm test`
Run: `npm run build:supabase-production`
Run: `npm run test:e2e:synthetic`
Expected: 全绿；严格 CSP 不增加域名或 `unsafe-eval`，浏览器 bundle 不含 Cheerio、Feed URL、运行收据或 Secret。

- [ ] **Step 3: 更新 Draft PR #63 并等待远端 CI**

PR 标题调整为每日新闻可靠性修复，说明 GDELT 主源、新华网/BBC 备用源、7 天运维收据、无 Supabase migration、无私人数据。推送前运行 `tools/check_git_privacy.sh --history origin/main..HEAD`。

- [ ] **Step 4: 部署合成 Preview 并验收**

使用公开合成 RSS/HTML fixture 验证主源成功不触发备用源、主源失败生成完整 Top 5、运行收据查询 401/200、CSP 和 console；不得调用真实 DeepSeek、写 Owner 数据或配置 Production Secret。

- [ ] **Step 5: 取得 PO 验收及 Production 当次确认**

在用户确认前保持 Draft，不合并 PR、不切换正式别名、不手动触发 Production Cron。

- [ ] **Step 6: 发布后手动生成今日新闻并核验**

核对 GitHub/Vercel 账号与项目绑定；合并并发布后使用 Vercel Cron 的最终 Sensitive Secret 触发一次。验收 HTTP 状态、运行收据、Owner 页面 Top 5、更新时间、来源链接、CSP 和 console；不读取或记录 Owner 私人数据。

- [ ] **Step 7: 提交去敏证据并清理**

```bash
git add docs/knowledge-base/生活助手-LifeConsole-2.5.0
git commit -m "docs(life-console): record news fallback release evidence"
```

合并证据后删除活动分支/worktree；Runtime Cache 可自然过期，不执行数据库回滚或个人数据操作。
