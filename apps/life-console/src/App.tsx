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
  mode?: "local" | "sites-readonly" | "demo";
}

export function App({ client, initialDashboard, mode = client ? "local" : "demo" }: AppProps) {
  const [activePage, setActivePage] = useState<PageId>("today");
  const [dashboard, setDashboard] = useState<Dashboard | null>(
    initialDashboard ?? (client ? null : syntheticDashboard),
  );
  const [error, setError] = useState(false);

  async function refresh(): Promise<boolean> {
    if (!client) return true;
    try {
      setDashboard(await client.dashboard());
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

  if (!dashboard) {
    return (
      <main className="startup-state">
        <h1>{error ? "本地服务暂不可用" : "正在读取本机工作台"}</h1>
        {error && <button onClick={() => void refresh()}>重试</button>}
      </main>
    );
  }

  const pages = {
    today: (
      <TodayPage
        dashboard={dashboard}
        client={client}
        readOnly={mode === "sites-readonly"}
        onNavigate={setActivePage}
        onSaved={refresh}
      />
    ),
    progress: <ProgressPage dashboard={dashboard} />,
    records: (
      <RecordsPage
        dashboard={dashboard}
        client={client}
        readOnly={mode === "sites-readonly"}
        onSaved={refresh}
      />
    ),
    system: <SystemPage dashboard={dashboard} onlineReadOnly={mode === "sites-readonly"} />,
  };

  return (
    <AppShell
      activePage={activePage}
      date={dashboard.date}
      onNavigate={setActivePage}
    >
      {mode === "sites-readonly" && (
        <div className="service-banner service-banner--readonly" role="status">
          私人线上只读版 · 数据更新于 {new Date(dashboard.generated_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}。记录和修改继续通过对话或本机版完成。
        </div>
      )}
      {error && (
        <div className="service-banner" role="alert">
          本地服务暂不可用；页面保留上次已读取的状态，不会把新操作误报为已保存。
          <button onClick={() => void refresh()} type="button">重试</button>
        </div>
      )}
      {pages[activePage]}
    </AppShell>
  );
}
