# Life Console 2.2.0 Production Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch Life Console 2.2.0 on an isolated Tokyo Supabase Production project, migrate the complete authorized iCloud source set with auditable validation, and switch the product truth source only after a final PO gate.

**Architecture:** Keep iCloud as the only truth source until the final switch. Create an isolated Production Supabase project, apply versioned migrations, and validate it with synthetic data before any private data access. A local-only migration runner will read only an explicitly approved source manifest, produce count/digest reports in dry-run mode, import idempotently, verify the remote result, and preserve rollback artifacts outside Git.

**Tech Stack:** TypeScript, Node.js, Vitest, Supabase Postgres/Auth/RLS, Vercel, Python project validation.

---

## Scope And Gates

- PR #40 was squash merged as `bdfbf79e5d37aae65d7513ba9ef162a07bfb5f3e`.
- Production region decision: Tokyo (`ap-northeast-1`).
- Sensitive-field decision: rely on RLS; do not add application-layer field encryption. This accepts that authorized database administrators can read plaintext values.
- Launch target: complete migration and truth-source switch.
- This plan does not authorize payment, private-data reads, private-data upload, final truth-source switch, resource deletion, or public sharing by itself.
- Stop before project creation if the selected Supabase plan creates a charge that the PO has not approved.
- Stop before private-data inspection until the exact source manifest and allowed fields are shown to and approved by the PO.
- Stop before final switch until backup, dry-run, import verification, rollback rehearsal, and Production E2E evidence are complete and the PO confirms the final switch.

### Task 1: Record Stage G Decisions And Controls

**Files:**
- Create: `docs/superpowers/plans/2026-08-13-life-console-production-launch.md`
- Modify: `docs/knowledge-base/README.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/README.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/生活助手-LifeConsole-2.2.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/技术方案-生活助手-LifeConsole-2.2.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/工程评审与验收-生活助手-LifeConsole-2.2.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/项目管理-生活助手-LifeConsole-2.2.0.md`

- [ ] **Step 1: Record the four approved decisions**

Record the merged PR, Tokyo Production project, RLS-only sensitive-field boundary, and complete migration/switch target without recording project IDs, URLs, credentials, or private data.

- [ ] **Step 2: Record remaining independent gates**

Keep cost approval, exact private source scope, private-data read/upload, final switch, and resource deletion as explicit gates.

- [ ] **Step 3: Validate documentation**

Run:

```bash
git diff --check
python3 tools/check_project_governance.py
tools/check_git_privacy.sh
```

Expected: all commands exit 0.

### Task 2: Create And Validate The Production Supabase Project

**Files:**
- Modify only if required by verified platform behavior: `apps/life-console/supabase/migrations/*.sql`
- Test: `apps/life-console/tests/supabase/production-migration.test.ts`
- Evidence: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/工程评审与验收-生活助手-LifeConsole-2.2.0.md`

- [ ] **Step 1: Confirm plan and cost before creation**

Read the current Supabase checkout price in the Dashboard. Record only the plan name and approved monthly amount in the private execution log; never record billing details in Git.

- [ ] **Step 2: Create the isolated Tokyo project**

Use region `ap-northeast-1`. Do not reuse or promote the synthetic test project.

- [ ] **Step 3: Configure fail-closed platform settings**

Disable public signup, keep automatic RLS enabled, avoid automatic exposure of new tables, and configure Production-only Site URL and recovery allowlist.

- [ ] **Step 4: Apply migrations in order**

Apply `0001` through `0003`, create and auto-confirm the Production Owner through Supabase Dashboard, then apply `0004`.

- [ ] **Step 5: Run synthetic Production validation**

Run the hosted permission matrix in a rollback transaction, inspect Security and Performance Advisors, and verify counts are unchanged afterward.

- [ ] **Step 6: Stop on any security mismatch**

Do not continue if any exposed table lacks RLS, required GRANTs or owner indexes; if anon/non-owner isolation fails; or if any credential appears in files, logs, chat, Git, or screenshots.

### Task 3: Build The Local-Only Migration Runner With TDD

**Files:**
- Create: `apps/life-console/scripts/private-migration/source-manifest.ts`
- Create: `apps/life-console/scripts/private-migration/canonical-digest.ts`
- Create: `apps/life-console/scripts/private-migration/dry-run.ts`
- Create: `apps/life-console/scripts/private-migration/import.ts`
- Create: `apps/life-console/scripts/private-migration/verify.ts`
- Create: `apps/life-console/scripts/private-migration/cli.mts`
- Create: `apps/life-console/tests/migration/source-manifest.test.ts`
- Create: `apps/life-console/tests/migration/dry-run.test.ts`
- Create: `apps/life-console/tests/migration/import.test.ts`
- Create: `apps/life-console/tests/migration/verify.test.ts`
- Modify: `.gitignore`
- Modify: `apps/life-console/package.json`

- [ ] **Step 1: Write failing manifest tests**

Test that the runner rejects implicit directory discovery, unapproved resource types, symlinks, paths outside the approved root, unknown fields, and source changes after approval.

- [ ] **Step 2: Run the manifest tests and verify RED**

Run:

```bash
npm test -- --run tests/migration/source-manifest.test.ts
```

Expected: FAIL because the migration modules do not exist.

- [ ] **Step 3: Implement explicit source-manifest validation**

Require a caller-supplied manifest with resource type, absolute source path, source revision/digest, approved field list, and expected record count. Do not scan private directories.

- [ ] **Step 4: Add canonical dry-run reporting**

Generate per-resource counts and SHA-256 digests without including raw content. Write reports only to an ignored, caller-supplied private directory.

- [ ] **Step 5: Add idempotent import tests and implementation**

Use stable source IDs and a migration run ID. Reject payload drift for an existing idempotency key, preserve revisions, and stop on partial failure.

- [ ] **Step 6: Add remote verification tests and implementation**

Read back through owner-scoped RPC/API and compare resource counts, stable IDs, revisions, and canonical digests. Never print record bodies.

- [ ] **Step 7: Run focused migration tests**

Run:

```bash
npm test -- --run tests/migration
```

Expected: all migration tests pass using synthetic fixtures only.

### Task 4: Prepare Backup And Rehearse Rollback

**Files:**
- Create: `apps/life-console/scripts/private-migration/rollback.ts`
- Create: `apps/life-console/tests/migration/rollback.test.ts`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/工程评审与验收-生活助手-LifeConsole-2.2.0.md`

