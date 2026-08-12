# Life Console 2.2.0 Supabase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production Supabase migration draft, synthetic seed, and repeatable RLS/permission tests without creating remote resources.

**Architecture:** Production SQL lives under `apps/life-console/supabase/migrations/` and assumes Supabase-provided `auth.users` and `auth.uid()`. PGlite tests install a separate Auth compatibility shim, apply the production migration unchanged, then load a synthetic two-user seed. Static catalog assertions and runtime role tests prove grants, RLS, ownership indexes, update checks, physical-delete denial, and invoker RPC isolation.

**Tech Stack:** PostgreSQL SQL, Supabase Auth/RLS conventions, PGlite 0.5.4, Vitest 3, TypeScript 5.

---

### Task 1: Record Gate 2 and lock the implementation boundary

**Files:**
- Modify: `docs/knowledge-base/README.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/README.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/设计方案-生活助手-LifeConsole-2.2.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/技术方案-生活助手-LifeConsole-2.2.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/工程评审与验收-生活助手-LifeConsole-2.2.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/项目管理-生活助手-LifeConsole-2.2.0.md`

- [ ] Record PO confirmation of O1-O5, Q1-Q7, the test matrix, and stages A-G.
- [ ] State that Gate 2 authorizes only local generic implementation; resources, deployment, real data, cutover, deletion, and merge remain blocked.
- [ ] Run `git diff --check` and `python3 tools/check_project_governance.py`.

### Task 2: Write failing production migration structure tests

**Files:**
- Create: `apps/life-console/tests/supabase/production-migration.test.ts`
- Create: `apps/life-console/tests/supabase/fixtures/auth-shim.sql`

- [ ] Add a test that reads `supabase/migrations/0001_life_console.sql` and fails while the file is absent.
- [ ] Assert the migration creates the approved 12 tables, enables RLS, grants only required operations, adds ownership indexes, and defines `export_life_console_snapshot()` as security invoker with an empty search path.
- [ ] Run `npx vitest run tests/supabase/production-migration.test.ts` and confirm failure is caused by the missing migration.

### Task 3: Implement the production migration

**Files:**
- Create: `apps/life-console/supabase/migrations/0001_life_console.sql`

- [ ] Create `profiles`, `goals`, `journals`, `journal_revisions`, `daily_checkins`, `weekly_reviews`, `phase_reviews`, `health_days`, `health_segments`, `idempotency_keys`, `backup_runs`, and `audit_events`.
- [ ] Add foreign keys, unique constraints, revision checks, date/range checks, and ownership/filter indexes.
- [ ] Revoke default access, grant `authenticated` only the required table/sequence operations, and grant no physical DELETE.
- [ ] Enable RLS and add SELECT/INSERT/UPDATE policies with both `USING` and `WITH CHECK` where updates are allowed.
- [ ] Add a stable `security invoker` export RPC with schema-qualified objects, empty `search_path`, revoked PUBLIC execution, and authenticated-only execution.
- [ ] Run the focused test and confirm the catalog assertions pass.

### Task 4: Add synthetic seed and runtime permission tests

**Files:**
- Create: `apps/life-console/supabase/seed.synthetic.sql`
- Modify: `apps/life-console/tests/supabase/production-migration.test.ts`

- [ ] Add two unrelated synthetic users and synthetic records without real names, emails, dates, or personal content.
- [ ] Test Owner A and Owner B isolation, anon rejection, cross-owner update rejection, `user_id` reassignment rejection, and physical DELETE rejection.
- [ ] Test null preservation, fractional check-in scores, revision conflict behavior, and snapshot RPC owner isolation.
- [ ] Run `npx vitest run tests/supabase/production-migration.test.ts` and confirm all focused tests pass.

### Task 5: Update evidence and run the complete gate

**Files:**
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/技术方案-生活助手-LifeConsole-2.2.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/工程评审与验收-生活助手-LifeConsole-2.2.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/项目管理-生活助手-LifeConsole-2.2.0.md`

- [ ] Record exact focused-test counts and the boundary that no hosted Supabase semantics were claimed.
- [ ] Run `git diff --check`, governance, index/history privacy, root `validate_project.py`, and tool tests.
- [ ] Run `npm ci`, `npm test`, and `npm run build` in `apps/life-console`.
- [ ] Commit only generic SQL, synthetic tests, and updated documentation; push to existing Draft PR #40.
- [ ] Wait for PR #40 `node`, `python`, and `privacy` checks and report their actual results.
