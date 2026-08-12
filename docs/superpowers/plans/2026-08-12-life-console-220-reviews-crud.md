# Life Console 2.2.0 Reviews CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Stage C synthetic weekly-review and phase-review CRUD with
idempotent creation, fixed date cursors, revision conflicts, and injectable UI.

**Architecture:** Authenticated invoker RPCs create each review and its
idempotency/audit records atomically. `ReviewRepository` exposes separate
weekly and phase contracts over fixed tables and date columns, while sharing
the existing read retry and revision update boundary. A combined injectable
panel keeps both review types distinct and remains disconnected from
production wiring.

**Tech Stack:** PostgreSQL/Supabase migration SQL, PGlite, React 19,
TypeScript 5.9, `@supabase/supabase-js`, Vitest, Testing Library.

---

### Task 1: Idempotent review creation RPCs

**Files:**
- Modify: `apps/life-console/supabase/migrations/0001_life_console.sql`
- Modify: `apps/life-console/tests/supabase/production-migration.test.ts`

- [x] Write failing tests for authenticated-only invoker RPCs with empty
  `search_path`, same-key replay, changed-request rejection, weekly duplicate
  conflict, phase date-order rejection, Owner isolation, and minimal audit.
- [x] Run the migration test and verify RED is caused by missing RPCs.
- [x] Implement `create_weekly_review(key, week_start, content)` and
  `create_phase_review(key, period_start, period_end, content)` using
  `(user_id,key)` idempotency. Keep the approved weekly unique constraint and
  date-order check; do not add a phase-overlap rule.
- [x] Revoke PUBLIC execution, grant only authenticated, and rerun migration
  tests to GREEN.

### Task 2: Review Repository

**Files:**
- Modify: `apps/life-console/src/supabase/repository.ts`
- Create: `apps/life-console/src/supabase/reviews.ts`
- Modify: `apps/life-console/tests/supabase/repository.test.ts`
- Create: `apps/life-console/tests/supabase/reviews.test.ts`

- [x] Write failing tests for weekly `(week_start,id)` pages, phase
  `(period_start,id)` pages, active-row predicates, canonical dates, required
  content, RPC mapping, date-order validation, revision updates, one read
  retry, and no hidden write retry.
- [x] Run focused tests and verify RED because review contracts do not exist.
- [x] Extend only the approved review tables/cursor columns in
  `ListPageOptions`; implement typed repositories using fixed table names.
- [x] Run Repository tests and TypeScript checks to GREEN.

### Task 3: Injectable reviews panel

**Files:**
- Create: `apps/life-console/src/features/reviews/SupabaseReviewsPanel.tsx`
- Create: `apps/life-console/tests/ui/supabase-reviews-panel.test.tsx`
- Modify: `apps/life-console/src/styles.css`

- [x] Write failing tests for genuine loading/empty states, weekly create,
  phase create, revision update, conflict retention, same-key retry, and
  separation of weekly versus phase inputs.
- [x] Run UI tests and verify RED because the panel does not exist.
- [x] Implement the minimal dependency-injected panel with explicit
  saving/success/conflict/failure states. Do not add deletion, inferred
  content, production entry wiring, remote URLs, or real data.
- [x] Run the focused review suite and TypeScript checks to GREEN.

### Task 4: Evidence and Draft PR

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
  `docs/superpowers/plans/2026-08-12-life-console-220-reviews-crud.md`

- [x] Record focused evidence and hosted-verification limits.
- [x] Run governance, privacy, root project, tool, public clean-install, full
  test, and production build gates.
- [x] Commit and push only generic code, synthetic tests, and redacted
  documentation to existing Draft PR #40.
- [x] Wait for `node`, `python`, and `privacy`; record observed results only.
