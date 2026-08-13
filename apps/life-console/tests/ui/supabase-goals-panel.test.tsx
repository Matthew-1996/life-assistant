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

import { SupabaseGoalsPanel } from "../../src/features/goals/SupabaseGoalsPanel";
import { SESSION_DRAFT_STORAGE_PREFIX } from "../../src/lib/draft-storage";
import type {
  Goal,
  GoalRepositoryPort,
} from "../../src/supabase/goals";
import {
  RepositoryError,
  type Cursor,
} from "../../src/supabase/repository";

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

const syntheticGoal: Goal = {
  id: 17,
  user_id: "synthetic-owner",
  title: "Synthetic Goal",
  domain: null,
  status: "active",
  priority: null,
  start_date: null,
  target_date: null,
  revision: 1,
  deleted_at: null,
  created_at: "2030-01-01T08:00:00.000Z",
  updated_at: "2030-01-01T08:00:00.000Z",
};

function createRepository(
  goals: Goal[] = [],
): GoalRepositoryPort {
  return {
    list: vi.fn(async () => ({
      items: goals,
      nextCursor: null,
    })),
    create: vi.fn(async (_key, input) => ({
      ...syntheticGoal,
      title: input.title.trim(),
    })),
    update: vi.fn(async (id, revision, input) => ({
      ...syntheticGoal,
      id,
      revision: revision + 1,
      title: input.title?.trim() ?? syntheticGoal.title,
    })),
    archive: vi.fn(async (
      id: number,
      revision: number,
      deletedAt?: string,
    ) => ({
      ...syntheticGoal,
      id,
      revision: revision + 1,
      status: "archived" as const,
      deleted_at: deletedAt ?? "2030-03-01T10:00:00.000Z",
    })),
    restore: vi.fn(async () => syntheticGoal),
  };
}

