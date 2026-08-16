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
                  {item.label}
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
