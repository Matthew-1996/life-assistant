// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SupabaseGoalsPanel } from "../../src/features/goals/SupabaseGoalsPanel";
import type {
  Goal,
  GoalRepositoryPort,
} from "../../src/supabase/goals";
import { RepositoryError } from "../../src/supabase/repository";

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

  it("creates a goal once and clears the input after success", async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    const createIdempotencyKey = vi.fn(
      () => "synthetic-goal-key-0001",
    );
    render(
      <SupabaseGoalsPanel
        createIdempotencyKey={createIdempotencyKey}
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

  it("archives a goal only after an explicit action", async () => {
    const user = userEvent.setup();
    const repository = createRepository([syntheticGoal]);
    render(
      <SupabaseGoalsPanel
        now={() => "2030-03-01T10:00:00.000Z"}
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
  });
});
