# Life Console 2.2.0 Synthetic Backup POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package one owner-scoped Supabase snapshot into a versioned `life-console-backup/1` ZIP and prove that the existing 2.1.0 local Agent validates and atomically installs it using synthetic data only.

**Architecture:** A focused browser-safe backup module calls the existing `security invoker` snapshot RPC through the read-retry repository, validates the snapshot envelope, canonicalizes eight approved business resources into NDJSON, computes SHA-256 metadata, and creates a ZIP with `fflate`. Vitest verifies format behavior and drives a Python subprocess against the existing `BackupStore` for the cross-language round-trip; no UI, download wiring, remote resource, deployment, or real iCloud path is added.

**Tech Stack:** TypeScript 5.9, Supabase JS 2.112, Web Crypto, fflate, Vitest 3, Python 3 `BackupStore`

---

### Task 1: Lock the browser-side backup contract

**Files:**
- Modify: `apps/life-console/package.json`
- Modify: `apps/life-console/package-lock.json`
- Create: `apps/life-console/src/supabase/backups.ts`
- Create: `apps/life-console/tests/supabase/backups.test.ts`

- [x] **Step 1: Add failing tests for snapshot reads and contract validation**

Create tests that call the desired `BackupRepository.snapshot()` API with a Supabase mock. Assert that it calls `export_life_console_snapshot`, retries one transient read failure, returns the owner snapshot, and rejects a missing resource array or unsupported schema version with a `RepositoryError` using code `backup_snapshot_invalid`.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/supabase/backups.test.ts
```

Expected: FAIL because `src/supabase/backups.ts` does not exist.

- [x] **Step 3: Implement the minimum snapshot repository**

Define the fixed resource tuple:

```ts
export const BACKUP_RESOURCE_NAMES = [
  "goals",
  "journals",
  "journal_revisions",
  "daily_checkins",
  "weekly_reviews",
  "phase_reviews",
  "health_days",
  "health_segments",
] as const;
```

Add `LifeConsoleSnapshot`, validate `schema_version === 1`, validate `exported_at`, and require every fixed resource to be an array of plain objects. Use `LifeConsoleRepository.executeRead()` around:

```ts
client.rpc("export_life_console_snapshot")
```

Do not include `profiles` or `backup_runs` in the package resource set.

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/supabase/backups.test.ts
```

Expected: snapshot repository tests PASS.

- [x] **Step 5: Commit the contract slice**

Stage only the new backup module and focused tests, then commit:

```text
feat(life-console): define synthetic backup snapshot contract
```

### Task 2: Generate canonical NDJSON, manifest, and ZIP

**Files:**
- Modify: `apps/life-console/package.json`
- Modify: `apps/life-console/package-lock.json`
- Modify: `apps/life-console/src/supabase/backups.ts`
- Modify: `apps/life-console/tests/supabase/backups.test.ts`

- [x] **Step 1: Add `fflate` as a pinned runtime dependency**

Run:

```bash
npm install --save-exact fflate@0.8.2
```

Expected: `package.json` and `package-lock.json` contain only the public npm package metadata.

- [x] **Step 2: Add failing package-format tests**

Test `createBackupArchive(snapshot, options)` for:

```ts
{
  exportId: "synthetic-export-0001",
  sourceProductVersion: "2.2.0",
  sourceSchemaVersion: "supabase/1",
}
```

Assert:

- ZIP contains exactly `manifest.json` and the eight `data/<resource>.ndjson` files.
- Empty arrays become zero-byte NDJSON files with count zero.
- Non-empty NDJSON has recursively sorted object keys, UTF-8 encoding, one object per line, and a final LF.
- Per-resource SHA-256, count, and canonical `archive_content_sha256` match independently recomputed values.
- The returned archive SHA-256 matches the ZIP bytes.
- `profiles` and `backup_runs` are absent.
- Unsupported values such as arrays or primitives inside a resource are rejected.

