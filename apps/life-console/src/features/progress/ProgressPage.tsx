import type { Dashboard } from "../../data/dashboard";

type RatingKey = "sleep_quality" | "energy" | "mood" | "life_feeling";

const signals: Array<{ key: RatingKey; label: string }> = [
  { key: "sleep_quality", label: "睡眠质量" },
  { key: "energy", label: "精力" },
  { key: "mood", label: "情绪" },
  { key: "life_feeling", label: "生活实感" },
];

const week = [
  ["周一", "整理节奏"],
  ["周二", "轻量活动"],
  ["周三", "留出空白"],
  ["周四", "观察变化"],
  ["周五", "完成小事"],
  ["周六", "生活体验"],
  ["周日", "轻复盘"],
];

function lineSegments(
  values: Array<number | null>,
): Array<Array<{ x: number; y: number }>> {
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];

  values.forEach((value, index) => {
    if (value === null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({
      x: values.length === 1 ? 50 : (index / (values.length - 1)) * 100,
      y: 46 - ((value - 1) / 4) * 38,
    });
  });
  if (current.length) segments.push(current);
  return segments;
}

interface ProgressPageProps {
  dashboard: Dashboard;
}

export function ProgressPage({ dashboard }: ProgressPageProps) {
  const dates = dashboard.progress.ratings.map((sample) => sample.date);

  return (
    <section aria-labelledby="progress-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">计划与变化放在一起看</p>
          <h1 id="progress-title">进展</h1>
        </div>
        <p>趋势只描述已有样本，不替代生活判断。</p>
      </div>

      <section className="section-block" aria-labelledby="week-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">自然周</p>
            <h2 id="week-title">本周路径</h2>
          </div>
        </div>
        <ol className="week-path">
          {week.map(([day, theme], index) => (
            <li data-current={index === 1} key={day}>
              <span>{day}</span>
              <strong>{theme}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className="section-block" aria-labelledby="phase-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">阶段路线</p>
            <h2 id="phase-title">当前阶段</h2>
          </div>
          <span className="neutral-badge">下一节点需要确认</span>
        </div>
        <div className="phase-timeline">
          <article data-state="done">
            <span>已确认</span>
            <strong>建立基础节奏</strong>
            <p>保持起床、身体活动与生活体验可观察。</p>
          </article>
          <article data-state="current">
            <span>当前</span>
            <strong>{dashboard.today.focus.title}</strong>
            <p>观察稳定性，不以日期自动推进下一阶段。</p>
          </article>
          <article data-state="suggested">
            <span>建议</span>
            <strong>复盘后决定下一方向</strong>
            <p>需要用户确认，不作为普通待办。</p>
          </article>
        </div>
      </section>

      <section className="section-block" aria-labelledby="signals-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">近期信号</p>
            <h2 id="signals-title">四项主观评分</h2>
          </div>
          <span className="supporting-text">
            {dates.at(0)} 至 {dates.at(-1)}
          </span>
        </div>
        <div className="signal-grid">
          {signals.map((signal) => {
            const values = dashboard.progress.ratings.map(
              (sample) => sample[signal.key],
            );
            const present = values.filter(
              (value): value is number => value !== null,
            );
            const latest = present.at(-1);
            const missing = values.length - present.length;
            return (
              <article className="signal-card" key={signal.key}>
                <div>
                  <span>{signal.label}</span>
                  <strong>{latest ? `${latest} / 5` : "暂无评分"}</strong>
                </div>
                <svg
                  aria-label={`${signal.label}趋势，缺失点断开`}
                  className="sparkline"
                  role="img"
                  viewBox="0 0 100 54"
                >
                  <path d="M0 46H100" className="chart-baseline" />
                  {lineSegments(values).map((segment, index) => (
                    <polyline
                      className="chart-line"
                      data-segment={index}
                      key={`${signal.key}-${index}`}
                      points={segment.map(({ x, y }) => `${x},${y}`).join(" ")}
                    />
                  ))}
                </svg>
                <p>
                  样本 {present.length} · 缺失 {missing}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="section-block" aria-labelledby="sleep-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">睡眠结构</p>
            <h2 id="sleep-title">入睡、醒来与离床</h2>
          </div>
          <span className="supporting-text">设备值不替代主观评分</span>
        </div>
        <div className="sleep-table" role="table" aria-label="近期睡眠时刻">
          <div className="sleep-row sleep-head" role="row">
            <span role="columnheader">日期</span>
            <span role="columnheader">入睡</span>
            <span role="columnheader">最终醒来</span>
            <span role="columnheader">离床</span>
          </div>
          {dashboard.progress.sleep.map((sample) => (
            <div className="sleep-row" role="row" key={sample.date}>
              <span role="cell">{sample.date}</span>
              <span role="cell">{sample.sleep_time ?? "缺失"}</span>
              <span role="cell">{sample.wake_time ?? "缺失"}</span>
              <span role="cell">{sample.out_of_bed_time ?? "未提供"}</span>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
