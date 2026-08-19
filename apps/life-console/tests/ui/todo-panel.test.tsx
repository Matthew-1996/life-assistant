// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TodoItem, TodoRepositoryPort } from "../../src/domain/todos";
import { TodoPanel } from "../../src/features/todos/TodoPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const now = new Date("2030-01-08T09:00:00+08:00");

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 1,
    user_id: "synthetic-owner",
    title: "合成验收任务",
    priority: "P1",
    status: "not_started",
    planned_start_at: "2030-01-08T01:00:00.000Z",
    due_at: "2030-01-09T01:00:00.000Z",
    actual_started_at: null,
    completed_at: null,
    revision: 1,
    created_at: "2030-01-08T01:00:00.000Z",
    updated_at: "2030-01-08T01:00:00.000Z",
    ...overrides,
  };
}

function repository(items: TodoItem[] = []): TodoRepositoryPort & {
  create: ReturnType<typeof vi.fn>;
  transition: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} {
  return {
    listToday: vi.fn(async () => items),
    listAll: vi.fn(async () => items),
    listStatusEvents: vi.fn(async () => []),
    create: vi.fn(async (input) => todo({
      id: 9,
      title: input.title,
      priority: input.priority ?? "P1",
      planned_start_at: input.plannedStartAt ?? now.toISOString(),
      due_at: input.dueAt,
    })),
    update: vi.fn(async (input) => todo({
      id: input.id,
      title: input.title,
      priority: input.priority,
      planned_start_at: input.plannedStartAt,
      due_at: input.dueAt,
      revision: input.expectedRevision + 1,
    })),
    transition: vi.fn(async (input) => todo({
      id: input.id,
      status: input.status,
      revision: input.expectedRevision + 1,
    })),
  };
}

describe("Life Console 2.5 Todo panel", () => {
  it("creates a P1 Todo once and disables duplicate submission", async () => {
    const user = userEvent.setup();
    const repo = repository();
    let finishCreate: ((value: TodoItem) => void) | undefined;
    repo.create.mockImplementationOnce(() => new Promise((resolve) => {
      finishCreate = resolve;
    }));
    render(<TodoPanel now={now} repository={repo} />);

    await user.type(screen.getByLabelText("Todo 项目"), "合成验收任务");
    await user.type(screen.getByLabelText("Todo DDL"), "2030-01-09T10:00");
    const submit = screen.getByRole("button", { name: "新建 Todo" });
    await user.click(submit);

    expect(repo.create).toHaveBeenCalledTimes(1);
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(repo.create.mock.calls[0][0]).toMatchObject({
      priority: "P1",
      title: "合成验收任务",
    });
    finishCreate?.(todo({ id: 9 }));
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  });

  it("validates that DDL follows planned start", async () => {
    const user = userEvent.setup();
    const repo = repository();
    render(<TodoPanel now={now} repository={repo} />);

    await user.type(screen.getByLabelText("Todo 项目"), "错误时间任务");
    await user.type(screen.getByLabelText("Todo DDL"), "2030-01-08T08:00");
    await user.click(screen.getByRole("button", { name: "新建 Todo" }));

    expect((await screen.findByRole("alert")).textContent).toContain("DDL 必须晚于计划开始时间");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("shows derived overdue state and transitions status", async () => {
    const user = userEvent.setup();
    const repo = repository([
      todo({ due_at: "2030-01-07T01:00:00.000Z", title: "已逾期任务" }),
    ]);
    render(<TodoPanel now={now} repository={repo} />);

    const row = await screen.findByRole("article", { name: "Todo 01 已逾期任务" });
    expect(within(row).getByText("已逾期")).toBeTruthy();
    await user.selectOptions(
      within(row).getByRole("combobox", { name: "已逾期任务状态" }),
      "in_progress",
    );

    await waitFor(() => expect(repo.transition).toHaveBeenCalledWith({
      expectedRevision: 1,
      id: 1,
      status: "in_progress",
    }));
  });

  it("renders exactly fourteen natural-day columns inside the Gantt region", async () => {
    const repo = repository([todo()]);
    render(<TodoPanel now={now} repository={repo} />);

    const gantt = await screen.findByRole("region", { name: "Todo 14 天甘特" });
    expect(within(gantt).getAllByRole("columnheader")).toHaveLength(14);
    expect(within(gantt).getByText("01/08")).toBeTruthy();
    expect(within(gantt).getByText("01/21")).toBeTruthy();
  });
});
