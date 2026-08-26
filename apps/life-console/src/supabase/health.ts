import type { SupabaseClient } from "@supabase/supabase-js";

import {
  LifeConsoleRepository,
  RepositoryError,
  type SupabaseResult,
} from "./repository";

export interface HealthDayMetric {
  id: number;
  user_id: string;
  health_date: string;
  summary: Record<string, unknown>;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface SleepTiming {
  id: number;
  user_id: string;
  checkin_date: string;
  sleep_time: string | null;
  wake_time: string | null;
  out_of_bed_time: string | null;
  awake_in_bed: "yes" | "no" | null;
  revision: number;
}

export interface HealthRepositoryPort {
  listDailyMetrics(from: string, to: string): Promise<HealthDayMetric[]>;
  listSleepTimings(from: string, to: string): Promise<SleepTiming[]>;
}

function invalid(message: string): RepositoryError {
  return new RepositoryError("validation", 400, "invalid_request", message);
}

function day(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid("Health date is invalid");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw invalid("Health date is invalid");
  }
  return parsed;
}

function range(from: string, to: string, maximumDays: number): [string, string] {
  const start = day(from);
  const end = day(to);
  const span = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (span < 1 || span > maximumDays) throw invalid("Health date range is invalid");
  return [from, to];
}

export class HealthRepository implements HealthRepositoryPort {
  private readonly repository: LifeConsoleRepository;

  constructor(
    private readonly client: SupabaseClient,
    repository?: LifeConsoleRepository,
  ) {
    this.repository = repository ?? new LifeConsoleRepository(client);
  }

  async listDailyMetrics(from: string, to: string): Promise<HealthDayMetric[]> {
    const [start, end] = range(from, to, 14);
    return await this.repository.executeRead<HealthDayMetric[]>(async () =>
      await this.client
        .from("health_days")
        .select("*")
        .gte("health_date", start)
        .lte("health_date", end)
        .order("health_date", { ascending: true })
        .order("id", { ascending: true }) as SupabaseResult<HealthDayMetric[]>
    ) ?? [];
  }

  async listSleepTimings(from: string, to: string): Promise<SleepTiming[]> {
    const [start, end] = range(from, to, 14);
    return await this.repository.executeRead<SleepTiming[]>(async () =>
      await this.client
        .from("daily_checkins")
        .select("id,user_id,checkin_date,sleep_time,wake_time,out_of_bed_time,awake_in_bed,revision")
        .gte("checkin_date", start)
        .lte("checkin_date", end)
        .order("checkin_date", { ascending: true })
        .order("id", { ascending: true }) as SupabaseResult<SleepTiming[]>
    ) ?? [];
  }
}
