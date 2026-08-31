import { describe, expect, it } from "vitest";

import { createCandidateTodoRepository } from "../../src/features/todos/candidate-todo-repository";

describe("Candidate Todo repository", () => {
  it("keeps its cross-day active example in Today", async () => {
    const now = new Date("2030-01-08T10:00:00+08:00");
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const item = (await createCandidateTodoRepository(now).listToday(now))
      .find((todo) => todo.title === "整理旅行清单");

    expect(item).toBeTruthy();
    expect(Date.parse(item!.planned_start_at)).toBeLessThan(start.getTime());
    expect(Date.parse(item!.due_at)).toBeGreaterThanOrEqual(start.getTime());
  });

  it("keeps its completed example in Today at the Shanghai midnight boundary", async () => {
    const now = new Date("2030-01-08T00:30:00+08:00");
    const repository = createCandidateTodoRepository(now);

    expect((await repository.listToday(now)).map((item) => item.title))
      .toContain("完成房间整理");
  });

  it("keeps its future same-day example in Today before its planned start", async () => {
    const now = new Date("2030-01-08T10:00:00+08:00");
    const end = new Date(now);
    end.setHours(24, 0, 0, 0);
    const item = (await createCandidateTodoRepository(now).listToday(now))
      .find((todo) => todo.title === "准备本周采购");

    expect(item).toBeTruthy();
    expect(Date.parse(item!.planned_start_at)).toBeGreaterThan(now.getTime());
    expect(Date.parse(item!.planned_start_at)).toBeLessThan(end.getTime());
  });

  it("keeps transitions local to one factory instance", async () => {
    const now = new Date("2030-01-08T10:00:00+08:00");
    const first = createCandidateTodoRepository(now);
    const second = createCandidateTodoRepository(now);
    const target = (await first.listAll()).find((item) => item.title === "准备本周采购")!;

    const transitioned = await first.transition({
      expectedRevision: target.revision,
      id: target.id,
      status: "completed",
    });

    expect(transitioned.status).toBe("completed");
    expect((await first.listStatusEvents(target.id))).toHaveLength(1);
    expect((await second.listAll()).find((item) => item.id === target.id)?.status)
      .toBe("not_started");
  });
});
