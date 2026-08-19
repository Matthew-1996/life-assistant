// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseJournalsPanel } from "../../src/features/journals/SupabaseJournalsPanel";
import type { Journal, JournalRepositoryPort } from "../../src/supabase/journals";
import { RepositoryError } from "../../src/supabase/repository";

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

beforeEach(() => {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStorage() });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: memoryStorage() });
});

afterEach(cleanup);

const activeJournal: Journal = {
  id: 31,
  user_id: "synthetic-owner",
  event_date: "2030-03-01",
  title: "Synthetic Journal",
  content: "Synthetic user words",
  tags: ["reflection"],
  revision: 4,
  deleted_at: null,
  created_at: "2030-03-01T08:00:00.000Z",
  updated_at: "2030-03-01T08:00:00.000Z",
  normalization_status: "completed",
  metadata: {
    title: "Synthetic Journal",
    summary: "Synthetic assistant summary",
    facts: [], feelings: [], people: [], places: [], themes: [],
    planning_clues: [], inferences: [], tags: ["reflection"],
  },
};

function repository(): JournalRepositoryPort {
  let active = [activeJournal];
  let deleted: Journal[] = [];
  return {
    list: vi.fn(async () => ({ items: active, nextCursor: null })),
    listDeleted: vi.fn(async () => ({ items: deleted, nextCursor: null })),
    get: vi.fn(async () => active[0] ?? null),
    revisions: vi.fn(async () => []),
    create: vi.fn(async () => activeJournal),
    update: vi.fn(async () => activeJournal),
    softDelete: vi.fn(async (id, revision) => {
      const removed = { ...activeJournal, id, revision: revision + 1, deleted_at: "2030-03-01T09:00:00.000Z" };
      active = active.filter((item) => item.id !== id);
      deleted = [removed];
      return removed;
    }),
    restore: vi.fn(async (id, revision) => {
      const restored = { ...activeJournal, id, revision: revision + 1 };
      deleted = deleted.filter((item) => item.id !== id);
      active = [restored];
      return restored;
    }),
  };
}

describe("Journal soft delete and restore", () => {
  it("keeps assistant organization and revisions collapsed by default", async () => {
    const repo = repository();
    render(<SupabaseJournalsPanel repository={repo} showCreate={false} />);

    const card = await screen.findByRole("article", { name: "Synthetic Journal" });
    expect(within(card).getByText("Synthetic user words")).toBeTruthy();
    expect(screen.queryByText("Synthetic assistant summary")).toBeNull();
    expect(within(card).getByText("展开助手整理")).toBeTruthy();
    expect(within(card).getByText("修订历史")).toBeTruthy();
  });

  it("requires confirmation, soft deletes with revision, then restores", async () => {
    const user = userEvent.setup();
    const repo = repository();
    render(<SupabaseJournalsPanel repository={repo} showCreate={false} />);
    await screen.findByText("Synthetic Journal");

    await user.click(screen.getByRole("button", { name: "删除日记" }));
    const dialog = screen.getByRole("dialog", { name: "移到已删除" });
    expect(repo.softDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "确认移到已删除" }));
    await waitFor(() => expect(repo.softDelete).toHaveBeenCalledWith(31, 4));
    expect(await screen.findByText("日记已移到已删除，可随时恢复。")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /查看已删除/ }));
    await user.click(await screen.findByRole("button", { name: "恢复日记" }));
    await waitFor(() => expect(repo.restore).toHaveBeenCalledWith(31, 5));
    expect(await screen.findByText("日记已恢复。")).toBeTruthy();
  });

  it("keeps the confirmation dialog open on a revision conflict", async () => {
    const user = userEvent.setup();
    const repo = repository();
    vi.mocked(repo.softDelete).mockRejectedValueOnce(new RepositoryError(
      "conflict", 409, "revision_conflict", "synthetic conflict",
    ));
    render(<SupabaseJournalsPanel repository={repo} showCreate={false} />);
    await screen.findByText("Synthetic Journal");

    await user.click(screen.getByRole("button", { name: "删除日记" }));
    await user.click(screen.getByRole("button", { name: "确认移到已删除" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("日记已在其他位置更新"),
    );
    expect(screen.getByRole("dialog", { name: "移到已删除" })).toBeTruthy();
  });
});
