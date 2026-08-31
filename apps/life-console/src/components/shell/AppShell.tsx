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

function NavigationIcon({ page }: { page: PageId }) {
  const commonProps = {
    "aria-hidden": true,
    className: "nav-icon",
    fill: "none",
    focusable: "false" as const,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
  };

  if (page === "today") {
    return (
      <svg {...commonProps}>
        <path d="m3.5 10.5 8.5-7 8.5 7" />
        <path d="M5.5 9.5v10h13v-10M9.5 19.5v-6h5v6" />
      </svg>
    );
  }
  if (page === "records") {
    return (
      <svg {...commonProps}>
        <path d="M5 4.5h9.5a2 2 0 0 1 2 2v3" />
        <path d="M5 4.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
        <path d="m12.5 15.5 1.2-3.4 5.9-5.9 2.2 2.2-5.9 5.9-3.4 1.2Z" />
      </svg>
    );
  }
  if (page === "progress") {
    return (
      <svg {...commonProps}>
        <path d="M4 19.5h16" />
        <path d="M6.5 16v-4M12 16V8.5M17.5 16V5" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  );
}

interface AppShellProps {
  activePage: PageId;
  date: string;
  mode?: "local" | "sites" | "candidate-preview" | "supabase-candidate" | "supabase-production";
  children: ReactNode;
  onNavigate: (page: PageId) => void;
}

export function AppShell({
  activePage,
  date,
  mode = "local",
  children,
  onNavigate,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="global-nav topbar">
        <div className="topbar-inner">
          <button
            aria-label={`Life Console ${
              mode === "supabase-production"
                ? "Online"
                : mode === "supabase-candidate"
                ? "Supabase Candidate"
                : mode === "candidate-preview"
                ? "Candidate"
                : mode === "sites" ? "Cloud" : "Trial Week"
            }，${date}`}
            className="brand"
            onClick={() => onNavigate("today")}
            type="button"
          >
            <span className="brand-mark" aria-hidden="true" />
            <span>
              Life Console · {mode === "supabase-production"
                ? "Online"
                : mode === "supabase-candidate"
                ? "Supabase Candidate"
                : mode === "candidate-preview"
                ? "Candidate"
                : mode === "sites" ? "Cloud" : "Trial Week"}
            </span>
          </button>

          <div className="topbar-actions">
            {mode === "sites" && <span className="source-badge">Sites API</span>}
            {mode === "candidate-preview" && (
              <span className="source-badge source-badge--candidate">
                候选预览 · 合成数据
              </span>
            )}
            {mode === "supabase-candidate" && (
              <span className="source-badge source-badge--candidate">
                Supabase 测试 · 合成数据
              </span>
            )}
            {mode === "supabase-production" && (
              <span className="source-badge">Supabase · 在线</span>
            )}
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
                  <NavigationIcon page={item.id} />
                  <span className="nav-label">{item.label}</span>
                </button>
              ))}
            </nav>
          </div>
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
