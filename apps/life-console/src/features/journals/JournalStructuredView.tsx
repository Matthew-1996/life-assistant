import type { ReactElement, ReactNode } from "react";

import type { JournalNormalization } from "../../journal/normalization-contract";
import type { Journal } from "../../supabase/journals";

const statusLabels = {
  completed: "整理完成",
  failed: "整理失败，原文已保存",
  legacy: "历史记录，尚未按统一契约整理",
  pending: "等待整理",
  processing: "正在整理",
  stale: "原文已更新，等待重新整理",
} as const;

function normalizedMetadata(journal: Journal): JournalNormalization | null {
  const metadata = journal.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const value = metadata as Partial<JournalNormalization>;
  return typeof value.summary === "string"
    && Array.isArray(value.facts)
    && Array.isArray(value.feelings)
    && Array.isArray(value.people)
    && Array.isArray(value.places)
    && Array.isArray(value.themes)
    && Array.isArray(value.planning_clues)
    && Array.isArray(value.inferences)
    && Array.isArray(value.tags)
    ? value as JournalNormalization
    : null;
}

function section(title: string, content: ReactNode): ReactElement {
  return (
    <section className="journal-structured-section">
      <h4>{title}</h4>
      {content}
    </section>
  );
}

function textList(values: readonly string[]): ReactElement {
  return values.length === 0
    ? <p className="quiet">未记录</p>
    : <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul>;
}

function evidenceList(
  values: readonly { text: string }[],
): ReactElement {
  return textList(values.map((value) => value.text));
}

export function JournalStructuredView({
  journal,
}: {
  journal: Journal;
}): ReactElement {
  const metadata = normalizedMetadata(journal);
  const displayTitle = journal.title || metadata?.title || "无标题日记";
  const status = journal.normalization_status ?? "legacy";
  const people = metadata?.people ?? [];

  return (
    <article aria-label={displayTitle} className="journal-structured-view">
      <header className="supabase-journal-summary">
        <div>
          <strong>{displayTitle}</strong>
          <span>{journal.event_date}</span>
        </div>
        <span className={`status ${status === "completed" ? "blue" : "gray"}`}>
          {statusLabels[status]}
        </span>
      </header>
      {section("用户原话", (
        <p className="journal-raw-text">{journal.content}</p>
      ))}
      <div aria-label="助手整理" className="journal-normalized-sections">
        {section("摘要", (
          <p>{metadata?.summary || "未记录"}</p>
        ))}
        {section("明确事实", evidenceList(metadata?.facts ?? []))}
        {section("明确感受", evidenceList(metadata?.feelings ?? []))}
        {section("人物", people.length === 0 ? (
          <p className="quiet">未记录</p>
        ) : (
          <ul>
            {people.map((person) => (
              <li key={`${person.text}:${person.evidence}`}>
                {person.text}
                {person.relation ? `（${person.relation}）` : ""}
                {person.basis === "confirmed_profile"
                  ? " · 关系来自已确认个人档案"
                  : ""}
              </li>
            ))}
          </ul>
        ))}
        {section("地点或场景", evidenceList(metadata?.places ?? []))}
        {section("生活主题", textList(metadata?.themes ?? []))}
        {section("可能的规划线索", evidenceList(metadata?.planning_clues ?? []))}
        {section("待用户确认的推测", evidenceList(metadata?.inferences ?? []))}
        {section("标签", textList(metadata?.tags ?? journal.tags ?? []))}
      </div>
    </article>
  );
}
