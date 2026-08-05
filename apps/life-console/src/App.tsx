import { useEffect, useState } from "react";

import type { LifeConsoleClient } from "./api/client";
import { AppShell, type PageId } from "./components/shell/AppShell";
import { syntheticDashboard, type Dashboard } from "./data/dashboard";
import { ProgressPage } from "./features/progress/ProgressPage";
import { RecordsPage } from "./features/records/RecordsPage";
import { SystemPage } from "./features/system/SystemPage";
import { TodayPage } from "./features/today/TodayPage";

interface AppProps {
  client?: LifeConsoleClient;
  initialDashboard?: Dashboard;
}

export function App({ client, initialDashboard }: AppProps) {
  const [activePage, setActivePage] = useState<PageId>("today");
  const [dashboard, setDashboard] = useState<Dashboard | null>(
    initialDashboard ?? (client ? null : syntheticDashboard),
  );
  const [error, setError] = useState(false);

  async function refresh() {
    if (!client) return;
    try {
      setDashboard(await client.dashboard());
      setError(false);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    void refresh();
  }, [client]);

  if (!dashboard) {
    return (
      <main className="startup-state">
        <h1>{error ? "本地服务暂不可用" : "正在读取本机工作台"}</h1>
        {error && <button onClick={() => void refresh()}>重试</button>}
      </main>
    );
  }

  const pages = {
    today: <TodayPage dashboard={dashboard} client={client} onSaved={refresh} />,
    progress: <ProgressPage dashboard={dashboard} />,
    records: <RecordsPage dashboard={dashboard} client={client} onSaved={refresh} />,
    system: <SystemPage dashboard={dashboard} />,
  };

  return (
    <AppShell
      activePage={activePage}
      date={dashboard.date}
      onNavigate={setActivePage}
    >
      {pages[activePage]}
    </AppShell>
  );
}
