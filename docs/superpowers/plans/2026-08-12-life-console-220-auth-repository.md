# Life Console 2.2.0 Auth And Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a synthetic-tested Supabase browser client, token-safe Auth boundary, OTP gate, and reusable Repository foundation without creating or connecting remote resources.

**Architecture:** `src/supabase/client.ts` owns environment validation and creates the SDK with `db.retry=false`. `auth.ts` maps Supabase sessions to a token-free application session and exposes OTP, verification, sign-out, and subscription. `repository.ts` owns Data API cursor pagination, read-only transient retries, normalized errors, revision-guarded updates, and a no-hidden-retry write boundary. Auth UI remains an injectable component until a separately authorized hosted environment exists.

**Tech Stack:** React 19, TypeScript 5.9, `@supabase/supabase-js` 2.112.3, Vitest 3, Testing Library.

---

### Task 1: Supabase browser client

**Files:**
- Create: `apps/life-console/src/supabase/client.ts`
- Create: `apps/life-console/tests/supabase/client.test.ts`
- Modify: `apps/life-console/package.json`
- Modify: `apps/life-console/package-lock.json`

- [x] Write failing tests for exact URL/publishable-key loading, missing configuration, secret-key rejection, and `db.retry=false`.
- [x] Run `npx vitest run tests/supabase/client.test.ts`; expect failure because `src/supabase/client.ts` does not exist.
- [x] Implement `resolveSupabaseConfig()` and `createLifeConsoleSupabaseClient()` with optional synthetic fetch injection.

```ts
export interface SupabaseBrowserConfig {
  url: string;
  publishableKey: string;
}

export function resolveSupabaseConfig(
  env: Record<string, string | boolean | undefined>,
): SupabaseBrowserConfig | null;

export function createLifeConsoleSupabaseClient(
  config: SupabaseBrowserConfig,
  fetch?: typeof globalThis.fetch,
): SupabaseClient;
```

- [x] Move `@supabase/supabase-js` from `devDependencies` to `dependencies`; refresh the lockfile with the public npm registry.
- [x] Re-run the focused test and require all assertions to pass.

### Task 2: Token-safe Auth service

**Files:**
- Create: `apps/life-console/src/supabase/auth.ts`
- Create: `apps/life-console/tests/supabase/auth.test.ts`

- [x] Write failing tests for `shouldCreateUser=false`, six-digit OTP verification, token-free session mapping, sign-out, and unsubscribe cleanup.
- [x] Run `npx vitest run tests/supabase/auth.test.ts`; expect failure because the Auth service does not exist.
- [x] Implement `createSupabaseAuthService()` against a narrow Supabase Auth port.

```ts
export interface AuthSession {
  userId: string;
  email: string | null;
  expiresAt: string | null;
}

export interface LifeConsoleAuthService {
  session(): Promise<AuthSession | null>;
  requestOtp(email: string): Promise<void>;
  verifyOtp(email: string, token: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  subscribe(listener: (session: AuthSession | null) => void): () => void;
}
```

- [x] Return only `userId`, email ownership metadata, and expiry metadata; never expose access or refresh tokens.
- [x] Re-run the focused test and require all assertions to pass.

### Task 3: OTP Auth gate

**Files:**
- Create: `apps/life-console/src/features/auth/SupabaseAuthGate.tsx`
- Create: `apps/life-console/tests/ui/supabase-auth-gate.test.tsx`
- Modify: `apps/life-console/src/styles.css`

- [x] Write failing UI tests for initial session loading, unauthenticated-only login content, neutral OTP sent feedback with masked email, six-digit verification, authenticated children, session expiry, and sign-out.
- [x] Run `npx vitest run tests/ui/supabase-auth-gate.test.tsx`; expect failure because the component does not exist.
- [x] Implement the injectable Auth gate and compact login card using the approved 2.2.0 visual language.

```tsx
export interface SupabaseAuthGateProps {
  auth: LifeConsoleAuthService;
  children: ReactNode;
}

export function SupabaseAuthGate(
  props: SupabaseAuthGateProps,
): ReactElement;
```

- [x] Do not connect the gate to `main.tsx` or any hosted URL in this block.
- [x] Re-run the focused UI test and require all assertions to pass.

### Task 4: Repository foundation

**Files:**
- Create: `apps/life-console/src/supabase/repository.ts`
- Create: `apps/life-console/tests/supabase/repository.test.ts`

- [x] Write failing tests using the real Supabase SDK with a synthetic fetch transport.
- [x] Cover composite cursor generation, page-size bounds, one manual retry for transient reads, no write retry, error normalization, and revision conflict on zero-row update.
- [x] Run `npx vitest run tests/supabase/repository.test.ts`; expect failure because the Repository does not exist.
- [x] Implement `LifeConsoleRepository`, `RepositoryError`, `listPage()`, `updateWithRevision()`, and `executeIdempotentWrite()`.

```ts
export interface Cursor {
  sortValue: string;
  id: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: Cursor | null;
}

export class LifeConsoleRepository {
  listPage<T extends { id: number }>(
    options: ListPageOptions,
  ): Promise<Page<T>>;

  updateWithRevision<T>(
    table: MutableTable,
    id: number,
    expectedRevision: number,
    patch: Record<string, unknown>,
  ): Promise<T>;

  executeIdempotentWrite<T>(
    key: string,
    operation: (key: string) => Promise<SupabaseResult<T>>,
  ): Promise<T>;
}
```

- [x] Restrict table and sort-column names to approved unions; never accept arbitrary SQL/filter fragments.
- [x] Re-run the focused Repository test and require all assertions to pass.

### Task 5: Evidence, full verification, and Draft PR

**Files:**
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/技术方案-生活助手-LifeConsole-2.2.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/工程评审与验收-生活助手-LifeConsole-2.2.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.2.0/项目管理-生活助手-LifeConsole-2.2.0.md`
- Modify: `docs/superpowers/plans/2026-08-12-life-console-220-auth-repository.md`

- [x] Record focused-test counts and state that no hosted Auth/PostgREST behavior was claimed.
- [ ] Run `git diff --check`, governance, index/history privacy, root `validate_project.py`, and tool tests.
- [ ] Run public-registry `npm ci`, focused tests, `npm test`, and `npm run build`.
- [ ] Commit only generic client/Auth/Repository/UI code, synthetic tests, and updated documentation.
- [ ] Push to existing Draft PR #40, wait for `node`, `python`, and `privacy`, and record actual results.
