# Life Console

Life Console is the Mac-only local workspace for the life assistant. This
directory contains the portable application foundation and synthetic API
contract assets. The iCloud project remains the source of truth.

## Current scope

Implemented in phase one:

- Vite, React, and TypeScript build scaffold;
- the frozen `/api/v1` OpenAPI contract;
- shared TypeScript contract types;
- synthetic dashboard, receipt, and error fixtures;
- contract tests for schema validity and localhost-only configuration;
- Mac desktop pages for Today, Progress, Records, and System;
- the trial-week interaction baseline from `docs/design/life-console-trial-week-redesign/`;
- source-backed anchor, trend, handoff, and fallback form interactions;
- quick daily-anchor writes for wake, body/light, life action, and wind-down;
- a Python standard-library Life Hub with authenticated localhost reads;
- whitelisted journal and daily-checkin writes through existing atomic tools;
- revision-conflict, idempotency, purge-plan, and partial-refresh handling;
- rebuildable LaunchAgent and local launcher generation;
- a dedicated, ad-hoc-signed Mac app launcher so launchd-owned Python work can
  inherit the product's user-approved protected-file access.
- a credential-free local backup core that validates `life-console-backup/1`,
  writes a private temporary file, performs ZIP safety and digest checks, and
  atomically replaces one caller-configured latest backup;
- the Life Console 2.1.0 five-section System page and synthetic-only iCloud
  backup state model. Worker export and browser-loopback integration remain
  intentionally blocked until their separate POC gate passes.

Not enabled or included in phase one:

- automatic LaunchAgent installation, mobile access, or remote access;
- Google Sheets synchronization or a new Todo source of truth.

Passing synthetic write tests proves only the adapter behavior. Each machine
must still complete a separately approved, reversible real-write acceptance
before its generated runtime may report iCloud as `writable` and automation as
`ready`.

## Requirements

- Node.js `>=22.13.0`
- npm

## Commands

Run from this directory:

```bash
npm ci
npm run check:contracts
npm run build
npm test
```

`src/contracts/life-console.ts` is generated from the OpenAPI document. Do not
edit it directly. `npm run check:contracts` regenerates the file and fails when
the committed output is stale.

Use `npm run dev` only for local UI development. The Vite development server is
not the production Life Hub and must not be exposed as a personal-data API.

After building the UI, start the local Hub from this directory and point it at
the intended iCloud project root:

```bash
python3 -m hub.server --root /path/to/private/icloud-project
```

When `--root` is omitted, the repository root containing `apps/life-console`
is used. The server rejects non-loopback bind addresses, requires a short-lived
local session for personal-data reads, requires same-port Origin plus CSRF for
writes, reads only whitelisted Dashboard fields, and serves `dist/`.

On macOS, build the dedicated background app first:

```bash
python3 packaging/build_macos_app.py \
  --output '/path/to/private/runtime/Life Console.app'
```

Rebuilding an existing dedicated bundle requires the explicit `--replace`
flag; unrelated app-bundle names are rejected.

Then generate, but do not install, machine-local launch files with:

```bash
python3 packaging/generate_launch_agent.py \
  --output-dir /path/to/private/runtime \
  --app-root /path/to/staged/life-console \
  --project-root /path/to/private/icloud-project \
  --program '/path/to/private/runtime/Life Console.app/Contents/MacOS/LifeConsoleLauncher' \
  --python-executable /absolute/path/to/python3
```

Only after the installed LaunchAgent has passed a real read, idempotent write,
read-back, logical withdrawal, and integrity check should the same command add
`--icloud-status writable --automation-status ready`.

The generated plist and `.command` launcher contain paths for the current
machine. Logs stay inside the permission-restricted runtime directory. These
files are not installed or loaded automatically; they are runtime artifacts,
not portable source files, and must not be committed.

## Vercel synthetic preview

`npm run build:vercel-preview` creates a static, read-only candidate in
`dist/vercel-preview`. It contains only committed synthetic fixtures and does
not include the Stage A Worker POC, Sites authentication, D1, R2, KEK, iCloud,
or any personal record. `vercel.json` configures this build and fail-closed
browser security headers.

Use a pinned Vercel CLI and link the directory to the intended project before
deployment. `.vercel/` and `.env*` are local runtime state and must never be
committed. Verify a deployment with an unauthenticated HTTP request and a
browser walk through Workbench, Records, Progress, and System before handing
out its stable alias.

This preview has no backend. If a future version needs authentication,
database storage, or APIs, the PO-selected backend is Supabase. That change
requires a separate Auth, RLS, data model, migration, privacy, and test review;
do not silently move the existing Sites/D1 data path.

## Structure

```text
contracts/
  life-console.openapi.yaml
  fixtures/                 synthetic data only
hub/
  read_model/               whitelisted iCloud projection
  command_runner/           fixed atomic-tool adapters
  security/                 loopback/session/origin policy
local_agent/
  backup_store.py           ZIP validation, atomic replacement, receipts
src/
  contracts/                shared TypeScript types
tests/
  contract/                 OpenAPI and fixture checks
  hub/                      read/write/security integration checks
  local_agent/              synthetic atomic-backup and failure tests
  e2e/                      synthetic full workflow
```

## Data boundary

Fixtures must be invented for testing. Never copy `USER.md`, `MEMORY.md`,
`GOALS.md`, journal or record data, Apple Health exports, service bindings,
backups, prompts, credentials, or machine-specific absolute paths into this
package. Journal text must not appear in URLs, command arguments, logs,
screenshots, or browser persistence.
