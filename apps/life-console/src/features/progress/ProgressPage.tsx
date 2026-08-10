import type { Dashboard } from "../../data/dashboard";

type RatingKey = "sleep_quality" | "energy" | "mood" | "life_feeling";

const signals: Array<{ key: RatingKey; label: string }> = [
  { key: "sleep_quality", label: "睡眠质量" },
  { key: "energy", label: "精力" },
  { key: "mood", label: "情绪" },
  { key: "life_feeling", label: "生活实感" },
];

const weekLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function naturalWeek(current: string) {
  const currentDate = new Date(`${current}T00:00:00Z`);
  const mondayOffset = (currentDate.getUTCDay() + 6) % 7;
  const monday = new Date(currentDate);
  monday.setUTCDate(currentDate.getUTCDate() - mondayOffset);
  return weekLabels.map((label, index) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + index);
    const value = day.toISOString().slice(0, 10);
    return {
      date: value,
      label,
      state: value === current ? "今天" : value < current ? "已过" : "待到",
    };
  });
}

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
  const week = naturalWeek(dashboard.date);

  return (
    <section aria-labelledby="progress-title">
      <section className="hero">
        <div>
          <p className="eyebrow">趋势，只是辅助判断</p>
          <h1 id="progress-title">自然周路径，不惩罚空白。</h1>
          <p className="lead">
            进展页展示本周双轨、主观信号与降级规则。未知不是跳过，最低版不是失败，跳过也不需要补作业。
          </p>
        </div>
        <aside className="card hero-card">
          <span className="status blue">本周最低成功</span>
          <div className="grid two metric-grid">
            <div className="metric">
              <strong>2+</strong>
              <span>运动或最低版</span>
            </div>
            <div className="metric">
              <strong>2+</strong>
              <span>Agent 实操或最低版</span>
            </div>
          </div>
          <p className="quiet">
            前提是睡眠、精力或情绪没有明显恶化。界面不使用完成百分比制造压力。
          </p>
        </aside>
      </section>

      <section className="section" aria-labelledby="week-title">
        <div className="section-head">
          <div>
            <h2 id="week-title">{week[0].date} 至 {week.at(-1)?.date}</h2>
            <p className="quiet">按日期而不是打卡连续性组织。</p>
          </div>
          <span className="status gray">自然周</span>
        </div>
        <ol className="card pad week-path">
          {week.map((item) => (
            <li data-current={item.date === dashboard.date} key={item.date}>
              <strong>{item.date.slice(5)} {item.label}</strong>
              <span>{item.date === dashboard.date ? "今天只选一个最低版" : "保持可回退"}</span>
              <small>{item.state}</small>
            </li>
          ))}
        </ol>
      </section>

      <section className="section grid two">
        <article className="card pad">
          <div className="section-head">
            <div>
              <h2>双轨进展</h2>
              <p className="quiet">只显示观察，不把空白换算成扣分。</p>
            </div>
            <span className="status blue">只读项目</span>
          </div>
          <div className="signal-list">
            {dashboard.today.active_projects.map((project, index) => (
              <div className="signal" key={project.plan_path}>
                <strong>{project.title}</strong>
                <div className="bar" aria-label={`${project.title}观察状态`}>
                  <span style={{ "--value": `${index === 0 ? 28 : 22}%` } as React.CSSProperties} />
                </div>
                <span className={`status ${index === 0 ? "green" : "blue"}`}>
                  {index === 0 ? "最低版可用" : "定义中"}
                </span>
              </div>
            ))}
            <div className="signal">
              <strong>恢复边界</strong>
              <div className="bar" aria-label="恢复边界">
                <span style={{ "--value": "70%" } as React.CSSProperties} />
              </div>
              <span className="status gray">继续观察</span>
            </div>
          </div>
        </article>

        <article className="card pad">
          <div className="section-head">
            <div>
              <h2 id="signals-title">主观信号</h2>
              <p className="quiet">只呈现可追溯样本，缺失点保持断开。</p>
            </div>
            <span className="status gray">缺失保留</span>
          </div>
          <div className="signal-grid compact-signals">
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
                  <p>样本 {present.length} · 缺失 {missing}</p>
                </article>
              );
            })}
          </div>
        </article>
      </section>

      <section className="section grid three" aria-label="进展解释">
        <article className="card pad">
          <span className="status gray">未知</span>
          <h3>缺失值不惩罚</h3>
          <p className="quiet">没有记录就显示未知，不自动等同于跳过，也不补填推测值。</p>
        </article>
        <article className="card pad">
          <span className="status green">最低版</span>
          <h3>最低版是有效样本</h3>
          <p className="quiet">短时运动与一句定义也能验证负担边界，仍计入观察。</p>
        </article>
        <article className="card pad">
          <span className="status gray">跳过</span>
          <h3>跳过不失败</h3>
          <p className="quiet">状态不合适可以跳过，不补作业，不把周路径改成追赶任务。</p>
        </article>
      </section>

      <section className="section card pad" aria-labelledby="review-title">
        <div className="section-head">
          <div>
            <h2 id="review-title">周末只看四件事</h2>
            <p className="quiet">让复盘回到可行动的低负担判断。</p>
          </div>
          <span className="status blue">收束问题</span>
        </div>
        <table className="table">
          <tbody>
            {[
              "哪次运动后身体或情绪最舒服？",
              "运动是否影响了当晚睡眠或第二天精力？",
              "Agent 实操中，定义、执行和验证哪一步最卡？",
              "下一周只保留、调整或停止哪一件事？",
            ].map((question, index) => (
              <tr key={question}>
                <th>{index + 1}</th>
                <td>{question}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="section" aria-labelledby="sleep-title">
        <div className="section-head">
          <div>
            <h2 id="sleep-title">入睡、醒来与离床</h2>
            <p className="quiet">设备值不替代主观评分。</p>
          </div>
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

      <p className="footer-note">趋势不构成医学、人格或长期能力结论。</p>
    </section>
  );
}
