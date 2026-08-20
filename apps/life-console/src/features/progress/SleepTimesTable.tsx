import { useEffect, useMemo, useState } from "react";

import type { Dashboard } from "../../data/dashboard";
import type { HealthRepositoryPort, SleepTiming } from "../../supabase/health";

interface SleepTimesTableProps {
  currentDate: string;
  fallback?: Dashboard["progress"]["sleep"];
  health?: HealthRepositoryPort;
}

const EMPTY_SLEEP_ROWS: Dashboard["progress"]["sleep"] = [];

function isoDaysEnding(currentDate: string, count: number): string[] {
  const current = new Date(`${currentDate}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(current);
    day.setUTCDate(current.getUTCDate() - (count - index - 1));
    return day.toISOString().slice(0, 10);
  });
}

function fallbackRows(rows: Dashboard["progress"]["sleep"]): SleepTiming[] {
  return rows.map((row, index) => ({
    id: -(index + 1),
    user_id: "local-display",
    checkin_date: row.date,
    sleep_time: row.sleep_time,
    wake_time: row.wake_time,
    out_of_bed_time: row.out_of_bed_time,
    awake_in_bed: null,
    revision: 1,
  }));
}

export function SleepTimesTable({ currentDate, fallback = EMPTY_SLEEP_ROWS, health }: SleepTimesTableProps) {
  const dates = useMemo(() => isoDaysEnding(currentDate, 7), [currentDate]);
  const [rows, setRows] = useState<SleepTiming[]>(() => fallbackRows(fallback));
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(health));

  useEffect(() => {
    let active = true;
    if (!health) {
      setRows(fallbackRows(fallback));
      setFailed(false);
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setFailed(false);
    void health.listSleepTimings(dates[0], dates[6]).then((result) => {
      if (active) setRows(result);
    }).catch(() => {
      if (active) {
        setRows([]);
        setFailed(true);
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [dates, fallback, health]);

  const byDate = new Map(rows.map((row) => [row.checkin_date, row]));

  return (
    <section className="section card pad sleep-times-250" aria-labelledby="sleep-times-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">7 DAY VIEW</p>
          <h2 id="sleep-times-title">最近 7 天睡眠时刻</h2>
          <p className="quiet">入睡、醒来与离床保持独立；没有记录就保留未知。</p>
        </div>
        <span className="status gray">设备与显式记录</span>
      </div>
      {failed && <p className="error-message" role="alert">睡眠时刻暂时无法读取；没有用评分推算时间。</p>}
      <div className="sleep-table-scroll">
        <table aria-busy={loading} aria-label="最近 7 天睡眠时刻" className="sleep-table-250">
          <thead><tr><th>日期</th><th>入睡</th><th>醒来</th><th>离床</th></tr></thead>
          <tbody>
            {[...dates].reverse().map((date) => {
              const row = byDate.get(date);
              return (
                <tr key={date}>
                  <td>{date}</td>
                  <td>{row?.sleep_time ?? "未记录"}</td>
                  <td>{row?.wake_time ?? "未记录"}</td>
                  <td>{row?.out_of_bed_time ?? "未记录"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