describe("Supabase Goals panel", () => {
  it("locks the create input while its write is pending", async () => {
    const user = userEvent.setup();
    let release: ((goal: Goal) => void) | undefined;
    const repository = createRepository();
    repository.create = vi.fn(() => new Promise<Goal>((resolve) => {
      release = resolve;
    }));
    render(<SupabaseGoalsPanel repository={repository} />);
    await screen.findByText("还没有目标");
    const input = screen.getByRole("textbox", { name: "目标名称" });
    await user.type(input, "Pending Goal");
    await user.click(screen.getByRole("button", { name: "新建目标" }));
    expect((input as HTMLInputElement).disabled).toBe(true);
    release?.({ ...syntheticGoal, title: "Pending Goal" });
    expect(await screen.findByText("Pending Goal")).toBeTruthy();
  });

  it("shows loading before a real empty state", async () => {
    let resolveList:
      | ((page: { items: Goal[]; nextCursor: null }) => void)
      | undefined;
    const repository = createRepository();
    repository.list = vi.fn(
      () =>
        new Promise<{ items: Goal[]; nextCursor: null }>((resolve) => {
          resolveList = resolve;
        }),
    );

    render(<SupabaseGoalsPanel repository={repository} />);

    expect(screen.getByRole("status").textContent).toContain(
      "正在读取目标",
    );
    expect((screen.getByRole("button", {
      name: "新建目标",
    }) as HTMLButtonElement).disabled).toBe(true);
    resolveList?.({ items: [], nextCursor: null });
    expect(await screen.findByText("还没有目标")).toBeTruthy();
    expect(screen.queryByText("Synthetic Goal")).toBeNull();
  });

  it("renders repository goals without exposing storage identifiers", async () => {
    const repository = createRepository([syntheticGoal]);
    render(<SupabaseGoalsPanel repository={repository} />);

    expect(await screen.findByText("Synthetic Goal")).toBeTruthy();
    expect(screen.queryByText("synthetic-owner")).toBeNull();
    expect(screen.queryByText("17")).toBeNull();
  });

  it("keeps the cursor, loads more, and filters only loaded goal statuses", async () => {
    const user = userEvent.setup();
    const cursor: Cursor = {
      sortValue: "2030-01-01T08:00:00.000Z",
      id: 17,
    };
    const draftGoal = {
      ...syntheticGoal,
      id: 20,
      title: "Draft Goal",
      status: "draft" as const,
    };
    const activeGoal = {
      ...syntheticGoal,
      id: 19,
      title: "Active Goal",
    };
    const completedGoal = {
      ...syntheticGoal,
      id: 18,
      title: "Completed Goal",
      status: "completed" as const,
    };
    const archivedGoal = {
      ...syntheticGoal,
      id: 17,
      title: "Archived Goal",
      status: "archived" as const,
    };
    const repository = createRepository();
    repository.list = vi.fn()
      .mockResolvedValueOnce({
        items: [draftGoal, activeGoal],
        nextCursor: cursor,
      })
      .mockResolvedValueOnce({
        items: [completedGoal, archivedGoal],
        nextCursor: null,
      });

    render(<SupabaseGoalsPanel repository={repository} />);
    await screen.findByText("Draft Goal");
    expect(screen.getByText(/筛选只作用于当前已加载的 2 项/)).toBeTruthy();

    await user.selectOptions(
      screen.getByLabelText("筛选目标状态"),
      "archived",
    );
    expect(screen.getByText(
      "当前已加载记录中没有该状态的目标",
    )).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "加载更多目标" }));
    expect(await screen.findByText("Archived Goal")).toBeTruthy();
    expect(repository.list).toHaveBeenNthCalledWith(1, { pageSize: 20 });
    expect(repository.list).toHaveBeenNthCalledWith(2, {
      pageSize: 20,
      cursor,
    });
    expect(screen.queryByRole("button", { name: "加载更多目标" })).toBeNull();

    await user.selectOptions(
      screen.getByLabelText("筛选目标状态"),
      "all",
    );
    for (const label of ["草稿", "进行中", "已完成", "已归档"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("creates a goal once and clears the input after success", async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    const onSaved = vi.fn(async () => true);
    const createIdempotencyKey = vi.fn(
      () => "synthetic-goal-key-0001",
    );
    render(
      <SupabaseGoalsPanel
        createIdempotencyKey={createIdempotencyKey}
        onSaved={onSaved}
        repository={repository}
      />,
    );
    await screen.findByText("还没有目标");

    const input = screen.getByRole("textbox", { name: "目标名称" });
    await user.type(input, "New Synthetic Goal");
    await user.click(screen.getByRole("button", { name: "新建目标" }));

    expect(repository.create).toHaveBeenCalledWith(
      "synthetic-goal-key-0001",
      {
        title: "New Synthetic Goal",
        status: "active",
      },
    );
    expect(await screen.findByText("New Synthetic Goal")).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("status").textContent).toContain(
      "目标已保存",
    );
    expect(onSaved).toHaveBeenCalledOnce();
    expect(localStorage.getItem(
      `${SESSION_DRAFT_STORAGE_PREFIX}anonymous:goals`,
    )).toBeNull();
  });

  it("does not duplicate a goal returned by an idempotent create replay", async () => {
    const user = userEvent.setup();
    const repository = createRepository([syntheticGoal]);
    render(<SupabaseGoalsPanel repository={repository} />);
    await screen.findByText("Synthetic Goal");
    await user.type(screen.getByRole("textbox", { name: "目标名称" }), "Replayed Goal");
    await user.click(screen.getByRole("button", { name: "新建目标" }));
    expect(await screen.findByText("Replayed Goal")).toBeTruthy();
    expect(screen.queryByText("Synthetic Goal")).toBeNull();
  });

  it("retains edited input when a revision conflict occurs", async () => {
    const user = userEvent.setup();
    const repository = createRepository([syntheticGoal]);
    repository.update = vi.fn(async () => {
      throw new RepositoryError(
        "conflict",
        409,
        "revision_conflict",
        "synthetic conflict",
      );
    });
    render(<SupabaseGoalsPanel repository={repository} />);
    await screen.findByText("Synthetic Goal");

    await user.click(
      screen.getByRole("button", { name: "编辑 Synthetic Goal" }),
    );
    const input = screen.getByRole("textbox", { name: "编辑目标名称" });
    await user.clear(input);
    await user.type(input, "Conflicting Draft");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect((input as HTMLInputElement).value).toBe("Conflicting Draft");
    expect(screen.getByRole("alert").textContent).toContain(
      "记录已在其他页面更新",
    );
    expect((screen.getByRole("textbox", {
      name: "目标名称",
    }) as HTMLInputElement).disabled).toBe(true);
  });

  it("loads the latest goal revision only after a conflict action", async () => {
    const user = userEvent.setup();
    const latestGoal = {
      ...syntheticGoal,
      title: "Latest Goal From Server",
      revision: 2,
    };
    const repository = createRepository([syntheticGoal]);
    let latestLoaded = false;
    repository.list = vi.fn(async (options) => {
      if (options?.pageSize === 100) latestLoaded = true;
      return {
        items: [latestLoaded ? latestGoal : syntheticGoal],
        nextCursor: null,
      };
    });
    repository.update = vi.fn()
      .mockRejectedValueOnce(new RepositoryError(
        "conflict",
        409,
        "revision_conflict",
        "synthetic conflict",
      ))
      .mockImplementationOnce(async (id, revision, input) => ({
        ...latestGoal,
        id,
        revision: revision + 1,
        title: input.title ?? latestGoal.title,
      }));

    const view = render(<SupabaseGoalsPanel repository={repository} />);
    await screen.findByText("Synthetic Goal");
    await user.click(
      screen.getByRole("button", { name: "编辑 Synthetic Goal" }),
    );
    const input = screen.getByRole("textbox", { name: "编辑目标名称" });
    await user.clear(input);
    await user.type(input, "Conflicting Draft");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect((input as HTMLInputElement).value).toBe("Conflicting Draft");
    await user.click(
      screen.getByRole("button", { name: "载入最新目标" }),
    );
    await screen.findByText(
      "已载入最新目标；冲突前草稿仍保留在下方，可比较后再决定。",
    );

    const latestInput = screen.getByRole("textbox", {
      name: "编辑目标名称",
    });
    expect((latestInput as HTMLInputElement).value).toBe("Conflicting Draft");
    expect((screen.getByRole("textbox", {
      name: "服务器最新目标",
    }) as HTMLInputElement).value).toBe("Latest Goal From Server");
    expect((screen.getByRole("textbox", {
      name: "冲突前草稿",
    }) as HTMLInputElement).value).toBe("Conflicting Draft");
    await waitFor(() => expect(localStorage.length).toBeGreaterThan(0));
    view.unmount();
    render(<SupabaseGoalsPanel repository={repository} />);
    const restoredInput = await screen.findByRole("textbox", {
      name: "编辑目标名称",
    });
    expect((restoredInput as HTMLInputElement).value).toBe("Conflicting Draft");
    expect((screen.getByRole("textbox", {
      name: "服务器最新目标",
    }) as HTMLInputElement).value).toBe("Latest Goal From Server");
    await user.click(
      screen.getByRole("button", { name: "恢复冲突前草稿" }),
    );
    expect((restoredInput as HTMLInputElement).value).toBe("Conflicting Draft");
    await user.clear(restoredInput);
    await user.type(restoredInput, "Resolved Goal");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(repository.update).toHaveBeenNthCalledWith(
      2,
      17,
      2,
      { title: "Resolved Goal" },
    ));
  });

  it("retains failed create input and allows an explicit retry", async () => {
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
      .mockResolvedValueOnce({
        ...syntheticGoal,
        title: "Retry Synthetic Goal",
      });
    const createIdempotencyKey = vi.fn(
      () => "synthetic-goal-key-0002",
    );
    render(
      <SupabaseGoalsPanel
        createIdempotencyKey={createIdempotencyKey}
        repository={repository}
      />,
    );
    await screen.findByText("还没有目标");

    const input = screen.getByRole("textbox", { name: "目标名称" });
    await user.type(input, "Retry Synthetic Goal");
    await user.click(screen.getByRole("button", { name: "新建目标" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("尚未保存"),
    );
    expect((input as HTMLInputElement).value).toBe(
      "Retry Synthetic Goal",
    );

    await user.click(screen.getByRole("button", { name: "新建目标" }));
    expect(await screen.findByText("Retry Synthetic Goal")).toBeTruthy();
    expect(repository.create).toHaveBeenCalledTimes(2);
    expect(repository.create).toHaveBeenNthCalledWith(
      1,
      "synthetic-goal-key-0002",
      expect.any(Object),
    );
    expect(repository.create).toHaveBeenNthCalledWith(
      2,
      "synthetic-goal-key-0002",
      expect.any(Object),
    );
    expect(createIdempotencyKey).toHaveBeenCalledOnce();
  });

  it("restores the create key after remount and reuses it for the same request", async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    repository.create = vi.fn(async () => {
      throw new RepositoryError(
        "transient", 503, "PGRST000", "synthetic unavailable",
      );
    });
    const createIdempotencyKey = vi.fn(
      () => "synthetic-goal-key-remount",
    );
    const first = render(
      <SupabaseGoalsPanel
        createIdempotencyKey={createIdempotencyKey}
        draftScope="synthetic-owner"
        repository={repository}
      />,
    );
    await screen.findByText("还没有目标");
    await user.type(
      screen.getByRole("textbox", { name: "目标名称" }),
      "Retry after navigation",
    );
    await user.click(screen.getByRole("button", { name: "新建目标" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(localStorage.length).toBeGreaterThan(0));
    first.unmount();

    render(
      <SupabaseGoalsPanel
        createIdempotencyKey={createIdempotencyKey}
        draftScope="synthetic-owner"
        repository={repository}
      />,
    );
    expect(await screen.findByDisplayValue("Retry after navigation")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "新建目标" }));
    expect(repository.create).toHaveBeenNthCalledWith(
      2,
      "synthetic-goal-key-remount",
      expect.any(Object),
    );
    expect(createIdempotencyKey).toHaveBeenCalledOnce();
  });

  it("archives a goal only after an explicit action", async () => {
    const user = userEvent.setup();
    const repository = createRepository([syntheticGoal]);
    const onSaved = vi.fn(async () => true);
    render(
      <SupabaseGoalsPanel
        now={() => "2030-03-01T10:00:00.000Z"}
        onSaved={onSaved}
        repository={repository}
      />,
    );
    await screen.findByText("Synthetic Goal");

    await user.click(
      screen.getByRole("button", { name: "归档 Synthetic Goal" }),
    );

    await waitFor(() => {
      expect(repository.archive).toHaveBeenCalledWith(
        17,
        1,
        "2030-03-01T10:00:00.000Z",
      );
    });
    expect(screen.queryByText("Synthetic Goal")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "目标已归档",
    );
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
