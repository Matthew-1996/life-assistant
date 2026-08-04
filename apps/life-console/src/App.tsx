import { useState } from "react";

import { AppShell, type PageId } from "./components/shell/AppShell";
import { syntheticDashboard } from "./data/dashboard";
import { ProgressPage } from "./features/progress/ProgressPage";
import { RecordsPage } from "./features/records/RecordsPage";
import { SystemPage } from "./features/system/SystemPage";
import { TodayPage } from "./features/today/TodayPage";

export function App() {
  const [activePage, setActivePage] = useState<PageId>("today");

  const pages = {
    today: <TodayPage dashboard={syntheticDashboard} />,
    progress: <ProgressPage dashboard={syntheticDashboard} />,
    records: <RecordsPage dashboard={syntheticDashboard} />,
    system: <SystemPage dashboard={syntheticDashboard} />,
  };

  return (
    <AppShell
      activePage={activePage}
      date={syntheticDashboard.date}
      onNavigate={setActivePage}
    >
      {pages[activePage]}
    </AppShell>
  );
}
