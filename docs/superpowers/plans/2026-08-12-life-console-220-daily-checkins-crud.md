# Life Console 2.2.0 Daily Check-ins CRUD Implementation Plan

> **Execution:** Follow TDD in the existing 2.2.0 worktree and Draft PR #40.

**Goal:** Complete the Stage C synthetic daily-status CRUD module while
aligning the Supabase schema with the already approved 1-5 integer rating
contract.

**Architecture:** The migration stores four nullable 1-5 ratings, fixed
anchors JSON, and notes. A caller-rights `create_daily_checkin` RPC performs
idempotent creation and minimal audit insertion atomically. `DailyCheckinRepository`
uses fixed date/list queries and revision-guarded updates. An injectable panel
demonstrates date loading, explicit partial fields, create/update, conflict,
failure retention, and unknown-value semantics without production wiring.

---

### Task 1: Align schema and add create RPC

**Files:**
- Modify: `apps/life-console/supabase/migrations/0001_life_console.sql`
- Modify: `apps/life-console/supabase/seed.synthetic.sql`
- Modify: `apps/life-console/tests/supabase/pglite-rls-poc.test.ts`
- Modify: `apps/life-console/tests/supabase/production-migration.test.ts`

- [x] Write failing tests for 1-5 integer checks, idempotent create, changed
  request rejection, same-date conflict, owner isolation, anonymous denial,
  null preservation, fixed anchors, and minimal audit.
- [x] Replace the divergent 0-10 decimal schema/fixtures with the approved
  nullable 1-5 integer contract.
- [x] Implement authenticated-only `create_daily_checkin` as security invoker
  with empty `search_path`.
- [x] Revoke PUBLIC execution and grant only authenticated.
- [x] Re-run migration and PGlite tests.

### Task 2: Daily Check-in Repository

**Files:**
- Modify: `apps/life-console/src/supabase/repository.ts`
- Create: `apps/life-console/src/supabase/daily-checkins.ts`
- Modify: `apps/life-console/tests/supabase/repository.test.ts`
- Create: `apps/life-console/tests/supabase/daily-checkins.test.ts`

- [x] Write failing tests for fixed date lookup, recent cursor pages,
  score/anchor/note validation, RPC mapping, partial revision update, conflict,
  and no hidden write retry.
- [x] Add a reusable read execution boundary with one transient retry.
- [x] Extend approved cursor columns only for
  `daily_checkins/checkin_date`.
- [x] Implement typed daily-status contracts and repository.
- [x] Re-run focused tests and TypeScript build.

### Task 3: Injectable Daily Check-in panel

**Files:**
- Create:
  `apps/life-console/src/features/checkins/SupabaseDailyCheckinPanel.tsx`
- Create:
  `apps/life-console/tests/ui/supabase-daily-checkin-panel.test.tsx`
- Modify: `apps/life-console/src/styles.css`

- [x] Write failing UI tests for loading, empty state, explicit-only fields,
  create, update, conflict, failure retention, and unknown values.
- [x] Reuse one idempotency key across failed create retries.
- [x] Implement explicit saving/success/conflict/failure feedback.
- [x] Keep the panel disconnected from `App.tsx`, `main.tsx`, hosted URLs,
  and real data.
- [x] Re-run focused UI tests and TypeScript build.

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
  `docs/superpowers/plans/2026-08-12-life-console-220-daily-checkins-crud.md`

- [x] Record focused evidence and hosted-verification limits.
- [x] Run governance, privacy, project, tool, clean-install, full test, and
  production build gates.
- [x] Commit and push only generic code, synthetic tests, and documentation to
  Draft PR #40.
- [x] Wait for `node`, `python`, and `privacy`, then record actual results.
