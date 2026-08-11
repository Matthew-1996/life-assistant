# Life Console Synthetic Integration and E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing Sites Worker against Miniflare D1/R2 bindings and verify the synthetic browser write workflow with Playwright, without touching real data or cloud resources.

**Architecture:** A test-only Miniflare harness applies the checked-in D1 migration and injects synthetic owner and KEK bindings. Vitest integration suites call the real Worker over Miniflare; Playwright starts the same harness with built Sites assets and injects only the synthetic owner header at the browser routing boundary.

**Tech Stack:** Miniflare 4, Vitest 3, Playwright, Vite, Cloudflare D1/R2-compatible bindings.

---

### Task 1: Add Test Runtimes and Commands

**Files:**
- Modify: `apps/life-console/package.json`
- Modify: `apps/life-console/package-lock.json`

- [x] **Step 1: Install locked development dependencies**

Run:

```bash
npm install --save-dev miniflare @playwright/test
```

- [x] **Step 2: Add isolated test commands**

Add:

```json
"test:integration:miniflare": "vitest run tests/integration",
"test:e2e:synthetic": "playwright test",
"start:e2e:synthetic": "node scripts/start-synthetic-sites-server.mjs"
```

- [x] **Step 3: Verify existing Vitest remains green**

Run:

```bash
npx vitest run tests/worker
```

Expected: all existing Worker tests pass.

### Task 2: Build a Disposable Miniflare Harness

**Files:**
- Create: `apps/life-console/tests/integration/miniflare-smoke.test.ts`
- Create: `apps/life-console/tests/integration/helpers/miniflare.ts`

- [x] **Step 1: Write the failing smoke test**

The test imports `createSyntheticMiniflare`, sends `GET /api/v1/bootstrap` with `X-Synthetic-Owner`, and expects status 200 plus owner `synthetic-owner`.

- [x] **Step 2: Run it and verify RED**

Run:

```bash
npx vitest run tests/integration/miniflare-smoke.test.ts
```

Expected: FAIL because the harness module does not exist.

- [x] **Step 3: Implement the minimum harness**

The helper must:

```ts
new Miniflare({
  modules: true,
  scriptPath: "worker/sites-200.js",
  d1Databases: ["DB"],
  r2Buckets: ["BACKUP_BUCKET"],
  bindings: {
    ENVIRONMENT: "test",
    ALLOW_SYNTHETIC_AUTH: "true",
    SYNTHETIC_OWNER_ID: "synthetic-owner",
    SESSION_SECRET: "synthetic-session-secret-at-least-32-bytes",
    KEK_JOURNAL_V1: SYNTHETIC_32_BYTE_KEY,
    KEK_HEALTH_V1: SYNTHETIC_32_BYTE_KEY,
    KEK_BACKUP_V1: SYNTHETIC_32_BYTE_KEY
  }
});
```

It then reads `d1/migrations/0001_init.sql`, applies it to `mf.getD1Database("DB")`, exposes an authenticated request helper, and disposes Miniflare after each suite.

- [x] **Step 4: Run it and verify GREEN**

Run:

```bash
npx vitest run tests/integration/miniflare-smoke.test.ts
```

Expected: PASS.

### Task 3: Add Meaningful D1/R2 Integration Coverage

**Files:**
- Create: `apps/life-console/tests/integration/miniflare-security.test.ts`
- Create: `apps/life-console/tests/integration/miniflare-resources.test.ts`
- Create: `apps/life-console/tests/integration/miniflare-maintenance.test.ts`
- Modify: `apps/life-console/tests/integration/helpers/miniflare.ts`

- [x] **Step 1: Add failing security and resource cases**

Cover unauthenticated access, origin/CSRF rejection, bootstrap, goal idempotency, journal encryption, stale revision 409, daily/weekly/phase reviews, health segments, audit filtering, delete planning, and migration transition validation.

- [x] **Step 2: Run and verify failures identify binding or D1 incompatibilities**

Run:

```bash
npx vitest run tests/integration
```

- [x] **Step 3: Make only harness-level compatibility fixes**

Do not change production semantics. Add deterministic fixture helpers and test-only request utilities as needed.

- [x] **Step 4: Add failing R2 and maintenance cases**

Cover full backup object creation, recovery-pack verification, KEK v2 rotation, migration rollback increment, idempotency replay, and audit content exclusion.

- [x] **Step 5: Run all integration tests**

Run:

```bash
npm run test:integration:miniflare
```

Expected: at least 25 passing assertions/cases using real Miniflare D1/R2 bindings.

### Task 4: Start the Synthetic Sites Server for Browsers

**Files:**
- Create: `apps/life-console/scripts/start-synthetic-sites-server.mjs`
- Create: `apps/life-console/playwright.config.ts`
- Create: `apps/life-console/tests/playwright/synthetic-write.spec.ts`

- [x] **Step 1: Write the failing browser test**

The test opens the Sites build, injects `X-Synthetic-Owner` for `/api/**`, creates a goal through the UI, and expects the success state and persisted goal card.

- [x] **Step 2: Run and verify RED**

Run:

```bash
npm run test:e2e:synthetic
```

Expected: FAIL because the synthetic server/config does not exist.

- [x] **Step 3: Implement the synthetic server**

The server must build `sites-200`, apply the D1 migration, bind a local assets fetcher plus D1/R2, listen only on `127.0.0.1`, and terminate cleanly on SIGINT/SIGTERM.

- [x] **Step 4: Configure Playwright**

Use one Chromium project, one worker, retained trace on first retry, and `webServer.command = "npm run start:e2e:synthetic"` with the loopback URL.

- [x] **Step 5: Run and verify GREEN**

Run:

```bash
npm run test:e2e:synthetic
```

Expected: PASS with no real network or cloud access.

### Task 5: Verify and Record Evidence

**Files:**
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.0.0/工程评审与验收-生活助手-LifeConsole-2.0.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.0.0/项目管理-生活助手-LifeConsole-2.0.0.md`

- [x] **Step 1: Run all checks**

```bash
npm test
npm run test:integration:miniflare
npm run test:e2e:synthetic
npm run build
npm run build:sites-200
npm run build:candidate-preview
git diff --check
tools/check_git_privacy.sh
python3 tools/check_project_governance.py
```

- [x] **Step 2: Record exact evidence**

Record case counts, build results, and the boundary that no real Sites/D1/R2/KEK/iCloud resource was accessed.

- [x] **Step 3: Confirm no stage transition**

Keep stage B online deployment and stage C gates open. Do not commit, push, deploy, migrate, or publish.
