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
    const { container } = render(
      <ProgressPage
        dashboard={dashboardWithoutSleepTimes()}
        goals={repository}
        mode="supabase-candidate"
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "自然周路径，不惩罚空白。",
      }),
    ).toBeTruthy();
    expect(screen.getByText("真实样本")).toBeTruthy();

    const currentDay = container.querySelector(
      '.week-path li[data-current="true"]',
    );
    expect(currentDay?.textContent).toContain("已有主观评分");

    const moodChart = screen.getByRole("img", {
      name: "情绪趋势，缺失点断开",
    });
    expect(moodChart.querySelectorAll("polyline")).toHaveLength(2);
    const moodCard = moodChart.closest("article");
    expect(moodCard).not.toBeNull();
    expect(within(moodCard!).getByText("样本 2 · 缺失 1")).toBeTruthy();

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
    expect(
      screen.getByText(
        "当前候选尚未接入睡眠时刻来源；不会根据睡眠质量评分推算入睡、醒来或离床时间。",
      ),
    ).toBeTruthy();

    expect(screen.queryByText("本周最低成功")).toBeNull();
    expect(screen.queryByText("2+")).toBeNull();
    expect(screen.queryByText("双轨进展")).toBeNull();
    expect(screen.queryByText("合成室内训练")).toBeNull();
    expect(screen.queryByText("合成 Agent 实操")).toBeNull();
    expect(screen.queryByText("周末只看四件事")).toBeNull();
    expect(screen.queryByText(/28%|22%/)).toBeNull();
  });
});
