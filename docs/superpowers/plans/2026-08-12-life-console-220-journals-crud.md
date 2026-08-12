# Life Console 2.2.0 Journals CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Stage C synthetic journal create/read/list/update behavior
with atomic append-only revision snapshots, while deferring withdrawal and D3
encryption.

**Architecture:** `journals` remains the current row. A restricted PostgreSQL
trigger appends the complete resulting version to `journal_revisions` after
each insert or content update in the same transaction. Idempotent creation
uses an authenticated invoker RPC; revision-guarded updates use the existing
Data API repository boundary. An injectable panel exercises only synthetic
content and remains disconnected from production entry points.

**Tech Stack:** PostgreSQL/Supabase migration SQL, PGlite, React 19,
TypeScript 5.9, `@supabase/supabase-js`, Vitest, Testing Library.

---

### Task 1: Atomic journal revision schema and create RPC

**Files:**
- Modify: `apps/life-console/supabase/migrations/0001_life_console.sql`
- Modify: `apps/life-console/supabase/seed.synthetic.sql`
- Modify: `apps/life-console/tests/supabase/production-migration.test.ts`

- [x] **Step 1: Write failing migration tests**

Add tests proving:

```text
create_journal is security invoker, has an empty search_path, and only
authenticated can execute it.
authenticated can select but cannot directly insert journal_revisions.
creating a journal atomically writes revision 1 with a complete resulting
snapshot and a minimal audit event.
replaying the same idempotency key returns the same journal.
changing the request under the same key is rejected.
updating id + expected revision appends exactly revision N+1.
a stale update changes neither the current row nor revision history.
Owner A cannot read or mutate Owner B journals or revisions.
```

- [x] **Step 2: Run RED migration tests**

Run:

```bash
npx vitest run tests/supabase/production-migration.test.ts
```

Expected: FAIL because journal trigger/RPC and restricted revision grants do
not exist.

- [x] **Step 3: Implement the minimal SQL**

Implement these contracts:

```sql
create function public.record_journal_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
```

The trigger must reject an initial revision other than `1`, reject updates
unless `new.revision = old.revision + 1`, and append:

```json
{
  "event_date": "YYYY-MM-DD",
  "title": "nullable string",
  "content": "synthetic string",
  "tags": ["string"],
  "deleted_at": null
}
```

Use reason `create` for inserts and `update` for updates. Revoke direct
`INSERT` on `journal_revisions` from `authenticated`; keep Owner-scoped
`SELECT`. Add authenticated-only `public.create_journal(...)` with
`security invoker`, empty `search_path`, `(user_id,key)` idempotency,
request fingerprint validation, minimal audit metadata, and no secret or
content in audit rows. Remove the manual seed revision insert because the
trigger creates it.

- [x] **Step 4: Run GREEN migration tests**

Run:

```bash
npx vitest run tests/supabase/production-migration.test.ts
```

Expected: all migration tests pass.

### Task 2: Journal Repository

**Files:**
- Create: `apps/life-console/src/supabase/journals.ts`
- Create: `apps/life-console/tests/supabase/journals.test.ts`

- [x] **Step 1: Write failing Repository tests**

Define the intended boundary:

```ts
interface JournalRepositoryPort {
  list(options?: JournalListOptions): Promise<Page<Journal>>;
  get(id: number): Promise<Journal | null>;
  revisions(id: number): Promise<JournalRevision[]>;
  create(key: string, input: CreateJournalInput): Promise<Journal>;
  update(
    id: number,
    expectedRevision: number,
    input: UpdateJournalInput,
  ): Promise<Journal>;
}
```

Test canonical ISO dates, title length 200, required non-empty synthetic
content up to 100,000 characters, normalized unique tags, fixed
`(event_date,id)` pagination, active-row filtering, revision ordering,
idempotent RPC mapping, revision conflict mapping, one read retry, and no
hidden write retry.

- [x] **Step 2: Run RED Repository tests**

Run:

```bash
npx vitest run tests/supabase/journals.test.ts
```

Expected: FAIL because `src/supabase/journals.ts` does not exist.

- [x] **Step 3: Implement the minimal Repository**

Use `LifeConsoleRepository.listPage`, `executeRead`, `createIdempotent`, and
`updateWithRevision`. Queries must use fixed table/column names and
`deleted_at is null`; callers cannot supply SQL fragments. Keep all methods
as rejected-Promise error boundaries and never log content.

- [x] **Step 4: Run GREEN Repository and type checks**

Run:

```bash
npx vitest run tests/supabase/repository.test.ts \
  tests/supabase/journals.test.ts
./node_modules/.bin/tsc -b
```

Expected: all focused tests and TypeScript checks pass.

### Task 3: Injectable journals panel

**Files:**
- Create: `apps/life-console/src/features/journals/SupabaseJournalsPanel.tsx`
- Create: `apps/life-console/tests/ui/supabase-journals-panel.test.tsx`
- Modify: `apps/life-console/src/styles.css`

- [x] **Step 1: Write failing UI tests**

Cover loading, genuine empty state, create, edit with expected revision,
revision history display, conflict retention, failed-create same-key retry,
and absence of withdrawal controls.

- [x] **Step 2: Run RED UI tests**

Run:

```bash
npx vitest run tests/ui/supabase-journals-panel.test.tsx
```

Expected: FAIL because the panel does not exist.

- [x] **Step 3: Implement the minimal panel**

Inject `JournalRepositoryPort` and `createIdempotencyKey`. Keep create/edit
inputs after conflict or transient failure, reuse the create key until
success, and show revision history without raw logs. Do not wire the panel
into `App.tsx`, `main.tsx`, CSP, hosted URLs, or real data.

- [x] **Step 4: Run GREEN UI and focused regression tests**

Run:

```bash
npx vitest run tests/supabase/production-migration.test.ts \
  tests/supabase/repository.test.ts \
  tests/supabase/journals.test.ts \
  tests/ui/supabase-journals-panel.test.tsx
./node_modules/.bin/tsc -b
```

Expected: all focused tests and TypeScript checks pass.

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
  `docs/superpowers/plans/2026-08-12-life-console-220-journals-crud.md`

- [x] **Step 1: Record scope and focused evidence**

Record that PO chose to defer withdrawal, D3 encryption remains a separate
real-data gate, revision snapshots are complete resulting versions, and the
panel is not production-wired.

- [x] **Step 2: Run full gates**

Run governance, index/history privacy, root project validation, tool tests,
public-Registry `npm ci`, focused tests, full `npm test`, and `npm run build`.

- [x] **Step 3: Commit and push**

Commit only generic code, synthetic tests, and redacted documentation to the
existing `agent/life-console-220-supabase` branch and Draft PR #40.

- [x] **Step 4: Record actual CI**

Wait for `node`, `python`, and `privacy`; record only observed results. Do not
create resources, deploy, connect real data, change CSP, turn the PR Ready, or
merge it.
