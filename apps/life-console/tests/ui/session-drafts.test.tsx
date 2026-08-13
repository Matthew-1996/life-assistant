// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  useHasActiveSessionDrafts,
  useSessionDraft,
} from "../../src/hooks/useSessionDraft";
import {
  clearAllSessionDrafts,
  hasActiveSessionDrafts,
  SESSION_DRAFT_STORAGE_PREFIX,
} from "../../src/lib/draft-storage";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

const storageKey = `${SESSION_DRAFT_STORAGE_PREFIX}synthetic-owner:test`;

function Harness() {
  const draft = useSessionDraft(storageKey, "", (value) => value === "");
  const active = useHasActiveSessionDrafts();
  return (
    <>
      <label>Draft<input onChange={(event) => draft.setValue(event.target.value)} value={draft.value} /></label>
      <output>{active ? "active" : "empty"}</output>
      <button onClick={draft.clear} type="button">save</button>
    </>
  );
}

function OtherScopeHarness() {
  const draft = useSessionDraft(
    `${SESSION_DRAFT_STORAGE_PREFIX}synthetic-other:test`,
    "",
    (value) => value === "",
  );
  const active = useHasActiveSessionDrafts("synthetic-other");
  return (
    <>
      <label>Other<input onChange={(event) => draft.setValue(event.target.value)} value={draft.value} /></label>
      <output>{active ? "other-active" : "other-empty"}</output>
    </>
  );
}

beforeEach(() => {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStorage() });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: memoryStorage() });
});

afterEach(() => {
  cleanup();
  clearAllSessionDrafts();
});

describe("current browser session drafts", () => {
  it("encrypts, reports activity, restores after remount, and clears after save", async () => {
    const user = userEvent.setup();
    const first = render(<Harness />);
    await user.type(screen.getByLabelText("Draft"), "Synthetic draft");
    expect(screen.getByText("active")).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem(storageKey)).toBeTruthy());
    expect(localStorage.getItem(storageKey)).not.toContain("Synthetic draft");

    first.unmount();
    render(<Harness />);
    expect(await screen.findByDisplayValue("Synthetic draft")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "save" }));
    expect(screen.getByText("empty")).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem(storageKey)).toBeNull());
    expect(hasActiveSessionDrafts()).toBe(false);
  });

  it("clears all indexed drafts for an explicit sign-out discard", async () => {
    const user = userEvent.setup();
    const view = render(<Harness />);
    await user.type(screen.getByLabelText("Draft"), "Synthetic draft");
    expect(hasActiveSessionDrafts()).toBe(true);
    clearAllSessionDrafts();
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hasActiveSessionDrafts()).toBe(false);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("isolates activity and clear-all by the current user scope", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    render(<OtherScopeHarness />);
    await user.type(screen.getByLabelText("Draft"), "Owner A draft");
    await user.type(screen.getByLabelText("Other"), "Owner B draft");

    expect(hasActiveSessionDrafts("synthetic-owner")).toBe(true);
    expect(hasActiveSessionDrafts("synthetic-other")).toBe(true);
    clearAllSessionDrafts("synthetic-owner");
    expect(hasActiveSessionDrafts("synthetic-owner")).toBe(false);
    expect(hasActiveSessionDrafts("synthetic-other")).toBe(true);
    expect(
      localStorage.getItem(
        `${SESSION_DRAFT_STORAGE_PREFIX}synthetic-other:test`,
      ),
    ).toBeTruthy();
  });
});
