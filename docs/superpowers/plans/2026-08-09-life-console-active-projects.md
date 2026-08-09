# Life Console Active Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project confirmed auxiliary goals from `GOALS.md` into the localhost Life Console without hard-coding personal data into the application.

**Architecture:** Extend the whitelisted Dashboard contract with a bounded `active_projects` array. The Python read model parses only headings and approved metadata inside the `## 辅助目标` section, while the React Today page renders generic project cards from that projection. Tests use synthetic Markdown and synthetic fixture values only.

**Tech Stack:** Python standard library, OpenAPI YAML, generated TypeScript contracts, React 19, Vitest, unittest.

---

### Task 1: Define the active-project contract

**Files:**
- Modify: `apps/life-console/contracts/life-console.openapi.yaml`
- Modify: `apps/life-console/contracts/fixtures/dashboard.synthetic.json`
- Regenerate: `apps/life-console/src/contracts/life-console.ts`
- Test: `apps/life-console/tests/contract/openapi.test.ts`

- [ ] Add a failing contract assertion requiring `today.active_projects`.
- [ ] Run `npx vitest run tests/contract/openapi.test.ts` and verify it fails because the field is absent.
- [ ] Define a maximum of two projects with `title`, `status`, `period`, `summary`, and `plan_path`.
- [ ] Update the synthetic fixture and regenerate TypeScript contracts.
- [ ] Rerun the contract test and verify it passes.

### Task 2: Project auxiliary goals safely

**Files:**
- Modify: `apps/life-console/tests/hub/test_hub_read.py`
- Modify: `apps/life-console/hub/read_model/dashboard.py`

- [ ] Add a failing test with synthetic `GOALS.md` content containing one current focus, two auxiliary goals, and one candidate goal.
- [ ] Assert only the two auxiliary goals appear and candidate content is excluded.
- [ ] Run `python3 -m unittest -v tests.hub.test_hub_read.HubReadTests.test_dashboard_projects_only_confirmed_auxiliary_goals`.
- [ ] Implement a bounded parser that returns only approved metadata and fails closed on invalid plan paths.
- [ ] Rerun the focused Python test and the complete Hub read test module.

### Task 3: Render active projects

**Files:**
- Modify: `apps/life-console/tests/ui/app.test.tsx`
- Modify: `apps/life-console/src/features/today/TodayPage.tsx`
- Modify: `apps/life-console/src/styles.css`

- [ ] Add a failing UI test asserting the synthetic projects appear under “本周试行项目”.
- [ ] Run `npx vitest run tests/ui/app.test.tsx` and verify it fails because the section is absent.
- [ ] Render compact read-only cards with status, period, summary, and plan path.
- [ ] Add responsive styles without changing existing navigation or write flows.
- [ ] Rerun the focused UI test and full Vitest suite.

### Task 4: Validate and publish generic code

**Files:**
- Verify all modified files above.

- [ ] Run `npm run build`.
- [ ] Run `npx vitest run`.
- [ ] Run `npm run test:python`.
- [ ] Run `tools/check_git_privacy.sh`.
- [ ] Run `git diff --check`.
- [ ] Commit only generic code and synthetic tests on `agent/life-console-active-projects`.
- [ ] Push the branch, open a Draft PR, wait for checks, and merge only if the repository permits and checks pass.

Private instance data application is intentionally outside this Git plan. A local instance may use
the generic projection only after its owner has explicitly updated its private goal source; private
goal names, schedules, plan paths, and generated dashboard data must never be copied into this
repository.
