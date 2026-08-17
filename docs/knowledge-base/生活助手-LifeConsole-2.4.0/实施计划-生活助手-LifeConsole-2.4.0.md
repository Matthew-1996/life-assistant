# Life Console 2.4.0 Unified Journal Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one versioned journal normalization contract used by Agent and Life Console, preserve raw text first in Supabase, and add a synthetic-only DeepSeek fallback path plus one shared structured renderer.

**Architecture:** A committed JSON contract is the only machine-readable field and Prompt source. Agent submits contract-valid structured output after the raw journal is saved; non-Agent clients call a Vercel server function that uses the same contract and `deepseek-v4-flash`, then completes the same revision-guarded Supabase job. Both paths write one `journals.metadata` projection and render through one component.

**Tech Stack:** TypeScript 5.9, React 19, Vitest, Python 3 standard library, Supabase PostgreSQL/RLS/RPC, Vercel Functions, DeepSeek OpenAI-compatible Chat Completions, AJV 8.

## Global Constraints

- Gate 2 的初始约束是只做合成验证；2026-08-17 的收口授权仅放开 Production 纯合成探针、此前明确指出的唯一 failed journal、PR #54 Ready/合并和正式发布证据，不扩展到其他真实记录。
- 只复用本机 Keychain 与既有 Production Secret，不输出凭据，不创建新 Key，不充值或购买。
- 唯一真实日记由 Agent 优先处理；只有 Agent 生成、校验或原子完成失败时才允许 DeepSeek 兜底，且活动人物投影必须为 0。
- 不读取其他日记原文、不发送人物资料、不批量处理历史、不删除数据。
- Supabase remains the sole journal truth source; raw text is persisted before normalization.
- Agent is the primary processor for Agent-originated entries; DeepSeek is only the non-Agent fallback.
- `deepseek-v4-flash` non-thinking mode is the only allowed synthetic POC model; no automatic model switching.
- Every explicit fact, feeling, place, planning clue, and inference carries an exact evidence substring; profile-based people carry an approved profile revision.
- Existing journals remain `legacy` and are not bulk normalized.
- No individual task or continuous work block exceeds four hours.

---

### Task 1: Versioned contract and two-language validator

**Files:**
- Create: `apps/life-console/contracts/journal-normalization-v1.json`
- Create: `apps/life-console/src/journal/normalization-contract.ts`
- Create: `tools/journal_normalization_contract.py`
- Create: `apps/life-console/tests/journal/normalization-contract.test.ts`
- Create: `tools/test_journal_normalization_contract.py`
- Modify: `apps/life-console/package.json`

**Interfaces:**
- Produces TypeScript `JournalNormalization`, `validateJournalNormalization(value, rawText, contextRevisions)` and `buildJournalNormalizationMessages(rawText, contextEntities)`.
- Produces Python `load_contract()`, `validate_normalization(value, raw_text, context_revisions)` and `build_messages(raw_text, context_entities)`.
- The JSON artifact contains `contract_version`, `prompt_version`, `system_prompt`, `schema`, and fixed limits.

- [ ] **Step 1: Write failing TypeScript contract tests**

Add literal fixtures that require all output fields, reject unknown fields, reject evidence absent from raw text, reject `confirmed_profile` without a matching context revision, and verify Prompt injection stays in the user message.

```ts
expect(() => validateJournalNormalization({
  title: "合成散步",
  summary: "完成一次合成散步。",
  facts: [{ text: "完成散步", basis: "explicit_text", evidence: "不存在片段" }],
  feelings: [], people: [], places: [], themes: [], planning_clues: [],
  inferences: [], tags: [],
}, "今天完成一次合成散步。", {})).toThrow(/evidence/);
```

- [ ] **Step 2: Run the TypeScript test and verify RED**

Run: `cd apps/life-console && npx vitest run tests/journal/normalization-contract.test.ts`

Expected: FAIL because `src/journal/normalization-contract.ts` does not exist.

- [ ] **Step 3: Write failing Python parity tests**

Use the same literal valid and invalid fixtures. Assert `load_contract()["contract_version"] == "journal-normalization/1.0.0"` and that Python rejects the same missing-evidence fixture.

- [ ] **Step 4: Run the Python test and verify RED**

