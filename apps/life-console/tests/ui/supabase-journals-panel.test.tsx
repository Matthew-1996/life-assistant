// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SupabaseJournalsPanel } from "../../src/features/journals/SupabaseJournalsPanel";
import type {
  Journal,
  JournalRepositoryPort,
  JournalRevision,
} from "../../src/supabase/journals";
import { RepositoryError } from "../../src/supabase/repository";

afterEach(() => {
  cleanup();
});

const syntheticJournal: Journal = {
  id: 31,
  user_id: "synthetic-owner",
  event_date: "2030-03-01",
  title: "Synthetic Journal",
  content: "Synthetic journal content",
  tags: ["reflection"],
  revision: 1,
  deleted_at: null,
  created_at: "2030-03-01T08:00:00.000Z",
  updated_at: "2030-03-01T08:00:00.000Z",
};

const syntheticRevision: JournalRevision = {
  id: 41,
  user_id: "synthetic-owner",
  journal_id: 31,
  revision: 1,
  snapshot: {
    event_date: "2030-03-01",
    title: "Synthetic Journal",
    content: "Synthetic journal content",
    tags: ["reflection"],
    deleted_at: null,
  },
  reason: "create",
  created_at: "2030-03-01T08:00:00.000Z",
};

function createRepository(
  journals: Journal[] = [],
): JournalRepositoryPort {
  return {
    list: vi.fn(async () => ({
      items: journals,
      nextCursor: null,
    })),
    get: vi.fn(async () => journals[0] ?? null),
    revisions: vi.fn(async () => [syntheticRevision]),
    create: vi.fn(async (_key, input) => ({
      ...syntheticJournal,
      event_date: input.date,
      title: input.title?.trim() || null,
      content: input.content,
      tags: input.tags ?? [],
    })),
    update: vi.fn(async (id, revision, input) => ({
      ...syntheticJournal,
      id,
      revision: revision + 1,
      event_date: input.date ?? syntheticJournal.event_date,
      title: input.title?.trim() || null,
      content: input.content ?? syntheticJournal.content,
      tags: input.tags ?? syntheticJournal.tags,
    })),
  };
}

describe("Supabase Journals panel", () => {
  it("shows loading before a genuine empty state", async () => {
    let resolveList:
      | ((page: { items: Journal[]; nextCursor: null }) => void)
      | undefined;
    const repository = createRepository();
    repository.list = vi.fn(
      () =>
        new Promise<{ items: Journal[]; nextCursor: null }>((resolve) => {
          resolveList = resolve;
        }),
    );

    render(<SupabaseJournalsPanel repository={repository} />);

    expect(screen.getByRole("status").textContent).toContain(
      "正在读取日记",
    );
    resolveList?.({ items: [], nextCursor: null });
    expect(await screen.findByText("还没有日记")).toBeTruthy();
    expect(screen.queryByText("Synthetic Journal")).toBeNull();
  });

  it("creates a journal and clears inputs only after success", async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    const createIdempotencyKey = vi.fn(
      () => "synthetic-journal-key-0001",
    );
    render(
      <SupabaseJournalsPanel
        createIdempotencyKey={createIdempotencyKey}
        repository={repository}
      />,
    );
    await screen.findByText("还没有日记");

    await user.type(
      screen.getByLabelText("新日记日期"),
      "2030-03-01",
    );
    await user.type(
      screen.getByLabelText("新日记标题"),
      "Synthetic Journal",
    );
    const content = screen.getByLabelText("新日记正文");
    await user.type(content, "Synthetic journal content");
    await user.type(
      screen.getByLabelText("新日记标签"),
      "reflection, test",
    );
    await user.click(screen.getByRole("button", { name: "新建日记" }));

    expect(repository.create).toHaveBeenCalledWith(
      "synthetic-journal-key-0001",
      {
        content: "Synthetic journal content",
        date: "2030-03-01",
        tags: ["reflection", "test"],
        title: "Synthetic Journal",
      },
    );
    expect(await screen.findByText("Synthetic Journal")).toBeTruthy();
    expect((content as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("status").textContent).toContain(
      "日记已保存",
    );
  });

  it("retains edited content when a revision conflict occurs", async () => {
    const user = userEvent.setup();
    const repository = createRepository([syntheticJournal]);
    repository.update = vi.fn(async () => {
      throw new RepositoryError(
        "conflict",
        409,
        "revision_conflict",
        "synthetic conflict",
      );
    });
    render(<SupabaseJournalsPanel repository={repository} />);
    await screen.findByText("Synthetic Journal");

    await user.click(
      screen.getByRole("button", { name: "编辑 Synthetic Journal" }),
    );
    const content = screen.getByLabelText("编辑日记正文");
    await user.clear(content);
    await user.type(content, "Conflicting synthetic draft");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect((content as HTMLTextAreaElement).value).toBe(
      "Conflicting synthetic draft",
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "记录已在其他页面更新",
    );
  });

  it("reuses one idempotency key for an explicit create retry", async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    repository.create = vi.fn()
      .mockRejectedValueOnce(
        new RepositoryError(
          "transient",
          503,
          "PGRST000",
          "synthetic unavailable",
        ),
      )
      .mockResolvedValueOnce(syntheticJournal);
    const createIdempotencyKey = vi.fn(
      () => "synthetic-journal-key-0002",
    );
    render(
      <SupabaseJournalsPanel
        createIdempotencyKey={createIdempotencyKey}
        repository={repository}
      />,
    );
    await screen.findByText("还没有日记");

    await user.type(
      screen.getByLabelText("新日记日期"),
      "2030-03-01",
    );
    await user.type(
      screen.getByLabelText("新日记正文"),
      "Synthetic journal content",
    );
    await user.click(screen.getByRole("button", { name: "新建日记" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("尚未保存"),
    );

    await user.click(screen.getByRole("button", { name: "新建日记" }));
    expect(await screen.findByText("Synthetic Journal")).toBeTruthy();
    expect(repository.create).toHaveBeenCalledTimes(2);
    expect(repository.create).toHaveBeenNthCalledWith(
      1,
      "synthetic-journal-key-0002",
      expect.any(Object),
    );
    expect(repository.create).toHaveBeenNthCalledWith(
      2,
      "synthetic-journal-key-0002",
      expect.any(Object),
    );
    expect(createIdempotencyKey).toHaveBeenCalledOnce();
  });

  it("loads revision metadata without rendering stored snapshot content", async () => {
    const user = userEvent.setup();
    const repository = createRepository([syntheticJournal]);
    render(<SupabaseJournalsPanel repository={repository} />);
    await screen.findByText("Synthetic Journal");

    await user.click(
      screen.getByRole("button", { name: "查看 Synthetic Journal 修订" }),
    );

    await waitFor(() => {
      expect(repository.revisions).toHaveBeenCalledWith(31);
    });
    expect(await screen.findByText("revision #1 · create")).toBeTruthy();
    expect(
      screen.queryByText("Synthetic journal content", {
        selector: ".supabase-journal-revisions *",
      }),
    ).toBeNull();
  });

  it("does not expose withdrawal, restore, or delete actions", async () => {
    const repository = createRepository([syntheticJournal]);
    render(<SupabaseJournalsPanel repository={repository} />);
    await screen.findByText("Synthetic Journal");

    expect(screen.queryByRole("button", { name: /撤回/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /恢复/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /删除/ })).toBeNull();
  });
});
