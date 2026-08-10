import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createApiClient } from "./api/client";
import type { Dashboard } from "./data/dashboard";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Life Console root element is missing");
}

function isDashboard(value: unknown): value is Dashboard {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Dashboard>;
  return candidate.schema_version === 1
    && typeof candidate.generated_at === "string"
    && typeof candidate.date === "string"
    && Boolean(candidate.today)
    && Boolean(candidate.progress)
    && Boolean(candidate.records)
    && Boolean(candidate.system);
}

function SitesApp() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/life-console-snapshot.json", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("snapshot unavailable");
        const payload: unknown = await response.json();
        if (!isDashboard(payload)) throw new Error("snapshot invalid");
        if (!cancelled) setDashboard(payload);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!dashboard) {
    return (
      <main className="startup-state">
        <h1>{failed ? "线上快照暂不可用" : "正在读取私人生活工作台"}</h1>
        <p>{failed ? "请稍后刷新；本地 iCloud 数据不受影响。" : "仅本人可访问的只读版本。"}</p>
      </main>
    );
  }
  return <App initialDashboard={dashboard} mode="sites-readonly" />;
}

const content = import.meta.env.MODE === "sites"
  ? <SitesApp />
  : <App client={createApiClient()} mode="local" />;

createRoot(root).render(
  <StrictMode>
    {content}
  </StrictMode>,
);