Run: `python3 -m unittest tools.test_journal_normalization_contract -v`

Expected: FAIL because `tools/journal_normalization_contract.py` does not exist.

- [ ] **Step 5: Add the single JSON contract and minimal validators**

The contract requires:

```json
{
  "title": "string <= 120",
  "summary": "string <= 300",
  "facts": [{"text":"string","basis":"explicit_text","evidence":"exact substring"}],
  "feelings": [{"text":"string","basis":"explicit_text","evidence":"exact substring"}],
  "people": [{"text":"string","basis":"explicit_text|confirmed_profile","evidence":"exact substring","profile_revision":"string|null"}],
  "places": [{"text":"string","basis":"explicit_text","evidence":"exact substring"}],
  "themes": ["string"],
  "planning_clues": [{"text":"string","basis":"explicit_text","evidence":"exact substring"}],
  "inferences": [{"text":"string","basis":"tentative_inference","evidence":"exact substring"}],
  "tags": ["string"]
}
```

TypeScript uses AJV for structural checks and explicit evidence/profile-revision checks. Python loads the same artifact and implements the identical observable validations with the standard library. Both builders use the contract's `system_prompt`; neither contains a second Prompt string.

- [ ] **Step 6: Run both test suites and verify GREEN**

Run:

```bash
cd apps/life-console && npx vitest run tests/journal/normalization-contract.test.ts
python3 -m unittest tools.test_journal_normalization_contract -v
```

Expected: all tests pass.

- [ ] **Step 7: Add a contract check script and commit**

Add `test:journal-contract` to `apps/life-console/package.json`, run it, then commit contract, validators, and tests.

---

### Task 2: Supabase normalization state and revision-safe RPCs

**Files:**
- Create: `apps/life-console/supabase/migrations/20260816170000_unified_journal_normalization.sql`
- Create: `apps/life-console/tests/supabase/journal-normalization-migration.test.ts`
- Modify: `apps/life-console/src/supabase/journals.ts`
- Modify: `apps/life-console/tests/supabase/journals.test.ts`

**Interfaces:**
- Produces `create_journal_v2`, `begin_journal_normalization`, `complete_journal_normalization`, and `fail_journal_normalization` RPCs.
- Produces repository methods `createRaw`, `beginNormalization`, `completeNormalization`, and `failNormalization`.
- Produces `Journal.normalization_status`, contract/prompt/processor/source-revision fields, and typed metadata.

- [ ] **Step 1: Write failing migration tests**

Execute existing migrations plus the new migration in PGlite. Assert existing rows become `legacy`, new v2 rows become `pending`, job uniqueness includes journal/source revision/contract, RLS is enabled, and stale completion raises without altering raw content.

- [ ] **Step 2: Run migration tests and verify RED**

Run: `cd apps/life-console && npx vitest run tests/supabase/journal-normalization-migration.test.ts`

Expected: FAIL because the migration and RPCs do not exist.

- [ ] **Step 3: Write failing repository tests**

Assert `createRaw` sends raw text and source metadata but no model result, completion sends expected revision and unified metadata, and `RepositoryError` maps stale revisions to conflict.

- [ ] **Step 4: Run repository tests and verify RED**

Run: `cd apps/life-console && npx vitest run tests/supabase/journals.test.ts`

Expected: FAIL because the new methods and fields do not exist.

- [ ] **Step 5: Implement migration and repository methods**

Use statuses `legacy|pending|processing|completed|failed|stale`. Keep `content` as immutable raw text. The completion RPC must require the current source revision, a processing job owned by `auth.uid()`, the exact contract version, and validated JSON object metadata; it increments revision once and never changes `content`.

- [ ] **Step 6: Run migration and repository tests and verify GREEN**

Run: `cd apps/life-console && npx vitest run tests/supabase/journal-normalization-migration.test.ts tests/supabase/journals.test.ts`

Expected: all tests pass.

- [ ] **Step 7: Commit the database and repository slice**

Stage only the migration, journal repository, and their tests; commit after `git diff --check`.

---

### Task 3: Agent-first cloud write path

**Files:**
- Modify: `tools/life_console_cloud.py`
- Modify: `tools/test_life_console_cloud.py`
- Modify: `journal/QUICK_CAPTURE.md`
- Modify: `journal/README.md`

