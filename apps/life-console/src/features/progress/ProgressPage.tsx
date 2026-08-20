import type { Dashboard } from "../../data/dashboard";
import type { GoalRepositoryPort } from "../../supabase/goals";
import type { HealthRepositoryPort } from "../../supabase/health";
import { SupabaseGoalsPanel } from "../goals/SupabaseGoalsPanel";
import { SleepTimesTable } from "./SleepTimesTable";
import { TrendSection } from "./TrendSection";

type ProgressMode = "local" | "sites" | "candidate-preview" | "supabase-candidate" | "supabase-production";

interface ProgressPageProps {
  dashboard: Dashboard;
  goals?: GoalRepositoryPort;
  health?: HealthRepositoryPort;
  mode?: ProgressMode;
  onSaved?: () => boolean | void | Promise<boolean | void>;
  draftScope?: string;
}

const EMPTY_SLEEP_TIMES: Dashboard["progress"]["sleep"] = [];

export function ProgressPage({
  dashboard,
  goals,
  health,
  mode = "local",
  onSaved,
  draftScope,
}: ProgressPageProps) {
  const supabaseMode = mode === "supabase-candidate" || mode === "supabase-production";

  return (
    <section aria-labelledby="progress-title" className="progress-page-250">
      <header className="progress-page-head-250">
        <div>
          <p className="eyebrow">PROGRESS</p>
          <h1 id="progress-title">目标与趋势</h1>
          <p className="quiet">按两个 7 天窗口观察变化；缺失值不补齐，也不生成健康诊断。</p>
        </div>
      </header>

      <section aria-label="目标" className="section progress-goals-250">
        {supabaseMode ? (
          goals ? (
            <SupabaseGoalsPanel
              draftScope={draftScope}
              onSaved={onSaved}
              repository={goals}
            />
          ) : (
            <article className="card pad">
              <div className="section-head">
                <div><h2>目标</h2><p className="quiet">目标 Repository 尚未接入。</p></div>
                <span className="status gray">未接入</span>
              </div>
              <p className="empty-state">当前不使用示例目标填充。</p>
            </article>
          )
        ) : (
          <div className="local-goals-250">
            {dashboard.today.active_projects.length > 0 ? dashboard.today.active_projects.map((project) => (
              <article className="card goal-card-250" key={project.plan_path}>
                <strong>{project.title}</strong>
                <span>活跃目标</span>
              </article>
            )) : <p className="empty-state">还没有目标。</p>}
          </div>
        )}
      </section>

      <TrendSection
        currentDate={dashboard.date}
        dashboard={dashboard}
        health={health}
      />

      <SleepTimesTable
        currentDate={dashboard.date}
        fallback={supabaseMode ? EMPTY_SLEEP_TIMES : dashboard.progress.sleep}
        health={health}
      />

      <p className="footer-note">趋势只描述上升、下降、稳定与缺失，不构成医学判断。</p>
    </section>
  );
}
