# Life Console Preview Layout Fixes Implementation Plan

> **For agentic workers:** Execute inline in the existing `agent/life-console-200-preview` worktree. Do not commit unless the user explicitly requests it.

**Goal:** Correct the recovery-pack acknowledgement alignment and prevent migration preflight text overlap without changing behavior or copy.

**Architecture:** Keep the existing React markup and add narrowly scoped CSS hooks. The recovery acknowledgement uses a compact inline checkbox rule; migration preflight rows use a dedicated class so shared `.day-row` layouts elsewhere are unaffected.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, browser preview.

---

### Task 1: Add layout-specific hooks and regression assertions

**Files:**
- Modify: `apps/life-console/src/features/system/SystemPage.tsx`
- Modify: `apps/life-console/tests/ui/sites-app.test.tsx`

- [ ] Add a `migration-check-row` class to preflight rows.
- [ ] Assert the recovery acknowledgement remains a `checkbox-row`.
- [ ] Assert every preflight item renders title, description, and status in a `migration-check-row`.
- [ ] Run `npx vitest run tests/ui/sites-app.test.tsx` and confirm the new class assertion fails before implementation.

### Task 2: Apply scoped layout rules

**Files:**
- Modify: `apps/life-console/src/styles.css`

- [ ] Override `.checkbox-row input[type="checkbox"]` to `16px × 16px`, zero padding, no flex growth, and inherited vertical alignment.
- [ ] Set `.checkbox-row` to inline flex with centered baseline, normal text sizing, and a compact gap.
- [ ] Set `.migration-check-row` to `minmax(0, 1fr) auto`.
- [ ] Keep title and status on the first row; place the description on a full-width second row so narrow preview panels cannot collapse it.
- [ ] Run focused tests, then the full Life Console test/build suite.

### Task 3: Rebuild and visually verify

**Files:**
- Generated only: `apps/life-console/dist/` (ignored)

- [ ] Run `npm run build:candidate-preview`.
- [ ] Refresh the local preview.
- [ ] Verify the checkbox is compact and inline with its label.
- [ ] Open the migration guide and verify all five preflight rows have separated title, description, and status columns.