**Interfaces:**
- `CloudClient.create_journal(record)` first invokes `create_journal_v2`; when `record.normalization` is present and valid, it then begins and completes an Agent job.
- CLI receipt returns only `status=saved`, `normalization_status=completed|pending|failed`, and revision; it never echoes the journal ID or content.

- [ ] **Step 1: Write failing Agent path tests**

Cover raw-first call order, contract validation before the completion RPC, create-success/normalize-failure receipt semantics, absence of local fallback, and no personal content in stdout/stderr.

- [ ] **Step 2: Run tests and verify RED**

Run: `python3 -m unittest tools.test_life_console_cloud -v`

Expected: new assertions fail because the client still calls the legacy RPC and drops metadata.

- [ ] **Step 3: Implement the two-step Agent write**

The CLI accepts `normalization` only when it passes `validate_normalization`. It saves raw first, starts an `agent` job with the returned source revision, and completes the job. A completion failure does not change the saved result to `unavailable`; it returns `normalization_status=failed` or `pending`.

- [ ] **Step 4: Update routing documentation to reference the contract**

`QUICK_CAPTURE.md` and the current section of `journal/README.md` must point to the JSON contract, require Agent-generated structured output, state that Supabase is the only active source, and remove active instructions that call `journal_manager.py add`.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `python3 -m unittest tools.test_life_console_cloud tools.test_journal_normalization_contract -v`

Expected: all tests pass.

- [ ] **Step 6: Commit the Agent slice**

Run privacy and diff checks, then commit only the Agent client, tests, and routing docs.

---

### Task 4: Synthetic Vercel DeepSeek fallback

**Files:**
- Create: `apps/life-console/src/server/deepseek-normalizer.ts`
- Create: `apps/life-console/src/server/journal-normalization-service.ts`
- Create: `apps/life-console/api/journal-normalize.ts`
- Create: `apps/life-console/tests/server/deepseek-normalizer.test.ts`
- Create: `apps/life-console/tests/server/journal-normalization-service.test.ts`
- Modify: `apps/life-console/tsconfig.node.json`
- Modify: `apps/life-console/scripts/supabase-candidate-config.mjs`
- Modify: `apps/life-console/tests/vercel/supabase-candidate-config.test.ts`

**Interfaces:**
- `requestDeepSeekNormalization(input, dependencies)` sends one allowlisted request and returns validated `JournalNormalization`.
- `normalizeJournalRequest(request, environment, dependencies)` returns a Web `Response` with only status and generic error code.
- Vercel route accepts `{journal_id:number, source_revision:number, task_key:string}` and bearer authentication.

- [ ] **Step 1: Write failing provider tests**

Assert exact HTTPS endpoint, `deepseek-v4-flash`, disabled thinking, JSON Object response, non-streaming request, no automatic pro fallback, one retry for empty/invalid content, and fail-closed endpoint override.

- [ ] **Step 2: Run provider tests and verify RED**

Run: `cd apps/life-console && npx vitest run tests/server/deepseek-normalizer.test.ts`

Expected: FAIL because the provider module does not exist.

- [ ] **Step 3: Implement the provider boundary**

Use injected `fetch` in tests and `DEEPSEEK_API_KEY` only on the server. Do not log request, response, authorization, raw text, context, or key. Validate model output with Task 1 before returning.

- [ ] **Step 4: Write failing route/service tests**

Cover missing bearer, malformed body, owner-scoped read, minimal context projection, source revision conflict, completion, generic provider failure, and response-body redaction.

- [ ] **Step 5: Run service tests and verify RED**

Run: `cd apps/life-console && npx vitest run tests/server/journal-normalization-service.test.ts`

Expected: FAIL because the service and route do not exist.

- [ ] **Step 6: Implement service, route, and Vercel config constraints**

Use the user's Supabase JWT and publishable key; do not introduce service-role. Preview/Production config must reject `VITE_DEEPSEEK_API_KEY`, permit only server `DEEPSEEK_API_KEY`, and keep it absent from generated JSON and CSP.

- [ ] **Step 7: Run server and config tests and verify GREEN**

