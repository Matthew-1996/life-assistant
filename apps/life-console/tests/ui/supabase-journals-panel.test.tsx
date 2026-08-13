// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseJournalsPanel } from "../../src/features/journals/SupabaseJournalsPanel";
import { SESSION_DRAFT_STORAGE_PREFIX } from "../../src/lib/draft-storage";
import type {
  Journal,
  JournalRepositoryPort,
  JournalRevision,
} from "../../src/supabase/journals";
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
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memoryStorage(),
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: memoryStorage(),
  });
});

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
  it("locks create fields while their write is pending", async () => {
    const user = userEvent.setup();
    let release: ((journal: Journal) => void) | undefined;
    const repository = createRepository();
    repository.create = vi.fn(() => new Promise<Journal>((resolve) => {
      release = resolve;
    }));
    render(<SupabaseJournalsPanel repository={repository} />);
    await screen.findByText("还没有日记");
    await user.type(screen.getByLabelText("新日记日期"), "2030-03-01");
    const content = screen.getByLabelText("新日记正文");
    await user.type(content, "Pending journal");
    await user.click(screen.getByRole("button", { name: "新建日记" }));
    expect((content as HTMLTextAreaElement).disabled).toBe(true);
    release?.({ ...syntheticJournal, content: "Pending journal" });
    expect(await screen.findByText("日记已保存。")).toBeTruthy();
  });

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
    expect((screen.getByRole("button", {
      name: "新建日记",
    }) as HTMLButtonElement).disabled).toBe(true);
    resolveList?.({ items: [], nextCursor: null });
    expect(await screen.findByText("还没有日记")).toBeTruthy();
    expect(screen.queryByText("Synthetic Journal")).toBeNull();
  });

  it("reloads when the parent dashboard journal revision changes", async () => {
    const repository = createRepository();
    const { rerender } = render(
      <SupabaseJournalsPanel
        reloadToken="journal-revision-1"
        repository={repository}
      />,
    );
    await screen.findByText("还没有日记");
    expect(repository.list).toHaveBeenCalledOnce();

    repository.list = vi.fn(async () => ({
      items: [syntheticJournal],
      nextCursor: null,
    }));
    rerender(
      <SupabaseJournalsPanel
        reloadToken="journal-revision-2"
        repository={repository}
      />,
    );

    expect(await screen.findByText("Synthetic Journal")).toBeTruthy();
    expect(repository.list).toHaveBeenCalledOnce();
  });

  it("keeps the cursor, loads more, and filters loaded journals by date", async () => {
    const user = userEvent.setup();
    const cursor = { sortValue: "2030-03-01", id: 31 };
    const olderJournal = {
      ...syntheticJournal,
      id: 30,
      event_date: "2030-02-28",
      title: "Older Journal",
    };
    const repository = createRepository();
    repository.list = vi.fn()
      .mockResolvedValueOnce({
        items: [syntheticJournal],
        nextCursor: cursor,
      })
      .mockResolvedValueOnce({
        items: [olderJournal],
        nextCursor: null,
      });

    render(<SupabaseJournalsPanel repository={repository} />);
    await screen.findByText("Synthetic Journal");
    await user.type(screen.getByLabelText("筛选日记日期"), "2030-02-28");
    expect(screen.getByText(
      "当前已加载记录中没有该日期的日记",
    )).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "加载更多日记" }));
    expect(await screen.findByText("Older Journal")).toBeTruthy();
    expect(repository.list).toHaveBeenNthCalledWith(1, { pageSize: 20 });
    expect(repository.list).toHaveBeenNthCalledWith(2, {
      pageSize: 20,
      cursor,
    });
    expect(screen.queryByRole("button", { name: "加载更多日记" })).toBeNull();
  });

  it("creates a journal and clears inputs only after success", async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    const onSaved = vi.fn(async () => true);
    const createIdempotencyKey = vi.fn(
      () => "synthetic-journal-key-0001",
    );
    render(
      <SupabaseJournalsPanel
        createIdempotencyKey={createIdempotencyKey}
        onSaved={onSaved}
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
    expect(onSaved).toHaveBeenCalledOnce();
    expect(localStorage.getItem(
      `${SESSION_DRAFT_STORAGE_PREFIX}anonymous:journals`,
    )).toBeNull();
  });

  it("does not duplicate a journal returned by an idempotent create replay", async () => {
    const user = userEvent.setup();
    const repository = createRepository([syntheticJournal]);
    render(<SupabaseJournalsPanel repository={repository} />);
    await screen.findByText("Synthetic Journal");
    await user.type(screen.getByLabelText("新日记日期"), "2030-03-02");
    await user.type(screen.getByLabelText("新日记标题"), "Replayed Journal");
    await user.type(screen.getByLabelText("新日记正文"), "Replayed content");
    await user.click(screen.getByRole("button", { name: "新建日记" }));
    expect(await screen.findByText("Replayed Journal")).toBeTruthy();
    expect(screen.queryByText("Synthetic Journal")).toBeNull();
  });

  it("refreshes the product dashboard after a journal revision succeeds", async () => {
    const user = userEvent.setup();
    const repository = createRepository([syntheticJournal]);
    const onSaved = vi.fn(async () => true);
    render(
      <SupabaseJournalsPanel
        onSaved={onSaved}
        repository={repository}
      />,
    );
    await screen.findByText("Synthetic Journal");

    await user.click(
      screen.getByRole("button", { name: "编辑 Synthetic Journal" }),
    );
    const content = screen.getByLabelText("编辑日记正文");
    await user.clear(content);
    await user.type(content, "Updated synthetic content");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(repository.update).toHaveBeenCalledOnce());
    expect(onSaved).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain(
      "日记修改已保存",
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
    expect((screen.getByLabelText("新日记正文") as HTMLTextAreaElement).disabled)
      .toBe(true);
  });

  it("loads the latest journal revision before retrying a conflict", async () => {
    const user = userEvent.setup();
    const latestJournal = {
      ...syntheticJournal,
      content: "Latest content from server",
      revision: 2,
    };
    const repository = createRepository([syntheticJournal]);
    let latestLoaded = false;
    repository.get = vi.fn(async () => {
      latestLoaded = true;
      return latestJournal;
    });
    repository.list = vi.fn(async () => ({
      items: [latestLoaded ? latestJournal : syntheticJournal],
      nextCursor: null,
    }));
    repository.update = vi.fn()
      .mockRejectedValueOnce(new RepositoryError(
        "conflict",
        409,
        "revision_conflict",
        "synthetic conflict",
      ))
      .mockImplementationOnce(async (id, revision, input) => ({
        ...latestJournal,
        id,
        revision: revision + 1,
        content: input.content ?? latestJournal.content,
      }));

    const view = render(<SupabaseJournalsPanel repository={repository} />);
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
    await user.click(
      screen.getByRole("button", { name: "载入最新日记" }),
    );
    await screen.findByText(
      "已载入最新日记；冲突前草稿仍保留在下方，可比较后再决定。",
    );

    const latestContent = screen.getByLabelText("编辑日记正文");
    expect((latestContent as HTMLTextAreaElement).value).toBe(
      "Conflicting synthetic draft",
    );
    expect((screen.getByLabelText(
      "服务器最新正文",
    ) as HTMLTextAreaElement).value).toBe("Latest content from server");
    expect((screen.getByLabelText(
      "冲突前正文草稿",
    ) as HTMLTextAreaElement).value).toBe("Conflicting synthetic draft");
    await waitFor(() => expect(localStorage.length).toBeGreaterThan(0));
    view.unmount();
    render(<SupabaseJournalsPanel repository={repository} />);
    const restoredContent = await screen.findByLabelText("编辑日记正文");
    expect((restoredContent as HTMLTextAreaElement).value).toBe(
      "Conflicting synthetic draft",
    );
    expect((screen.getByLabelText(
      "服务器最新正文",
    ) as HTMLTextAreaElement).value).toBe("Latest content from server");
    await user.click(
      screen.getByRole("button", { name: "恢复冲突前草稿" }),
    );
    expect((restoredContent as HTMLTextAreaElement).value).toBe(
      "Conflicting synthetic draft",
    );
    await user.clear(restoredContent);
    await user.type(restoredContent, "Resolved journal content");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(repository.update).toHaveBeenNthCalledWith(
      2,
      31,
      2,
      expect.objectContaining({ content: "Resolved journal content" }),
    ));
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

  it("restores a failed create key through a hidden remount", async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    repository.create = vi.fn(async () => {
      throw new RepositoryError(
        "transient",
        503,
        "PGRST000",
        "synthetic unavailable",
      );
    });
    const createIdempotencyKey = vi.fn(
      () => "synthetic-journal-key-remount",
    );
    const first = render(
      <SupabaseJournalsPanel
        createIdempotencyKey={createIdempotencyKey}
        draftScope="synthetic-owner"
        repository={repository}
      />,
    );
    await screen.findByText("还没有日记");
    await user.type(screen.getByLabelText("新日记日期"), "2030-03-01");
    await user.type(
      screen.getByLabelText("新日记正文"),
      "Retry after hidden navigation",
    );
    await user.click(screen.getByRole("button", { name: "新建日记" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(localStorage.length).toBeGreaterThan(0));
    first.unmount();

    const hidden = render(
      <SupabaseJournalsPanel
        createIdempotencyKey={createIdempotencyKey}
        draftScope="synthetic-owner"
        repository={repository}
        showCreate={false}
      />,
    );
    await screen.findByText("日记管理与修订");
    hidden.rerender(
      <SupabaseJournalsPanel
        createIdempotencyKey={createIdempotencyKey}
        draftScope="synthetic-owner"
        repository={repository}
        showCreate
      />,
    );
    expect(await screen.findByDisplayValue(
      "Retry after hidden navigation",
    )).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "新建日记" }));

    await waitFor(() => expect(repository.create).toHaveBeenNthCalledWith(
      2,
      "synthetic-journal-key-remount",
      expect.any(Object),
    ));
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
