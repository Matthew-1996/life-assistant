# Life Console 2.2.0 Goals CRUD Implementation Plan

> **Execution:** Follow TDD task-by-task in the existing
> `agent/life-console-220-supabase` worktree and Draft PR #40.

**Goal:** Complete the first Stage C synthetic CRUD module for goals without
connecting a hosted Supabase project or the production application entry point.

**Architecture:** A caller-rights `create_goal` database RPC performs
idempotent creation and minimal audit insertion in one transaction.
`GoalRepository` composes the existing repository foundation for fixed,
cursor-based reads, revision-guarded updates, and reversible soft deletion.
An injectable Goals panel demonstrates user-visible loading, empty, create,
update, conflict, failure, and archive behavior while remaining disconnected
from `App.tsx` and `main.tsx`.

**Tech Stack:** PostgreSQL/PGlite, Supabase Data API, React 19, TypeScript 5.9,
Vitest 3, Testing Library.

---

### Task 1: Idempotent goal creation RPC

**Files:**
- Modify: `apps/life-console/supabase/migrations/0001_life_console.sql`
- Modify: `apps/life-console/tests/supabase/production-migration.test.ts`

- [x] Write failing migration tests for invoker rights, empty `search_path`,
  authenticated-only execution, same-key replay, changed-body rejection,
  owner isolation, and one minimal audit event.
- [x] Run the focused migration test and verify the expected missing-function
  failure.
- [x] Add the `(user_id, created_at desc, id desc)` goals cursor index.
- [x] Implement `public.create_goal(...) returns public.goals` as
  `security invoker`, using `auth.uid()`, the existing idempotency table, a
  deterministic request fingerprint, and one audit insert.
- [x] Revoke PUBLIC execution and grant only `authenticated`.
- [x] Re-run the focused migration test.

### Task 2: Goal Repository

**Files:**
- Modify: `apps/life-console/src/supabase/repository.ts`
- Create: `apps/life-console/src/supabase/goals.ts`
- Modify: `apps/life-console/tests/supabase/repository.test.ts`
- Create: `apps/life-console/tests/supabase/goals.test.ts`

- [x] Write failing tests for a fixed active-goal list query, composite
  `created_at/id` cursor, RPC request mapping, input validation, one-call
  writes, revision conflict, update, archive, and restore.
- [x] Extend the repository list union only for `goals/created_at`, with a
  fixed `deleted_at is null` predicate.
- [x] Implement typed `Goal`, `CreateGoalInput`, and `UpdateGoalInput`
  contracts plus `GoalRepository`.
- [x] Keep table names, fields, status values, and filter fragments closed
  over approved unions/constants.
- [x] Re-run focused Repository tests and TypeScript build.

### Task 3: Injectable Goals panel

**Files:**
- Create: `apps/life-console/src/features/goals/SupabaseGoalsPanel.tsx`
- Create: `apps/life-console/tests/ui/supabase-goals-panel.test.tsx`
- Modify: `apps/life-console/src/styles.css`

- [x] Write failing UI tests for loading, empty state, create, update,
  conflict, retryable failure, archive, and retained form input.
- [x] Implement the panel against an injected Goal Repository port.
- [x] Reuse the approved Life Console visual language and explicit
  saving/success/conflict/failure states.
- [x] Do not connect the panel to `App.tsx`, `main.tsx`, a hosted URL, or a
  real user.
- [x] Re-run focused UI tests and TypeScript build.

### Task 4: Evidence, verification, and Draft PR

**Files:**
- Modify: `docs/knowledge-base/README.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/README.md`
- Modify:
  `docs/knowledge-base/生活助手-LifeConsole-2.2.0/技术方案-生活助手-LifeConsole-2.2.0.md`
- Modify:
  `docs/knowledge-base/生活助手-LifeConsole-2.2.0/工程评审与验收-生活助手-LifeConsole-2.2.0.md`
- Modify:
  `docs/knowledge-base/生活助手-LifeConsole-2.2.0/项目管理-生活助手-LifeConsole-2.2.0.md`
- Modify:
  `docs/superpowers/plans/2026-08-12-life-console-220-goals-crud.md`

- [x] Record focused counts and explicitly state that no hosted
  Auth/PostgREST behavior was verified.
- [ ] Run `git diff --check`, governance, index/history privacy, root
  `validate_project.py`, and tool tests.
- [x] Run public-registry `npm ci`, focused tests, `npm test`, and
  `npm run build`.
- [ ] Commit only generic goal CRUD code, synthetic tests, and updated
  documentation.
- [ ] Push to the existing Draft PR #40, wait for `node`, `python`, and
  `privacy`, and record actual results.
