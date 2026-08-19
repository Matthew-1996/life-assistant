import type { ReactNode } from "react";

import type { LifeConsoleClient } from "../../api/client";
import type { Dashboard } from "../../data/dashboard";
import { journalNormalizationFields } from "../../journal/normalization-contract";
import type { DailyCheckinRepositoryPort } from "../../supabase/daily-checkins";
import { ConversationRecordPanel } from "./ConversationRecordPanel";

type RecordsMode = "local" | "sites" | "candidate-preview" | "supabase-candidate" | "supabase-production";

interface RecordsPageProps {
  dashboard: Dashboard;
  client?: LifeConsoleClient;
  mode?: RecordsMode;
  onSaved?: () => boolean | Promise<boolean>;
  dailyCheckins?: DailyCheckinRepositoryPort;
  supabasePanels?: ReactNode;
  draftScope?: string;
}

export function RecordsPage({
  dashboard,
  client,
  mode = "local",
  onSaved,
  supabasePanels,
  draftScope = "anonymous",
}: RecordsPageProps) {
  const supabaseMode = mode === "supabase-candidate" || mode === "supabase-production";
  const production = mode === "supabase-production";
  const saveTarget = mode === "candidate-preview"
    ? "候选预览"
    : supabaseMode
      ? production ? "线上数据库" : "Supabase 候选环境"
      : mode === "sites" ? "云端真相源" : "iCloud";

  return (
    <section
      aria-labelledby="records-title"
      data-journal-normalization-fields={journalNormalizationFields.length}
    >
      <header className="hero capture-hero">
        <div>
          <p className="eyebrow">记录，不打断生活</p>
          <h1 id="records-title">轻量记录，明确保存。</h1>
          <p className="lead">
            {production
              ? "对话记录、日记与复盘保存到线上数据库；失败时保留当前浏览器草稿。"
              : supabaseMode
                ? "记录页只保留对话记录、日记与修订、周复盘和阶段复盘。"
                : "用一句话留下原始记录；日记整理与修订按需展开，不重复录入状态。"}
          </p>
        </div>
        <aside className="card hero-card">
          <span className="status blue">写入语义</span>
          <h2>草稿不会自动生效</h2>
          <p className="quiet">
            {production
              ? "只有明确点击保存且线上返回成功才算已记录；冲突或失败时输入继续保留。"
              : supabaseMode
                ? "只有明确点击保存才写入独立测试库；冲突或失败时输入继续保留。"
                : mode === "candidate-preview"
                  ? "当前只展示合成数据；写入不会触达任何私人真相源。"
                  : `只有保存成功才算写入${saveTarget}。`}
          </p>
          <div className="pill-row">
            <span className="pill">草稿</span>
            <span className="pill">明确保存</span>
            <span className="pill">{supabaseMode ? "Owner-only" : "私人记录"}</span>
          </div>
        </aside>
      </header>

      <section className="records-composer" aria-label="记录输入">
        <ConversationRecordPanel
          client={client}
          dashboard={dashboard}
          draftScope={draftScope}
          mode={mode}
          onSaved={onSaved}
          saveTarget={saveTarget}
        />
      </section>

      {supabaseMode && supabasePanels && (
        <section
          className="section supabase-records-workspace"
          aria-label={production ? "线上记录工作区" : "候选记录工作区"}
        >
          <div className="section-head">
            <div>
              <p className="eyebrow">OWNER WORKSPACE</p>
              <h2>{production ? "线上记录与修订" : "已开放的候选记录"}</h2>
              <p className="quiet">日记与复盘分别保留真实空态、修订和失败反馈。</p>
            </div>
            <span className="status blue">{production ? "线上唯一真相源" : "纯合成数据"}</span>
          </div>
          {supabasePanels}
        </section>
      )}
    </section>
  );
}
