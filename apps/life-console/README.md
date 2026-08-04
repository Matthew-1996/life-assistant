# Life Console

Life Console is the Mac-only local workspace for the life assistant. This
directory contains the portable application foundation and synthetic API
contract assets. The iCloud project remains the source of truth.

## Current scope

Implemented in the foundation package:

- Vite, React, and TypeScript build scaffold;
- the frozen `/api/v1` OpenAPI contract;
- shared TypeScript contract types;
- synthetic dashboard, receipt, and error fixtures;
- contract tests for schema validity and localhost-only configuration;
- Mac desktop pages for Today, Progress, Records, and System;
- in-memory anchor, trend, handoff, and fallback form interactions;
- a Python standard-library Life Hub with localhost-only read endpoints.

Not implemented yet:

- real source writes;
- LaunchAgent packaging, deployment, mobile access, or remote access;
- Google Sheets synchronization or a new Todo source of truth.

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

After building the UI, start the local read-only Hub from this directory:

```bash
python3 -m hub.server
```

The server rejects non-loopback bind addresses. It reads only whitelisted
Dashboard fields and serves the built UI from `dist/`.

## Structure

```text
contracts/
  life-console.openapi.yaml
  fixtures/                 synthetic data only
src/
  contracts/                shared TypeScript types
tests/
  contract/                 OpenAPI and fixture checks
```

Future agents should keep feature ownership isolated under `src/features/`,
`src/components/shell/`, or the future `hub/` directory. Changes to the
OpenAPI file and shared contract types require explicit Integrator ownership.

## Data boundary

Fixtures must be invented for testing. Never copy `USER.md`, `MEMORY.md`,
`GOALS.md`, journal or record data, Apple Health exports, service bindings,
backups, prompts, credentials, or machine-specific absolute paths into this
package. Journal text must not appear in URLs, command arguments, logs,
screenshots, or browser persistence.