Run: `cd apps/life-console && npx vitest run tests/server tests/vercel/supabase-candidate-config.test.ts`

Expected: all tests pass with injected synthetic provider responses and no network.

- [ ] **Step 8: Commit the synthetic server slice**

Run privacy and diff checks, then commit without any `.env`, Vercel binding, token, project identifier, or API response fixture from a real provider.

---

### Task 5: One structured renderer and asynchronous UI flow

**Files:**
- Create: `apps/life-console/src/features/journals/JournalStructuredView.tsx`
- Create: `apps/life-console/tests/ui/journal-structured-view.test.tsx`
- Modify: `apps/life-console/src/features/records/RecordsPage.tsx`
- Modify: `apps/life-console/src/features/journals/SupabaseJournalsPanel.tsx`
- Modify: `apps/life-console/src/supabase/dashboard.ts`
- Modify: `apps/life-console/tests/ui/supabase-candidate-app.test.tsx`
- Modify: `apps/life-console/tests/ui/supabase-journals-panel.test.tsx`

**Interfaces:**
- `JournalStructuredView({journal})` is the only renderer for raw text plus normalized metadata.
- UI creation receipt distinguishes `saved/pending`, `completed`, and `failed`; normalization failure never says the journal save failed.
- Non-Agent create invokes `/api/journal-normalize` only after raw creation succeeds.

- [ ] **Step 1: Write failing renderer tests**

Assert fixed section order, raw text preservation, all empty fields shown as “未记录”, confirmed-profile basis disclosure, pending/failed/stale states, and legacy compatibility.

- [ ] **Step 2: Run renderer tests and verify RED**

Run: `cd apps/life-console && npx vitest run tests/ui/journal-structured-view.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the shared renderer**

Render one card structure: date/title metadata, 用户原话, 助手整理, and status/action. Never parse stored Markdown to reconstruct fields.

- [ ] **Step 4: Write failing flow tests**

Use deferred promises to prove raw create completes before normalization starts; provider failure leaves the draft cleared only after raw save, refresh shows the saved pending card, and retry cannot duplicate the journal.

- [ ] **Step 5: Run flow tests and verify RED**

Run: `cd apps/life-console && npx vitest run tests/ui/supabase-candidate-app.test.tsx tests/ui/supabase-journals-panel.test.tsx`

Expected: FAIL because current UI saves only the basic journal and renders raw content without the unified view.

- [ ] **Step 6: Implement asynchronous create and list rendering**

Preserve existing idempotency draft behavior. After `createRaw` returns, trigger normalization with journal ID/source revision; refresh the dashboard on completion or failure. Disable duplicate normalize actions while the same task is pending.

- [ ] **Step 7: Run UI tests and build**

Run:

```bash
cd apps/life-console
npx vitest run tests/ui/journal-structured-view.test.tsx tests/ui/supabase-candidate-app.test.tsx tests/ui/supabase-journals-panel.test.tsx
npm run build:supabase-candidate
```

Expected: tests and build pass; only the existing chunk-size warning may remain.

- [ ] **Step 8: Commit the UI slice**

Run diff and privacy checks, then commit the renderer and flow changes.

---

### Task 6: Contract enforcement, full verification, and Gate 2 evidence

**Files:**
- Modify: `tools/validate_project.py`
- Modify: `tools/test_validate_project.py`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.4.0/工程评审与验收-生活助手-LifeConsole-2.4.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.4.0/技术方案-生活助手-LifeConsole-2.4.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.4.0/项目管理-生活助手-LifeConsole-2.4.0.md`
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.4.0/README.md`

**Interfaces:**
- Project validation proves there is one contract artifact, all routing files reference it, no second Prompt is active, and legacy first-sentence normalization is absent from active cloud paths.

- [ ] **Step 1: Write failing validator tests**

Create temporary project fixtures where the contract is missing, a second Prompt is introduced, an active route omits the contract version, or a forbidden browser key name appears. Assert each fixture fails with a precise structural error.

- [ ] **Step 2: Run validator tests and verify RED**

Run: `python3 -m unittest tools.test_validate_project -v`

Expected: new tests fail because the validator does not enforce 2.4.0 constraints.

- [ ] **Step 3: Implement validator rules**

Validate by parsing the JSON contract and active route configuration; do not merely grep human documentation. Keep the legacy local semantic modules allowed only when they import or load the one contract.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
git diff --check
tools/check_git_privacy.sh
python3 tools/check_project_governance.py
python3 -m unittest discover -s tools -p 'test_*.py'
cd apps/life-console && npm test
cd apps/life-console && npm run build
cd apps/life-console && npm run build:supabase-candidate
```