- [ ] **Step 1: Define rollback anchors**

Capture a verified local private backup, source manifest digest, pre-import remote counts, migration run ID, and Production deployment ID outside Git.

- [ ] **Step 2: Write failing rollback tests**

Cover pre-switch cleanup of only the current migration run, post-switch freeze behavior, mismatched confirmation rejection, and preservation of the local truth source.

- [ ] **Step 3: Implement rollback rehearsal**

On synthetic data, import, verify, remove only rows attributed to the rehearsal run, and verify the database returns to its pre-run counts.

- [ ] **Step 4: Verify backup artifacts**

Validate the private backup and `life-console-backup/1` archive independently before any real import.

### Task 5: Execute Approved Dry-Run And Real Import

**Files:**
- No private source or report files may be committed.
- Modify only the redacted evidence sections in the 2.2.0 knowledge base.

- [ ] **Step 1: Present the exact private source manifest gate**

Show the PO resource categories, field names, counts, and paths at a redacted level. Obtain explicit approval before reading record bodies.

- [ ] **Step 2: Run private dry-run**

Produce count/digest/error summaries without uploading data. Stop on unknown fields, unsupported revisions, invalid dates, dangling relationships, or source drift.

- [ ] **Step 3: Obtain upload authorization**

Present the dry-run summary and rollback anchors. Obtain explicit authorization before uploading private data.

- [ ] **Step 4: Import once**

Freeze iCloud writes for the migration window, execute one idempotent import, and prohibit dual writes.

- [ ] **Step 5: Verify the complete result**

Compare every approved resource count, stable ID set, revision set, relationship count, and canonical digest. Perform a small PO-approved UI sample without copying private content into logs or documentation.

### Task 6: Configure And Validate Vercel Production

**Files:**
- Modify only if required: `apps/life-console/vercel.mjs`
- Modify only if required: `apps/life-console/vercel.json`
- Test: `apps/life-console/tests/vercel/supabase-candidate-config.test.ts`
- Evidence: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/工程评审与验收-生活助手-LifeConsole-2.2.0.md`

- [ ] **Step 1: Configure Production-only variables**

Set only `VITE_SUPABASE_URL` and the publishable key for the isolated Production project. Never expose the secret/service-role key.

- [ ] **Step 2: Deploy Production**

Build from the reviewed Stage G branch/commit and deploy with the SPA rewrite intact.

- [ ] **Step 3: Run Production E2E**

Verify password login, four pages, one approved create/update/read flow, logout, direct `/auth/recovery` routing, CSP exact origin, security headers, and no horizontal overflow at 390x844.

- [ ] **Step 4: Verify environment separation**

Confirm Preview still points only to the synthetic project and Production points only to the Production project.

### Task 7: Final Switch Gate And Project Closure

**Files:**
- Modify: `docs/knowledge-base/README.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/README.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/工程评审与验收-生活助手-LifeConsole-2.2.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/项目管理-生活助手-LifeConsole-2.2.0.md`

- [ ] **Step 1: Present final evidence**

Present backup verification, dry-run summary, import verification, rollback rehearsal, Production E2E, environment separation, and open residual risks.

- [ ] **Step 2: Obtain final PO switch confirmation**

Do not change the truth-source designation without a new explicit confirmation after reviewing the evidence.

- [ ] **Step 3: Switch and monitor**

Mark Supabase Production as primary, keep iCloud read-only as the rollback source for the agreed window, and monitor Auth/API/database errors.

- [ ] **Step 4: Run full verification**

Run:

```bash
git diff --check
python3 tools/check_project_governance.py
python3 -m unittest discover -s tools -p 'test_*.py'
tools/check_git_privacy.sh
tools/check_git_privacy.sh --history origin/main..HEAD
cd apps/life-console && npm test -- --run && npm run build
```

Expected: all project-relevant checks pass. Any known unrelated validator issue must be reported and must not be hidden.

- [ ] **Step 5: Update status and close through a PR**

Mark 2.2.0 `已上线` only after Production verification. Open a Draft PR for Stage G changes, obtain review, merge through GitHub, and then remove the Stage G branch/worktree. Do not delete the old 2.2.0 worktree until its untracked drafts have an explicit disposition.
