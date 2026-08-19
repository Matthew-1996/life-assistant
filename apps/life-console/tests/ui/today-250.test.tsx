// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/App";
import { syntheticDashboard } from "../../src/data/dashboard";
import type { TodoRepositoryPort } from "../../src/domain/todos";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const todos: TodoRepositoryPort = {
  listToday: vi.fn(async () => []),
  listAll: vi.fn(async () => []),
  listStatusEvents: vi.fn(async () => []),
  create: vi.fn(async (input) => ({
    id: 1,
    user_id: "synthetic-owner",
    title: input.title,
    priority: input.priority ?? "P1",
    status: "not_started" as const,
    planned_start_at: input.plannedStartAt ?? "2030-01-08T01:00:00.000Z",
    due_at: input.dueAt,
    actual_started_at: null,
    completed_at: null,
    revision: 1,
    created_at: "2030-01-08T01:00:00.000Z",
    updated_at: "2030-01-08T01:00:00.000Z",
  })),
  update: vi.fn(async () => { throw new Error("not used"); }),
  transition: vi.fn(async () => { throw new Error("not used"); }),
};

describe("Life Console 2.5 workbench", () => {
  it("contains only the approved four workbench regions", () => {
    const emptyDashboard = structuredClone(syntheticDashboard);
    emptyDashboard.today.anchors = {
      wake: null,
      body_light: null,
      life_action: null,
      wind_down: null,
    };
    render(<App initialDashboard={emptyDashboard} todos={todos} />);

    expect(screen.getByRole("region", { name: "本周寄语" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Todo" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "每日新闻" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "今日锚点" })).toBeTruthy();
    expect(screen.queryByText("隐私与保存链路")).toBeNull();
    expect(screen.queryByText("今天可以不做")).toBeNull();
    expect(screen.getByText("0 / 4 已填写")).toBeTruthy();
    expect(screen.getByRole("group", { name: "起床状态" })).toBeTruthy();
  });

  it("keeps unknown, complete, minimum and skipped as distinct editable states", async () => {
    const user = userEvent.setup();
    render(<App initialDashboard={syntheticDashboard} todos={todos} />);

    const wake = screen.getByRole("group", { name: "起床状态" });
    expect((within(wake).getByRole("button", { name: "未记录" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(wake).getByRole("button", { name: "完成" })).toBeTruthy();
    expect(within(wake).getByRole("button", { name: "最低版" })).toBeTruthy();
    await user.click(within(wake).getByRole("button", { name: "跳过" }));
    expect(within(wake).getByRole("button", { name: "跳过" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("uses a responsive 8/4 layout with shrink-safe direct children", () => {
    const { container } = render(<App initialDashboard={syntheticDashboard} todos={todos} />);
    const layout = container.querySelector(".workbench-primary");
    expect(layout?.getAttribute("data-wide-layout")).toBe("8-4");
    expect(layout?.children).toHaveLength(2);
    for (const child of [...(layout?.children ?? [])]) {
      expect(child.classList.contains("workbench-primary__item")).toBe(true);
    }
  });
});