Expected: all applicable checks pass. If `validate_project.py` still cannot run in the isolated worktree because private iCloud files are deliberately absent, record the exact missing-private-file limitation and also run it from the complete root checkout without claiming that root validation covers branch-only files.

- [ ] **Step 5: Update Gate 2 evidence and commit**

Record only synthetic counts, commands, pass/fail state, current limitations, and the fact that no real provider/network/deployment occurred. Commit the verifier and evidence update, push PR #54, and wait for CI without making the PR Ready.

---

### Task 7: Production 正式上线收口

**范围：** 仅使用 Keychain Owner 会话做纯合成健康探针，并完成此前授权的唯一 failed journal；不读取其他日记、不发送人物投影、不输出凭据。

- [x] 增加固定健康原因码与最小结构化日志；日志仅含 route、reason、HTTP 状态、耗时和 Vercel request ID。
- [x] 将 DeepSeek 的认证/计费、限流、超时、上游 5xx、请求拒绝、无效 JSON、契约拒绝与未知不可用分层，并保持一次有限重试。
- [x] 从唯一契约 JSON 自动注入精确 Schema，Prompt 版本升级为 `journal-normalization-prompt/1.0.1`，不维护第二份格式。
- [x] Production 纯合成已登录探针通过：`HTTP 200 / provider_ok / no-store`。
- [x] 只读确认 failed job 恰好为 1，活动人物投影为 0；Agent 结果先经统一契约本地校验。
- [x] 修复跨 processor 并发状态：Prompt 升级可原地重开一次 completed Agent job，失败 provider 不得覆盖同 source revision 的 completed 结果；PGlite 回归 8/8 通过。
- [x] Supabase migration `20260816220627_preserve_completed_journal_normalization` 已应用并读回；RPC 为 SECURITY INVOKER，anon 不可执行，authenticated 可执行。
- [x] 唯一授权日记已由 Agent 原子完成；metadata 契约有效，processor 为 Agent，原文 revision 与 SHA-256 均未变化，job 集合未扩张，其他日记未触发；DeepSeek 兜底未调用。
- [x] 统一渲染组件精确回归 5/5 通过。
- [x] 合并前独立审查修复：Production 浏览器不再自动触发 DeepSeek；人物投影仅保留原文明示匹配项；同 task processing 拒绝重复执行；completed 幂等返回；Agent 结果不被晚到 provider 覆盖；RPC 锁顺序统一为 job → journal。
- [x] Agent 现有记录原子工具先按精确 ID 读取 Owner-scoped 原文并核对 revision，再校验与完成；调用方文本不再作为唯一依据。
- [x] 更新 PR #54 说明，复核 `origin/main...HEAD` 安全/并发/隐私修复并等待最终 CI；独立复审无阻断，privacy/python/node 全绿。
- [x] 将 PR #54 转 Ready、squash merge；main Production `READY / PROMOTED`，合并后合成探针与单条只读核对均通过。
- [x] 从最新 main 创建独立 release-evidence 分支并记录去敏证据。

发布证据 PR #55 的合并与随后两个已完成 worktree/branch 的清理属于本文件合并后的操作，不在合并前勾选或自证完成；最终以 GitHub PR 和 `git worktree` 的实际状态验收。

## Self-review

- Spec coverage: Tasks 1–6 cover the single contract, raw-first persistence, Agent processor, DeepSeek fallback, evidence validation, personal-context projection, unified UI, legacy behavior, privacy, and tests.
- Placeholder scan: no implementation step depends on an undefined decision or omitted interface.
- Type consistency: `JournalNormalization`, `normalization_status`, source revision, task key, and RPC names are defined once and reused by later tasks.
- Authorization coverage: no task creates credentials, calls the real provider, reads real data, deploys, merges, deletes, or bulk normalizes history.
