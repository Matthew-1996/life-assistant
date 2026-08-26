import type {
  HealthDayMetric,
  HealthRepositoryPort,
  SleepTiming,
} from "../supabase/health";

const candidateHealthUser = "candidate-health-preview-only";

const healthDays: HealthDayMetric[] = [
  [1, "2026-01-03", 3900, 190, 18, 410],
  [2, "2026-01-04", 4200, 205, 22, 425],
  [3, "2026-01-05", 4050, 198, 20, 420],
  [4, "2026-01-10", 6100, 305, 31, 455],
  [5, "2026-01-11", 6400, 320, 34, 450],
  [6, "2026-01-12", 6250, 312, 32, 460],
].map(([id, date, steps, activeEnergy, exerciseMinutes, sleepDuration]) => ({
  id: id as number,
  user_id: candidateHealthUser,
  health_date: date as string,
  summary: {
    steps,
    active_energy: activeEnergy,
    exercise_minutes: exerciseMinutes,
    sleep_duration_min: sleepDuration,
  },
  revision: 1,
  created_at: `${date}T08:00:00.000Z`,
  updated_at: `${date}T08:00:00.000Z`,
}));

const sleepTimings: SleepTiming[] = [
  {
    id: 10,
    user_id: candidateHealthUser,
    checkin_date: "2026-01-10",
    sleep_time: "23:40",
    wake_time: "07:35",
    out_of_bed_time: null,
    awake_in_bed: null,
    revision: 1,
  },
  {
    id: 11,
    user_id: candidateHealthUser,
    checkin_date: "2026-01-11",
    sleep_time: null,
    wake_time: null,
    out_of_bed_time: null,
    awake_in_bed: null,
    revision: 1,
  },
  {
    id: 12,
    user_id: candidateHealthUser,
    checkin_date: "2026-01-12",
    sleep_time: "23:20",
    wake_time: "07:20",
    out_of_bed_time: "07:35",
    awake_in_bed: "no",
    revision: 1,
  },
];

function within(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

export const candidateHealthRepository: HealthRepositoryPort = {
  async listDailyMetrics(from, to) {
    return healthDays.filter((row) => within(row.health_date, from, to));
  },
  async listSleepTimings(from, to) {
    return sleepTimings.filter((row) => within(row.checkin_date, from, to));
  },
};
