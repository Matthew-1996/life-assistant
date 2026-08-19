// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { syntheticDashboard } from "../../src/data/dashboard";
import { ProgressPage } from "../../src/features/progress/ProgressPage";
import type {
  Goal,
  GoalRepositoryPort,
} from "../../src/supabase/goals";

afterEach(() => {
  cleanup();
});

const repositoryGoal: Goal = {
  id: 21,
  user_id: "synthetic-owner",
  title: "Repository 目标",
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

function createRepository(goals: Goal[] = []): GoalRepositoryPort {
  return {
    list: vi.fn(async () => ({ items: goals, nextCursor: null })),
    create: vi.fn(async (_key, input) => ({
      ...repositoryGoal,
      title: input.title,
    })),
    update: vi.fn(async (id, revision, input) => ({
      ...repositoryGoal,
      id,
      revision: revision + 1,
      title: input.title ?? repositoryGoal.title,
    })),
    archive: vi.fn(async (id, revision, deletedAt) => ({
      ...repositoryGoal,
      id,
      revision: revision + 1,
      status: "archived" as const,
      deleted_at: deletedAt ?? "2030-01-02T08:00:00.000Z",
    })),
    restore: vi.fn(async () => repositoryGoal),
  };
}

function dashboardWithoutSleepTimes() {
  const dashboard = structuredClone(syntheticDashboard);
  dashboard.progress.sleep = [];
  return dashboard;
}

describe("Supabase candidate progress page", () => {
  it("renders repository goals and source-backed rating trends", async () => {
    const repository = createRepository([repositoryGoal]);
    render(
      <ProgressPage
        dashboard={dashboardWithoutSleepTimes()}
        goals={repository}
        mode="supabase-candidate"
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "目标与趋势",
      }),
    ).toBeTruthy();
    const mood = screen.getByRole("article", { name: "情绪 14 天趋势" });
    expect(mood.querySelectorAll(".trend-bar-250")).toHaveLength(14);
    expect(mood.querySelectorAll('[data-missing="true"]')).toHaveLength(12);
    expect(within(mood).getByText("数据不足")).toBeTruthy();

    expect(await screen.findByText("Repository 目标")).toBeTruthy();
    expect(repository.list).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "新建目标" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "编辑 Repository 目标" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "归档 Repository 目标" }),
    ).toBeTruthy();
  });

  it("uses truthful empty states instead of the legacy trial-week fixtures", async () => {
    render(
      <ProgressPage
        dashboard={dashboardWithoutSleepTimes()}
        goals={createRepository()}
        mode="supabase-candidate"
      />,
    );

    expect(await screen.findByText("还没有目标")).toBeTruthy();
    const sleep = screen.getByRole("table", { name: "最近 7 天睡眠时刻" });
    expect(within(sleep).getAllByRole("row")).toHaveLength(8);
    expect(within(sleep).getAllByText("未记录").length).toBeGreaterThan(0);

    expect(screen.queryByText("本周最低成功")).toBeNull();
    expect(screen.queryByText("2+")).toBeNull();
    expect(screen.queryByText("双轨进展")).toBeNull();
    expect(screen.queryByText("合成室内训练")).toBeNull();
    expect(screen.queryByText("合成 Agent 实操")).toBeNull();
    expect(screen.queryByText("周末只看四件事")).toBeNull();
    expect(screen.queryByText("复盘边界")).toBeNull();
    expect(screen.queryByText(/28%|22%/)).toBeNull();
  });
});