- [x] **Step 3: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/supabase/backups.test.ts
```

Expected: FAIL because archive creation is not implemented.

- [x] **Step 4: Implement canonical package generation**

Add:

```ts
export interface BackupArchiveResult {
  bytes: Uint8Array;
  archiveSha256: string;
  manifest: BackupManifest;
}
```

Implement recursive key ordering, compact JSON serialization, LF-delimited NDJSON, Web Crypto SHA-256, Python-compatible canonical resource metadata digest, and `fflate.zipSync`. Keep all ZIP member paths fixed by the resource tuple; no caller-provided archive path is accepted.

- [x] **Step 5: Run focused tests and type checking**

Run:

```bash
npx vitest run tests/supabase/backups.test.ts
npx tsc -b
```

Expected: all focused tests PASS and TypeScript exits 0.

- [x] **Step 6: Commit package generation**

Commit:

```text
feat(life-console): package synthetic owner backups
```

### Task 3: Prove 2.1.0 Agent round-trip and failure preservation

**Files:**
- Modify: `apps/life-console/tests/supabase/backups.test.ts`
- Modify: `apps/life-console/tests/local_agent/test_backup_store.py`

- [x] **Step 1: Add a cross-language round-trip compatibility test**

From Vitest, generate a synthetic archive with all eight resource types, write it under a temporary directory, and invoke Python with an explicit temporary target and receipt path. The Python snippet imports `BackupStore`, installs the archive using the supplied run ID and ZIP SHA-256, and prints only the public receipt JSON.

Assert:

- Python exits 0.
- Receipt format is `life-console-backup/1`.
- Counts match the TypeScript manifest.
- Installed bytes exactly match the TypeScript ZIP.
- Receipt and error output do not contain synthetic journal content or temporary machine paths.

- [x] **Step 2: Run the round-trip compatibility test**

Run:

```bash
npx vitest run tests/supabase/backups.test.ts -t "round-trips"
```

Expected: PASS when the new TypeScript package is accepted unchanged by the existing Python Agent. This characterization passed on first execution, proving format compatibility without a Python production change.

- [x] **Step 3: Complete the minimum round-trip harness**

Use `process.execPath` only for Node-side work and `python3 -c` for the existing local Agent. Pass file paths as process arguments rather than interpolating them into Python source. Keep all records synthetic.

- [x] **Step 4: Extend local Agent malformed-package coverage**

Add focused Python tests for:

- truncated ZIP preserves the previous valid backup;
- malformed NDJSON count or digest preserves the previous valid backup;
- duplicate member and path traversal remain rejected;
- empty resource files are accepted with count zero.

- [x] **Step 5: Run TypeScript and Python backup tests**

Run:

```bash
npx vitest run tests/supabase/backups.test.ts
python3 -m unittest discover -v -s tests/local_agent -p 'test_*.py'
```

Expected: all backup tests PASS with no warnings or leaked paths/content.

- [x] **Step 6: Commit round-trip evidence**

Commit:

```text
test(life-console): verify synthetic backup round trip
```

### Task 4: Record evidence and run the full gate

**Files:**
- Modify: `docs/knowledge-base/README.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/README.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/技术方案-生活助手-LifeConsole-2.2.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/工程评审与验收-生活助手-LifeConsole-2.2.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/项目管理-生活助手-LifeConsole-2.2.0.md`
- Modify: `docs/superpowers/plans/2026-08-12-life-console-220-synthetic-backup-poc.md`

- [x] **Step 1: Run focused regression**

Run:

```bash
npx vitest run tests/supabase/backups.test.ts tests/supabase/production-migration.test.ts
python3 -m unittest discover -v -s tests/local_agent -p 'test_*.py'
```

Expected: all focused tests PASS.

- [x] **Step 2: Run repository gates**

Run `git diff --check`, privacy checks, root project validation, tool unit tests, application `npm ci`, `npm test`, and `npm run build` using the existing project commands and public npm registry.

Expected: every gate exits 0; no secret, private mount path, internal registry, or real personal payload is introduced.

- [x] **Step 3: Update the 2.2.0 knowledge base**

Record:

- `life-console-backup/1` remains unchanged.
- Eight business resources are included; `profiles`, `backup_runs`, audit, auth, and idempotency state are excluded.
- The POC uses the invoker RPC snapshot, browser-side canonical packaging, and the existing local Agent validator.
- Evidence covers empty, populated, malformed, truncated, duplicate-path, traversal, digest/count mismatch, atomic replacement, and failure preservation.
- No UI wiring, remote resource, deployment, real iCloud path, real data, D3 encryption decision, or truth-source switch occurred.

- [x] **Step 4: Mark this plan complete and commit evidence**

Commit:

```text
docs(life-console): record synthetic backup validation
```

- [ ] **Step 5: Push only to the existing Draft PR**

Push `agent/life-console-220-supabase`, wait for Node, Python, and privacy checks, and confirm PR #40 remains Draft. Do not create a PR, turn it Ready, merge it, deploy it, or create Supabase/Vercel resources.
