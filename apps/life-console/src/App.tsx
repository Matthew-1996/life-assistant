import {
  type FormEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import type { LifeConsoleClient } from "./api/client";
import type {
  SitesLifeConsoleClient,
  SitesSystemStatus,
} from "./api/sites-client";
import { AppShell, type PageId } from "./components/shell/AppShell";
import { syntheticDashboard, type Dashboard } from "./data/dashboard";
import { ProgressPage } from "./features/progress/ProgressPage";
import { RecordsPage } from "./features/records/RecordsPage";
import { SupabaseJournalsPanel } from "./features/journals/SupabaseJournalsPanel";
import { SupabaseReviewsPanel } from "./features/reviews/SupabaseReviewsPanel";
import { StageAPocPanel } from "./features/system/StageAPocPanel";
import { SystemPage } from "./features/system/SystemPage";
import { TodayPage } from "./features/today/TodayPage";
import type { DailyNewsClient } from "./domain/daily-news";
import type { TodoRepositoryPort } from "./domain/todos";
import type { AuthSession } from "./supabase/auth";
import type { BackupRepository } from "./supabase/backups";
import type { DashboardMessageRepositoryPort } from "./supabase/dashboard-messages";
import type { DailyCheckinRepositoryPort } from "./supabase/daily-checkins";
import type { GoalRepositoryPort } from "./supabase/goals";
import type { HealthRepositoryPort } from "./supabase/health";
import type { JournalRepositoryPort } from "./supabase/journals";
import type { ReviewRepositoryPort } from "./supabase/reviews";

export interface SupabaseProductContext {
  dailyCheckins: DailyCheckinRepositoryPort;
  goals: GoalRepositoryPort;
  health?: HealthRepositoryPort;
  journals: JournalRepositoryPort;
  reviews: ReviewRepositoryPort;
  dashboardMessages?: DashboardMessageRepositoryPort;
  todos?: TodoRepositoryPort;
  session: AuthSession;
  signOut(): Promise<void>;
  backups?: BackupRepository;
}

type RefreshStatus = "applied" | "failed" | "superseded";

interface RefreshOutcome {
  generation: number;
  status: RefreshStatus;
}

interface AppProps {
  client?: LifeConsoleClient;
  initialDashboard?: Dashboard;
  mode?: "local" | "sites" | "candidate-preview" | "supabase-candidate" | "supabase-production";
  stageAPocEnabled?: boolean;
  supabase?: SupabaseProductContext;
  dailyNews?: DailyNewsClient;
  dashboardMessages?: DashboardMessageRepositoryPort;
  todos?: TodoRepositoryPort;
}

export function App({
  client,
  initialDashboard,
  mode = "local",
  stageAPocEnabled = false,
  supabase,
  dailyNews,
  dashboardMessages,
  todos,
}: AppProps) {
  const supabaseMode = mode === "supabase-candidate" || mode === "supabase-production";
  const [activePage, setActivePage] = useState<PageId>("today");
  const [dashboard, setDashboard] = useState<Dashboard | null>(
    initialDashboard ?? (client ? null : syntheticDashboard),
  );
  const [sitesStatus, setSitesStatus] = useState<SitesSystemStatus | null>(null);
  const [error, setError] = useState(false);
  const [candidateNotice, setCandidateNotice] = useState(false);
  const refreshGeneration = useRef(0);
  const latestRefresh = useRef<{
    generation: number;
    promise: Promise<RefreshOutcome>;
  } | null>(null);

  function refresh(): Promise<RefreshOutcome> {
    const generation = ++refreshGeneration.current;
    const promise = (async (): Promise<RefreshOutcome> => {
      if (!client) return { generation, status: "applied" };
      try {
        const nextDashboard = await client.dashboard();
        if (generation !== refreshGeneration.current) {
          return { generation, status: "superseded" };
        }
        if (mode === "sites" && "systemStatus" in client) {
          const nextSitesStatus = await (
            client as SitesLifeConsoleClient
          ).systemStatus();
          if (generation !== refreshGeneration.current) {
            return { generation, status: "superseded" };
          }
          setSitesStatus(nextSitesStatus);
        }
        setDashboard(nextDashboard);
        setError(false);
        return { generation, status: "applied" };
      } catch {
        if (generation !== refreshGeneration.current) {
          return { generation, status: "superseded" };
        }
        setError(true);
        return { generation, status: "failed" };
      }
    })();
    latestRefresh.current = { generation, promise };
    return promise;
  }

  async function refreshAfterWrite(): Promise<boolean> {
    let outcome = await refresh();
    while (true) {
      const latest = latestRefresh.current;
      if (latest && latest.generation > outcome.generation) {
        outcome = await latest.promise;
        continue;
      }
      if (outcome.status === "superseded") {
        outcome = await refresh();
        continue;
      }
      return outcome.status === "applied";
    }
  }

  useEffect(() => {
    void refresh();
  }, [client]);

  useEffect(() => {
    if (!supabaseMode || !client) return;
    const refreshWhenFocused = () => void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener("focus", refreshWhenFocused);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenFocused);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [client, supabaseMode]);

  function blockCandidateWrite(
    event: MouseEvent<HTMLDivElement> | FormEvent<HTMLDivElement>,
  ) {
    if (mode !== "candidate-preview") return;
    const target = event.target as HTMLElement;
    const writeControl = target.closest(
      "form button[type='submit'], button.danger, [data-write-control]",
    );
    if (!writeControl) return;
    event.preventDefault();
    event.stopPropagation();
    setCandidateNotice(true);
  }

  if (!dashboard) {
    const remoteMode = mode === "sites" || supabaseMode;
    return (
      <main className="startup-state">
        <h1>
          {error
            ? remoteMode ? "私有工作台暂不可用" : "本地服务暂不可用"
            : remoteMode ? "正在读取你的工作台" : "正在读取本机工作台"}
        </h1>
        {error && <button onClick={() => void refresh()}>重试</button>}
      </main>
    );
  }

  const pages = {
    today: (
      <TodayPage
        dashboard={dashboard}
        client={mode === "candidate-preview" ? undefined : client}
        mode={mode}
        draftScope={supabase?.session.userId}
        dailyNews={dailyNews}
        dashboardMessages={dashboardMessages ?? supabase?.dashboardMessages}
        onNavigate={setActivePage}
        onSaved={refreshAfterWrite}
        sourceTruth={sitesStatus?.source_truth}
        todos={todos ?? supabase?.todos}
      />
    ),
    progress: (
      <ProgressPage
        dashboard={dashboard}
        goals={supabase?.goals}
        health={supabase?.health}
        mode={mode}
        onSaved={refreshAfterWrite}
        draftScope={supabase?.session.userId}
      />
    ),
    records: (
      <RecordsPage
        dashboard={dashboard}
        dailyCheckins={supabase?.dailyCheckins}
        client={mode === "candidate-preview" ? undefined : client}
        mode={mode}
        onSaved={refreshAfterWrite}
        draftScope={supabase?.session.userId}
        supabasePanels={supabaseMode && supabase ? (
          <div className="supabase-candidate-stack">
            <SupabaseJournalsPanel
              draftScope={supabase.session.userId}
              onSaved={refreshAfterWrite}
              reloadToken={dashboard.source_revisions.journal ?? ""}
              repository={supabase.journals}
              showCreate={false}
            />
            <SupabaseReviewsPanel
              draftScope={supabase.session.userId}
              repository={supabase.reviews}
            />
          </div>
        ) : undefined}
      />
    ),
    system: (
      <SystemPage
        client={mode === "sites" ? client as SitesLifeConsoleClient : undefined}
        dashboard={dashboard}
        mode={mode}
        onSignOut={supabase?.signOut}
        ownerSession={supabase?.session}
        backups={supabase?.backups}
        sitesStatus={sitesStatus}
      />
    ),
  };

  return (
    <AppShell
      activePage={activePage}
      date={dashboard.date}
      mode={mode}
      onNavigate={setActivePage}
    >
      {error && (
        <div className="service-banner" role="alert">
          {mode === "sites" || supabaseMode ? "私有工作台" : "本地服务"}暂不可用；页面保留上次已读取的状态，不会把新操作误报为已保存。
          <button onClick={() => void refresh()} type="button">重试</button>
        </div>
      )}
      {mode === "candidate-preview" && (
        <>
          <div className="service-banner service-banner--candidate" role="status">
            合成候选预览：不绑定真实数据或存储
          </div>
          {stageAPocEnabled && <StageAPocPanel />}
        </>
      )}
      {mode === "supabase-candidate" && (
        <div
          aria-label="私有候选边界"
          className="service-banner service-banner--candidate"
          role="status"
        >
          Life Console · 数据已迁移 · 生产环境
        </div>
      )}
      {mode === "supabase-production" && (
        <div
          aria-label="线上唯一真相源"
          className="service-banner"
          role="status"
        >
          Life Console · Supabase 唯一真相源 · iCloud 单向备份
        </div>
      )}
      <div
        className={mode === "candidate-preview" ? "candidate-preview" : undefined}
        onClickCapture={blockCandidateWrite}
        onSubmitCapture={blockCandidateWrite}
      >
        {pages[activePage]}
      </div>
      {candidateNotice && (
        <div
          aria-label="候选预览提示"
          className="candidate-toast"
          role="status"
        >
          只读预览模式：候选不可写
        </div>
      )}
    </AppShell>
  );
}
