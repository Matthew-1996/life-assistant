// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { SupabaseCandidateApp } from "../../src/features/candidate/SupabaseCandidateApp";
import type { DailyCheckinRepositoryPort } from "../../src/supabase/daily-checkins";
import type { GoalRepositoryPort } from "../../src/supabase/goals";
import type { JournalRepositoryPort } from "../../src/supabase/journals";
import type { ReviewRepositoryPort } from "../../src/supabase/reviews";

afterEach(cleanup);

const dailyCheckins: DailyCheckinRepositoryPort = {
  get: async () => null,
  list: async () => ({ items: [], nextCursor: null }),
  create: async () => { throw new Error("not used"); },
  update: async () => { throw new Error("not used"); },
};
const goals: GoalRepositoryPort = {
  list: async () => ({ items: [], nextCursor: null }),
  create: async () => { throw new Error("not used"); },
  update: async () => { throw new Error("not used"); },
  archive: async () => { throw new Error("not used"); },
  restore: async () => { throw new Error("not used"); },
};
const journals: JournalRepositoryPort = {
  list: async () => ({ items: [], nextCursor: null }),
  get: async () => null,
  revisions: async () => [],
  create: async () => { throw new Error("not used"); },
  update: async () => { throw new Error("not used"); },
};
const reviews: ReviewRepositoryPort = {
  listWeekly: async () => ({ items: [], nextCursor: null }),
  listPhases: async () => ({ items: [], nextCursor: null }),
  createWeekly: async () => { throw new Error("not used"); },
  createPhase: async () => { throw new Error("not used"); },
  updateWeekly: async () => { throw new Error("not used"); },
  updatePhase: async () => { throw new Error("not used"); },
};

function renderCandidate() {
  render(
    <SupabaseCandidateApp
      dailyCheckins={dailyCheckins}
      date="2030-01-01"
      goals={goals}
      journals={journals}
      reviews={reviews}
    />,
  );
}

describe("Supabase candidate application", () => {
  it("shows the synthetic-only boundary and daily check-in", async () => {
    renderCandidate();
    expect(screen.getByText("Life Console · Supabase Candidate")).toBeTruthy();
    expect(screen.getByLabelText("测试候选边界").textContent).toContain(
      "不读取 iCloud",
    );
    expect(await screen.findByText("这一天还没有状态记录")).toBeTruthy();
  });

  it("routes to repository-backed records, progress, and system pages", async () => {
    const user = userEvent.setup();
    renderCandidate();
    const nav = screen.getByRole("navigation", { name: "全局导航" });

    await user.click(within(nav).getByRole("button", { name: "记录" }));
    expect(await screen.findByRole("heading", { name: "日记" })).toBeTruthy();

    await user.click(within(nav).getByRole("button", { name: "进展" }));
    expect(await screen.findByRole("heading", { name: "目标" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "复盘" })).toBeTruthy();

    await user.click(within(nav).getByRole("button", { name: "系统" }));
    expect(
      screen.getByRole("heading", { name: "候选环境边界" }),
    ).toBeTruthy();
    expect(screen.getByText("仍为 ICLOUD_PRIMARY，未切换")).toBeTruthy();
  });
});
