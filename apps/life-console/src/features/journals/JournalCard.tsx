import { useState } from "react";

import type { Journal, JournalRevision } from "../../supabase/journals";
import { JournalStructuredView } from "./JournalStructuredView";

const statusLabels = {
  completed: "整理完成",
  failed: "整理失败，原文已保存",
  legacy: "历史记录",
  pending: "等待整理",
  processing: "正在整理",
  stale: "等待重新整理",
} as const;

interface JournalCardProps {
  busy: boolean;
  journal: Journal;
  revisions: JournalRevision[];
  revisionsLoading: boolean;
  onDelete(): void;
  onEdit(): void;
  onLoadRevisions(): void;
}

export function JournalCard({
  busy,
  journal,
  onDelete,
  onEdit,
  onLoadRevisions,
  revisions,
  revisionsLoading,
}: JournalCardProps) {
  const [assistantExpanded, setAssistantExpanded] = useState(false);
  const [revisionsExpanded, setRevisionsExpanded] = useState(false);
  const title = journal.title || "无标题日记";
  const normalizationStatus = journal.normalization_status ?? "legacy";

  return (
    <article aria-label={title} className="journal-card-250">
      <header className="journal-card-250__head">
        <div>
          <strong>{title}</strong>
          <time dateTime={journal.event_date}>{journal.event_date}</time>
        </div>
        <span className={`status ${normalizationStatus === "completed" ? "blue" : "gray"}`}>
          {statusLabels[normalizationStatus]}
        </span>
      </header>
      <section className="journal-card-250__raw" aria-label="用户原话">
        <p>{journal.content}</p>
      </section>
      <div className="journal-card-250__folds">
        <button className="journal-fold-button" onClick={() => setAssistantExpanded((value) => !value)} type="button">
          {assistantExpanded ? "收起助手整理" : "展开助手整理"}
        </button>
        {assistantExpanded && <JournalStructuredView assistantOnly journal={journal} />}
        <button aria-label={revisionsExpanded ? `收起 ${title} 修订` : `查看 ${title} 修订`} className="journal-fold-button" onClick={() => {
          const next = !revisionsExpanded;
          setRevisionsExpanded(next);
          if (next) onLoadRevisions();
        }} type="button">{revisionsExpanded ? "收起修订历史" : "修订历史"}</button>
        {revisionsExpanded && (
          <div className="journal-revisions-250">
            {revisionsLoading ? <p>正在读取修订历史…</p> : revisions.length === 0 ? (
              <p>没有修订历史。</p>
            ) : <ul>{revisions.map((revision) => (
              <li key={revision.id}>revision #{revision.revision} · {revision.reason ?? "update"}</li>
            ))}</ul>}
          </div>
        )}
      </div>
      <div className="button-row">
        <button aria-label={`编辑 ${title}`} className="secondary-button" disabled={busy} onClick={onEdit} type="button">编辑</button>
        <button aria-label="删除日记" className="secondary-button danger" disabled={busy} onClick={onDelete} type="button">删除</button>
      </div>
    </article>
  );
}
