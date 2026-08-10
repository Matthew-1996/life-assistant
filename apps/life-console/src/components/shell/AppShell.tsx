import type { ReactNode } from "react";

export type PageId = "today" | "progress" | "records" | "system";

const navigation: Array<{
  id: PageId;
  label: string;
}> = [
  { id: "today", label: "工作台" },
  { id: "records", label: "记录" },
  { id: "progress", label: "进展" },
  { id: "system", label: "系统" },
];

interface AppShellProps {
  activePage: PageId;
  date: string;
  children: ReactNode;
  onNavigate: (page: PageId) => void;
}

export function AppShell({
  activePage,
  date,
  children,
  onNavigate,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="global-nav topbar">
        <div className="topbar-inner">
          <button
            aria-label={`Life Console Trial Week，${date}`}
            className="brand"
            onClick={() => onNavigate("today")}
            type="button"
          >
            <span className="brand-mark" aria-hidden="true" />
            <span>Life Console · Trial Week</span>
          </button>

          <nav aria-label="全局导航">
            {navigation.map((item) => (
              <button
                aria-current={activePage === item.id ? "page" : undefined}
                className="nav-item"
                data-active={activePage === item.id}
                key={item.id}
                onClick={() => onNavigate(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="workspace">
        <main className="page-content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
