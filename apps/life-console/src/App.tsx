import {
  type FormEvent,
  type MouseEvent,
  useEffect,
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
import { SystemPage } from "./features/system/SystemPage";
import { TodayPage } from "./features/today/TodayPage";

interface AppProps {
  client?: LifeConsoleClient;
  initialDashboard?: Dashboard;
  mode?: "local" | "sites" | "candidate-preview";
}

export function App({ client, initialDashboard, mode = "local" }: AppProps) {
  const [activePage, setActivePage] = useState<PageId>("today");
  const [dashboard, setDashboard] = useState<Dashboard | null>(
    initialDashboard ?? (client ? null : syntheticDashboard),
  );
  const [sitesStatus, setSitesStatus] = useState<SitesSystemStatus | null>(null);
  const [error, setError] = useState(false);
  const [candidateNotice, setCandidateNotice] = useState(false);

  async function refresh(): Promise<boolean> {
    if (!client) return true;
    try {
      const nextDashboard = await client.dashboard();
      setDashboard(nextDashboard);
      if (mode === "sites" && "systemStatus" in client) {
        setSitesStatus(
          await (client as SitesLifeConsoleClient).systemStatus(),
        );
      }
      setError(false);
      return true;
    } catch {
      setError(true);
      return false;
    }
  }

  useEffect(() => {
    void refresh();
  }, [client]);

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
    return (
      <main className="startup-state">
        <h1>
          {error
            ? mode === "sites" ? "云端服务暂不可用" : "本地服务暂不可用"
            : mode === "sites" ? "正在读取云端工作台" : "正在读取本机工作台"}
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
        onNavigate={setActivePage}
        onSaved={refresh}
        sourceTruth={sitesStatus?.source_truth}
      />
    ),
    progress: (
      <ProgressPage
        client={mode === "sites" ? client as SitesLifeConsoleClient : undefined}
        dashboard={dashboard}
        mode={mode}
      />
    ),
    records: (
      <RecordsPage
        dashboard={dashboard}
        client={mode === "candidate-preview" ? undefined : client}
        mode={mode}
        onSaved={refresh}
      />
    ),
    system: (
      <SystemPage
        client={mode === "sites" ? client as SitesLifeConsoleClient : undefined}
        dashboard={dashboard}
        mode={mode}
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
          {mode === "sites" ? "云端服务" : "本地服务"}暂不可用；页面保留上次已读取的状态，不会把新操作误报为已保存。
          <button onClick={() => void refresh()} type="button">重试</button>
        </div>
      )}
      {mode === "candidate-preview" && (
        <div className="service-banner service-banner--candidate" role="status">
          只读预览模式：候选不可写
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
