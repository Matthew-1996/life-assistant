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
- source-backed anchor, trend, handoff, and fallback form interactions;
- a Python standard-library Life Hub with authenticated localhost reads;
- whitelisted journal and daily-checkin writes through existing atomic tools;
- revision-conflict, idempotency, purge-plan, and partial-refresh handling;
- rebuildable LaunchAgent and local launcher generation.

Not enabled or included in phase one:

- an approved write against a user's current iCloud source of truth;
- automatic LaunchAgent installation, mobile access, or remote access;
- Google Sheets synchronization or a new Todo source of truth.

Passing synthetic write tests proves the adapter behavior. It does not prove
that a particular iCloud project is writable. The System page reports
`readable` until a separately approved real write has been completed and
verified.

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

Generate, but do not install, machine-local launch files with:

```bash
python3 packaging/generate_launch_agent.py \
  --output-dir /path/to/private/runtime \
  --project-root /path/to/private/icloud-project
```

The generated plist and `.command` launcher contain paths for the current
machine. Logs stay inside the permission-restricted runtime directory. These
files are not installed or loaded automatically; they are runtime artifacts,
not portable source files, and must not be committed.

## Structure

```text
contracts/
  life-console.openapi.yaml
  fixtures/                 synthetic data only
hub/
  read_model/               whitelisted iCloud projection
  command_runner/           fixed atomic-tool adapters
  security/                 loopback/session/origin policy
src/
  contracts/                shared TypeScript types
tests/
  contract/                 OpenAPI and fixture checks
  hub/                      read/write/security integration checks
  e2e/                      synthetic full workflow
```

## Data boundary

Fixtures must be invented for testing. Never copy `USER.md`, `MEMORY.md`,
`GOALS.md`, journal or record data, Apple Health exports, service bindings,
backups, prompts, credentials, or machine-specific absolute paths into this
package. Journal text must not appear in URLs, command arguments, logs,
screenshots, or browser persistence.
