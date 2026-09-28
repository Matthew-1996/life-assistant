import type { LifeConsoleClient } from "../../api/client";
import type { PageId } from "../../components/shell/AppShell";
import type { Dashboard } from "../../data/dashboard";
import type { DailyNewsClient } from "../../domain/daily-news";
import type { TodoRepositoryPort } from "../../domain/todos";
import type { FitnessRepositoryPort } from "../../domain/fitness";
import type { DashboardMessageRepositoryPort } from "../../supabase/dashboard-messages";
import { WeeklyMessageHero } from "../messages/WeeklyMessageHero";
import { DailyNewsPanel } from "../news/DailyNewsPanel";
import { TodoPanel } from "../todos/TodoPanel";
import { FitnessPanel } from "../fitness/FitnessPanel";

interface TodayPageProps {
  dashboard: Dashboard;
  client?: LifeConsoleClient;
  dailyNews?: DailyNewsClient;
  dashboardMessages?: DashboardMessageRepositoryPort;
  draftScope?: string;
  mode?:
    | "local"
    | "sites"
    | "candidate-preview"
    | "supabase-candidate"
    | "supabase-production";
  onNavigate?: (page: PageId) => void;
  onSaved?: () => boolean | Promise<boolean>;
  sourceTruth?: "ICLOUD_PRIMARY" | "SITES_D1_PRIMARY";
  todos?: TodoRepositoryPort;
  fitness?: FitnessRepositoryPort;
}

export function TodayPage({
  dashboard,
  dashboardMessages,
  dailyNews,
  todos,
  fitness,
  draftScope,
  mode,
}: TodayPageProps) {
  return (
    <section aria-label="工作台" className="workbench-250">
      <WeeklyMessageHero date={dashboard.date} repository={dashboardMessages} />
      <div className="workbench-primary" data-wide-layout="8-4">
        <div className="workbench-primary__item">
          <TodoPanel repository={todos} />
        </div>
        <div className="workbench-primary__item">
          <DailyNewsPanel client={dailyNews} />
        </div>
      </div>
      <FitnessPanel
        repository={fitness}
        sessionScope={draftScope}
        synthetic={mode === "candidate-preview"}
      />
    </section>
  );
}
