import type { ReactNode } from "react";

export type PageId = "today" | "progress" | "records" | "system";

const navigation: Array<{
  id: PageId;
  label: string;
  hint: string;
}> = [
  { id: "today", label: "工作台", hint: "今天" },
  { id: "records", label: "记录", hint: "写入" },
  { id: "progress", label: "进展", hint: "趋势" },
  { id: "system", label: "系统", hint: "边界" },
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
      <header className="global-nav">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          <div>
            <strong>Life Console</strong>
            <span>{date}</span>
          </div>
        </div>

        <nav aria-label="全局导航">
          {navigation.map((item) => (
            <button
              className="nav-item"
              data-active={activePage === item.id}
              key={item.id}
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              <span className="nav-copy">
                <span>{item.label}</span>
                <small>{item.hint}</small>
              </span>
            </button>
          ))}
        </nav>

        <button
          className="primary-button nav-cta"
          onClick={() => onNavigate("records")}
          type="button"
        >
          快速记录
        </button>
      </header>

      <div className="workspace">
        <main className="page-content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
