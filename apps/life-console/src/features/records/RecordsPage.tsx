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

      {supabasePanels && (
        <section
          className="section supabase-records-workspace"
          aria-label={production
            ? "线上记录工作区"
            : mode === "candidate-preview"
              ? "合成记录工作区"
              : "候选记录工作区"}
        >
          <div className="section-head">
            <div>
              <p className="eyebrow">{mode === "candidate-preview" ? "SYNTHETIC JOURNALS" : "OWNER WORKSPACE"}</p>
              <h2>{production
                ? "线上记录与修订"
                : mode === "candidate-preview"
                  ? "日记记录"
                  : "已开放的候选记录"}</h2>
              <p className="quiet">{mode === "candidate-preview"
                ? "展示公开合成日记；编辑、删除与恢复只在当前页面内存中生效，刷新后重置，不触达私人数据。"
                : "日记与复盘分别保留真实空态、修订和失败反馈。"}</p>
            </div>
            <span className="status blue">{production
              ? "线上唯一真相源"
              : "纯合成数据"}</span>
          </div>
          {supabasePanels}
        </section>
      )}
    </section>
  );
}
