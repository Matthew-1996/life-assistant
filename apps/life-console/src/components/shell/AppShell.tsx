import type { ReactNode } from "react";

export type PageId = "today" | "progress" | "records" | "system";

const navigation: Array<{ id: PageId; label: string; hint: string }> = [
  { id: "today", label: "今日", hint: "当前重点与锚点" },
  { id: "progress", label: "进展", hint: "计划与近期信号" },
  { id: "records", label: "记录", hint: "对话与简洁表单" },
  { id: "system", label: "系统", hint: "本机保存状态" },
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
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <div>
            <strong>Life Console</strong>
            <span>Mac 本机工作站</span>
          </div>
        </div>

        <nav aria-label="主导航">
          {navigation.map((item) => (
            <button
              className="nav-item"
              data-active={activePage === item.id}
              key={item.id}
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </nav>

        <p className="privacy-note">
          数据保存在本机 iCloud 项目中。页面不持久化日记正文。
        </p>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="topbar-date">{date}</span>
            <span className="status-dot">
              <i aria-hidden="true" />
              本机可用
            </span>
          </div>
          <button
            className="primary-button"
            onClick={() => onNavigate("records")}
            type="button"
          >
            快速记录
          </button>
        </header>
        <main className="page-content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
