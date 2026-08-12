// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SupabaseReviewsPanel } from "../../src/features/reviews/SupabaseReviewsPanel";
import type {
  PhaseReview,
  ReviewRepositoryPort,
  WeeklyReview,
} from "../../src/supabase/reviews";
import { RepositoryError } from "../../src/supabase/repository";

afterEach(cleanup);

const weekly: WeeklyReview = {
  id: 51, user_id: "synthetic-owner", week_start: "2030-04-01",
  content: "Synthetic weekly", revision: 1, deleted_at: null,
  created_at: "2030-04-07T08:00:00.000Z",
  updated_at: "2030-04-07T08:00:00.000Z",
};
const phase: PhaseReview = {
  id: 61, user_id: "synthetic-owner", period_start: "2030-04-01",
  period_end: "2030-04-30", content: "Synthetic phase", revision: 1,
  deleted_at: null, created_at: "2030-05-01T08:00:00.000Z",
  updated_at: "2030-05-01T08:00:00.000Z",
};

function repository(
  weeklyRows: WeeklyReview[] = [],
  phaseRows: PhaseReview[] = [],
): ReviewRepositoryPort {
  return {
    listWeekly: vi.fn(async () => ({ items: weeklyRows, nextCursor: null })),
    listPhases: vi.fn(async () => ({ items: phaseRows, nextCursor: null })),
    createWeekly: vi.fn(async (_key, input) => ({
      ...weekly, week_start: input.weekStart, content: input.content,
    })),
    createPhase: vi.fn(async (_key, input) => ({
      ...phase, period_start: input.periodStart,
      period_end: input.periodEnd, content: input.content,
    })),
    updateWeekly: vi.fn(async (_id, revision, input) => ({
      ...weekly, revision: revision + 1,
      content: input.content ?? weekly.content,
    })),
    updatePhase: vi.fn(async (_id, revision, input) => ({
      ...phase, revision: revision + 1,
      content: input.content ?? phase.content,
    })),
  };
}

describe("Supabase Reviews panel", () => {
  it("shows real empty states after loading", async () => {
    render(<SupabaseReviewsPanel repository={repository()} />);
    expect(await screen.findByText("还没有周复盘")).toBeTruthy();
    expect(screen.getByText("还没有阶段复盘")).toBeTruthy();
  });

  it("creates weekly and phase reviews through separate inputs", async () => {
    const user = userEvent.setup();
    const repo = repository();
    render(
      <SupabaseReviewsPanel
        createIdempotencyKey={(kind) => `synthetic-${kind}-key-0001`}
        repository={repo}
      />,
    );
    await screen.findByText("还没有周复盘");
    await user.type(screen.getByLabelText("周起始日"), "2030-04-01");
    await user.type(screen.getByLabelText("周复盘内容"), "Weekly draft");
    await user.click(screen.getByRole("button", { name: "新建周复盘" }));
    expect(repo.createWeekly).toHaveBeenCalledWith(
      "synthetic-weekly-key-0001",
      { weekStart: "2030-04-01", content: "Weekly draft" },
    );

    await user.type(screen.getByLabelText("阶段开始日"), "2030-04-01");
    await user.type(screen.getByLabelText("阶段结束日"), "2030-04-30");
    await user.type(screen.getByLabelText("阶段复盘内容"), "Phase draft");
    await user.click(screen.getByRole("button", { name: "新建阶段复盘" }));
    expect(repo.createPhase).toHaveBeenCalledWith(
      "synthetic-phase-key-0001",
      {
        periodStart: "2030-04-01",
        periodEnd: "2030-04-30",
        content: "Phase draft",
      },
    );
  });

  it("updates weekly reviews with their expected revision", async () => {
    const user = userEvent.setup();
    const repo = repository([weekly]);
    render(<SupabaseReviewsPanel repository={repo} />);
    await screen.findByText("Synthetic weekly");
    await user.click(screen.getByRole("button", { name: "编辑周复盘" }));
    const input = screen.getByLabelText("编辑周复盘内容");
    await user.clear(input);
    await user.type(input, "Weekly revised");
    await user.click(screen.getByRole("button", { name: "保存周复盘" }));
    expect(repo.updateWeekly).toHaveBeenCalledWith(
      51, 1, { content: "Weekly revised" },
    );
  });

  it("retains phase input after a revision conflict", async () => {
    const user = userEvent.setup();
    const repo = repository([], [phase]);
    repo.updatePhase = vi.fn(async () => {
      throw new RepositoryError(
        "conflict", 409, "revision_conflict", "synthetic conflict",
      );
    });
    render(<SupabaseReviewsPanel repository={repo} />);
    await screen.findByText("Synthetic phase");
    await user.click(screen.getByRole("button", { name: "编辑阶段复盘" }));
    const input = screen.getByLabelText("编辑阶段复盘内容");
    await user.clear(input);
    await user.type(input, "Conflicting phase draft");
    await user.click(screen.getByRole("button", { name: "保存阶段复盘" }));
    expect((input as HTMLTextAreaElement).value).toBe(
      "Conflicting phase draft",
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "记录已在其他页面更新",
    );
  });

  it("reuses the weekly idempotency key after failure", async () => {
    const user = userEvent.setup();
    const repo = repository();
    repo.createWeekly = vi.fn()
      .mockRejectedValueOnce(new RepositoryError(
        "transient", 503, "PGRST000", "unavailable",
      ))
      .mockResolvedValueOnce(weekly);
    const key = vi.fn(() => "synthetic-weekly-key-0002");
    render(
      <SupabaseReviewsPanel
        createIdempotencyKey={key}
        repository={repo}
      />,
    );
    await screen.findByText("还没有周复盘");
    await user.type(screen.getByLabelText("周起始日"), "2030-04-01");
    await user.type(screen.getByLabelText("周复盘内容"), "Weekly retry");
    await user.click(screen.getByRole("button", { name: "新建周复盘" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "新建周复盘" }));
    expect(repo.createWeekly).toHaveBeenCalledTimes(2);
    expect(key).toHaveBeenCalledOnce();
  });
});
