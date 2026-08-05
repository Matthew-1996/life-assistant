import type { ReactNode } from "react";

export type PageId = "today" | "progress" | "records" | "system";

type IconName = "life" | PageId;

const navigation: Array<{
  id: PageId;
  label: string;
  hint: string;
  icon: IconName;
}> = [
  { id: "today", label: "今日", hint: "当前重点与锚点", icon: "today" },
  { id: "progress", label: "进展", hint: "计划与近期信号", icon: "progress" },
  { id: "records", label: "记录", hint: "对话与简洁表单", icon: "records" },
  { id: "system", label: "系统", hint: "本机保存状态", icon: "system" },
];

const iconPaths: Record<IconName, ReactNode> = {
  life: (
    <>
      <path d="M4 12h3l2-5 3.5 10 2.5-6 1.5 3H20" />
      <path d="M12 3a9 9 0 1 1-8.2 5.3" />
    </>
  ),
  today: (
    <>
      <path d="M5 6.5h14v12H5z" />
      <path d="M8 4v4M16 4v4M5 10h14" />
      <path d="m9 14 2 2 4-4" />
    </>
  ),
  progress: (
    <>
      <path d="M5 19V9M12 19V5M19 19v-7" />
      <path d="m4 7 5-3 4 3 7-5" />
    </>
  ),
  records: (
    <>
      <path d="M6 3.5h9l3 3V20H6z" />
      <path d="M15 3.5V7h3M9 11h6M9 15h6" />
    </>
  ),
  system: (
    <g transform="translate(0.5, 0.5)">
      <circle cx="12" cy="12" r="3" />
      <path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.7-1.6l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.7-.7L10.8 2h-3l-.7 2.1a7 7 0 0 0-1.6.7l-2-.9-2 2.1.9 1.9a7 7 0 0 0-.7 1.6L0 10.2v3l2 .7a7 7 0 0 0 .7 1.6l-.9 1.9 2.1 2.1 1.9-.9a7 7 0 0 0 1.6.7l.7 2.1h3l.7-2.1a7 7 0 0 0 1.6-.7l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .7-1.6z" transform="translate(2.2 .3) scale(.82)" />
    </g>
  ),
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      className="app-icon"
      data-icon={name}
      fill="none"
      viewBox="0 0 24 24"
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {iconPaths[name]}
      </g>
    </svg>
  );
}

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
            <Icon name="life" />
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
              <span className="nav-icon" aria-hidden="true">
                <Icon name={item.icon} />
              </span>
              <span className="nav-copy">
                <span>{item.label}</span>
                <small>{item.hint}</small>
              </span>
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
