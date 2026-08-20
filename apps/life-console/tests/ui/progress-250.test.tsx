// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { syntheticDashboard } from "../../src/data/dashboard";
import { ProgressPage } from "../../src/features/progress/ProgressPage";
import type { GoalRepositoryPort } from "../../src/supabase/goals";
import type {
  HealthDayMetric,
  HealthRepositoryPort,
  SleepTiming,
} from "../../src/supabase/health";

afterEach(cleanup);

function goals(): GoalRepositoryPort {
  return {
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
  };
}

function isoDay(day: number): string {
  return `2030-05-${String(day).padStart(2, "0")}`;
}

function dashboardWithRatings() {
  const dashboard = structuredClone(syntheticDashboard);
  dashboard.date = "2030-05-14";
  dashboard.progress.ratings = Array.from({ length: 14 }, (_, index) => ({
    date: isoDay(index + 1),
    sleep_quality: index < 7 ? 2 : 4,
    energy: index < 7 ? 2 : 4,
    mood: index < 7 ? 4 : 2,
    life_feeling: 3,
  })) as typeof dashboard.progress.ratings;
  dashboard.progress.sleep = [];
  return dashboard;
}

function metric(day: number): HealthDayMetric {
  return {
    id: day,
    user_id: "synthetic-owner",
    health_date: isoDay(day),
    summary: {
      steps: day < 8 ? 3000 : 6000,
      active_energy: day < 8 ? 180 : 360,
      exercise_minutes: 20,
      sleep_duration_min: 420,
    },
    revision: 1,
    created_at: `${isoDay(day)}T08:00:00.000Z`,
    updated_at: `${isoDay(day)}T08:00:00.000Z`,
  };
}

function sleep(day: number, values: Partial<SleepTiming> = {}): SleepTiming {
  return {
    id: day,
    user_id: "synthetic-owner",
    checkin_date: isoDay(day),
    sleep_time: null,
    wake_time: null,
    out_of_bed_time: null,
    awake_in_bed: null,
    revision: 1,
    ...values,
  };
}

function health(
  metrics: HealthDayMetric[] = Array.from({ length: 14 }, (_, index) => metric(index + 1)),
  sleeps: SleepTiming[] = [
    sleep(13, { wake_time: "07:20" }),
    sleep(14, {
      sleep_time: "23:40",
      wake_time: "07:10",
      out_of_bed_time: "07:25",
    }),
  ],
): HealthRepositoryPort {
  return {
    listDailyMetrics: vi.fn(async () => metrics),
    listSleepTimings: vi.fn(async () => sleeps),
  };
}

describe("Life Console 2.5 progress page", () => {
  it("keeps only goals, 14-day trends and seven-day sleep timing", async () => {
    const healthRepository = health();
    render(
      <ProgressPage
        dashboard={dashboardWithRatings()}
        goals={goals()}
        health={healthRepository}
        mode="supabase-candidate"
      />,
    );

    expect(screen.queryByText(/自然周进展|自然周路径/)).toBeNull();
    expect(screen.queryByText("复盘边界")).toBeNull();
    expect(screen.queryByText("进展解释")).toBeNull();
    expect(await screen.findByRole("region", { name: "14 天趋势" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "主观信号" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "活动" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "睡眠" })).toBeTruthy();

    const energy = screen.getByRole("article", { name: "精力 14 天趋势" });
    expect(within(energy).getByText("较前 7 天上升")).toBeTruthy();
    const mood = screen.getByRole("article", { name: "情绪 14 天趋势" });
    expect(within(mood).getByText("较前 7 天下降")).toBeTruthy();
    const exercise = screen.getByRole("article", { name: "锻炼分钟 14 天趋势" });
    expect(within(exercise).getByText("较前 7 天稳定")).toBeTruthy();

    expect(await screen.findByRole("table", { name: "最近 7 天睡眠时刻" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "入睡" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "醒来" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "离床" })).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(8);
    expect(screen.getAllByText("未记录").length).toBeGreaterThan(0);
    expect(healthRepository.listDailyMetrics).toHaveBeenCalledWith(
      "2030-05-01",
      "2030-05-14",
    );
    expect(healthRepository.listSleepTimings).toHaveBeenCalledWith(
      "2030-05-08",
      "2030-05-14",
    );
  });

  it("uses data-insufficient language when either seven-day window has fewer than three samples", async () => {
    const dashboard = dashboardWithRatings();
    dashboard.progress.ratings = dashboard.progress.ratings.map((row, index) => ({
      ...row,
      sleep_quality: index === 0 || index === 7 ? 3 : null,
      energy: null,
      mood: null,
      life_feeling: null,
    }));
    render(
      <ProgressPage
        dashboard={dashboard}
        goals={goals()}
        health={health([metric(1), metric(8)])}
        mode="supabase-candidate"
      />,
    );

    const trend = await screen.findByRole("region", { name: "14 天趋势" });
    expect(within(trend).getAllByText("数据不足")).toHaveLength(8);
    expect(within(trend).queryByText(/异常|风险|诊断/)).toBeNull();
  });
});
