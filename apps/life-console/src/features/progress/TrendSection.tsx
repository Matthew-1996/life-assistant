import { type CSSProperties, useEffect, useMemo, useState } from "react";

import type { Dashboard } from "../../data/dashboard";
import type {
  HealthDayMetric,
  HealthRepositoryPort,
} from "../../supabase/health";
import { observeTrend } from "./trend-observations";

type RatingKey = "sleep_quality" | "energy" | "mood" | "life_feeling";

interface TrendSectionProps {
  currentDate: string;
  dashboard: Dashboard;
  health?: HealthRepositoryPort;
}

interface TrendMetric {
  group: "subjective" | "activity" | "sleep";
  key: string;
  label: string;
  values: Array<number | null>;
}

const subjectiveMetrics: Array<{ key: RatingKey; label: string }> = [
  { key: "sleep_quality", label: "睡眠质量" },
  { key: "energy", label: "精力" },
  { key: "mood", label: "情绪" },
  { key: "life_feeling", label: "生活实感" },
];

const healthMetrics = [
  { group: "activity" as const, key: "steps", label: "步数", aliases: ["steps"] },
  {
    group: "activity" as const,
    key: "active_energy",
    label: "活动能量",
    aliases: ["active_energy", "active_energy_kcal"],
  },
  {
    group: "activity" as const,
    key: "exercise_minutes",
    label: "锻炼分钟",
    aliases: ["exercise_minutes", "exercise_duration_min"],
  },
  {
    group: "sleep" as const,
    key: "sleep_duration_min",
    label: "睡眠时长",
    aliases: ["sleep_duration_min", "sleep_duration_minutes"],
  },
] as const;

function isoDaysEnding(currentDate: string, count: number): string[] {
  const current = new Date(`${currentDate}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(current);
    day.setUTCDate(current.getUTCDate() - (count - index - 1));
    return day.toISOString().slice(0, 10);
  });
}

function numeric(summary: Record<string, unknown>, aliases: readonly string[]): number | null {
  for (const key of aliases) {
    const value = summary[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return null;
}

function explicitSleepDuration(summary: Record<string, unknown>): number | null {
  const direct = numeric(summary, ["sleep_duration_min", "sleep_duration_minutes"]);
  if (direct !== null) return direct;
  if (typeof summary.sleep_start !== "string" || typeof summary.sleep_end !== "string") {
    return null;
  }
  const start = new Date(summary.sleep_start).getTime();
  const end = new Date(summary.sleep_end).getTime();
  const minutes = (end - start) / 60_000;
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 18 * 60
    ? minutes
    : null;
}

function validCount(values: Array<number | null>): number {
  return values.filter((value): value is number => value !== null).length;
}

function TrendCard({ metric }: { metric: TrendMetric }) {
  const previous = metric.values.slice(0, 7);
  const recent = metric.values.slice(7);
  const observation = observeTrend(recent, previous);
  const present = metric.values.filter((value): value is number => value !== null);
  const maximum = Math.max(...present, 1);

  return (
    <article aria-label={`${metric.label} 14 天趋势`} className="trend-card-250">
      <header>
        <strong>{metric.label}</strong>
        <span className={`trend-observation trend-observation--${observation.state}`}>
          {observation.label}
        </span>
      </header>
      <div aria-hidden="true" className="trend-bars-250">
        {metric.values.map((value, index) => (
          <span
            className={index < 7 ? "trend-bar-250 trend-bar-250--previous" : "trend-bar-250 trend-bar-250--recent"}
            data-missing={value === null}
            key={`${metric.key}-${index}`}
            style={{ "--bar-height": `${value === null ? 8 : Math.max(12, (value / maximum) * 100)}%` } as CSSProperties}
          />
        ))}
      </div>
      <p>前 7 天有效 {validCount(previous)} · 最近 7 天有效 {validCount(recent)}</p>
    </article>
  );
}

export function TrendSection({ currentDate, dashboard, health }: TrendSectionProps) {
  const [healthRows, setHealthRows] = useState<HealthDayMetric[]>([]);
  const [healthFailed, setHealthFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(health));
  const dates = useMemo(() => isoDaysEnding(currentDate, 14), [currentDate]);

  useEffect(() => {
    let active = true;
    if (!health) {
      setHealthRows([]);
      setHealthFailed(false);
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setHealthFailed(false);
    void health.listDailyMetrics(dates[0], dates[13]).then((rows) => {
      if (active) setHealthRows(rows);
    }).catch(() => {
      if (active) {
        setHealthRows([]);
        setHealthFailed(true);
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [dates, health]);

  const metrics = useMemo(() => {
    const ratingsByDate = new Map(dashboard.progress.ratings.map((row) => [row.date, row]));
    const healthByDate = new Map(healthRows.map((row) => [row.health_date, row]));
    const subjective: TrendMetric[] = subjectiveMetrics.map((metric) => ({
      group: "subjective",
      key: metric.key,
      label: metric.label,
      values: dates.map((date) => ratingsByDate.get(date)?.[metric.key] ?? null),
    }));
    const device: TrendMetric[] = healthMetrics.map((metric) => ({
      group: metric.group,
      key: metric.key,
      label: metric.label,
      values: dates.map((date) => {
        const row = healthByDate.get(date);
        if (!row) return null;
        return metric.key === "sleep_duration_min"
          ? explicitSleepDuration(row.summary)
          : numeric(row.summary, metric.aliases);
      }),
    }));
    return [...subjective, ...device];
  }, [dashboard.progress.ratings, dates, healthRows]);

  const groups = [
    { key: "subjective", label: "主观信号" },
    { key: "activity", label: "活动" },
    { key: "sleep", label: "睡眠" },
  ] as const;

  return (
    <section aria-label="14 天趋势" className="section progress-trends-250" aria-busy={loading}>
      <div className="section-head">
        <div>
          <p className="eyebrow">14 DAY VIEW</p>
          <h2>14 天趋势</h2>
          <p className="quiet">最近 7 天使用实色，前 7 天使用浅色；缺失日期不参与比较。</p>
        </div>
        <span className="status gray">只做确定性观察</span>
      </div>
      {healthFailed && <p className="error-message" role="alert">健康指标暂时无法读取；主观信号仍按已保存数据展示。</p>}
      <div className="trend-groups-250">
        {groups.map((group) => (
          <section aria-labelledby={`trend-group-${group.key}`} className="trend-group-250" key={group.key}>
            <h3 id={`trend-group-${group.key}`}>{group.label}</h3>
            <div className="trend-card-grid-250">
              {metrics.filter((metric) => metric.group === group.key).map((metric) => (
                <TrendCard key={metric.key} metric={metric} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
