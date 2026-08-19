import { describe, expect, it } from "vitest";

import type { TodoItem } from "../../src/domain/todos";
import {
  isOverdue,
  selectTodayTodos,
  sortTodos,
} from "../../src/features/todos/todo-projections";

function todo(overrides: Partial<TodoItem>): TodoItem {
  return {
    id: 1,
    user_id: "synthetic-owner",
    title: "Synthetic Todo",
    priority: "P1",
    status: "not_started",
    planned_start_at: "2030-05-01T01:00:00.000Z",
    due_at: "2030-05-02T01:00:00.000Z",
    actual_started_at: null,
    completed_at: null,
    revision: 1,
    created_at: "2030-05-01T00:00:00.000Z",
    updated_at: "2030-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Todo deterministic projections", () => {
  it("sorts by priority, DDL, creation time, and id without mutating input", () => {
    const source = [
      todo({ id: 4, priority: "P1", due_at: "2030-05-02T00:00:00Z" }),
      todo({ id: 2, priority: "P0", due_at: "2030-05-03T00:00:00Z" }),
      todo({ id: 3, priority: "P1", due_at: "2030-05-01T00:00:00Z" }),
      todo({ id: 1, priority: "P2", due_at: "2030-04-30T00:00:00Z" }),
    ];

    expect(sortTodos(source).map((item) => item.id)).toEqual([2, 3, 4, 1]);
    expect(source.map((item) => item.id)).toEqual([4, 2, 3, 1]);
  });

  it("derives overdue only for unfinished items strictly past DDL", () => {
    const now = new Date("2030-05-02T01:00:00.000Z");
    expect(isOverdue(todo({ due_at: "2030-05-02T00:59:59.000Z" }), now)).toBe(true);
    expect(isOverdue(todo({ due_at: now.toISOString() }), now)).toBe(false);
    expect(isOverdue(todo({ status: "completed", due_at: "2030-05-01T00:00:00Z" }), now)).toBe(false);
  });

  it("selects locally started open items plus items completed today", () => {
    const now = new Date("2030-05-01T12:00:00.000Z");
    const rows = [
      todo({ id: 1, planned_start_at: "2030-05-01T11:00:00Z" }),
      todo({ id: 2, planned_start_at: "2030-05-01T13:00:00Z" }),
      todo({
        id: 3,
        status: "completed",
        actual_started_at: "2030-04-30T15:00:00Z",
        completed_at: "2030-04-30T15:59:59Z",
      }),
      todo({
        id: 4,
        status: "completed",
        actual_started_at: "2030-04-30T16:00:00Z",
        completed_at: "2030-04-30T16:00:00Z",
      }),
    ];

    expect(selectTodayTodos(rows, now).map((item) => item.id)).toEqual([1, 4]);
  });
});
