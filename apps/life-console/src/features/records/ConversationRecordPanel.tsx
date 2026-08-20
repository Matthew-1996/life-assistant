import { type FormEvent, useRef, useState } from "react";

import type { LifeConsoleClient } from "../../api/client";
import type { Dashboard } from "../../data/dashboard";
import { useSessionDraft } from "../../hooks/useSessionDraft";
import { SESSION_DRAFT_STORAGE_PREFIX } from "../../lib/draft-storage";

type JournalInput = Parameters<LifeConsoleClient["journal"]>[0];
type RecordsMode = "local" | "sites" | "candidate-preview" | "supabase-candidate" | "supabase-production";

interface ConversationDraft {
  fingerprint: string | null;
  idempotencyKey: string | null;
  text: string;
}

interface CandidateJournalClient extends LifeConsoleClient {
  journalWithIdempotency(
    input: JournalInput,
    idempotencyKey: string,
  ): ReturnType<LifeConsoleClient["journal"]>;
}

interface ConversationRecordPanelProps {
  client?: LifeConsoleClient;
  dashboard: Dashboard;
  draftScope: string;
  mode: RecordsMode;
  onSaved?: () => boolean | Promise<boolean>;
  saveTarget: string;
}

const EMPTY_DRAFT: ConversationDraft = {
  fingerprint: null,
  idempotencyKey: null,
  text: "",
};

function compactLine(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maximum
    ? `${normalized.slice(0, maximum - 1).trimEnd()}…`
    : normalized;
}

function firstSentence(value: string, maximum: number): string {
  const first = value.split(/[。！？\n]/, 1)[0]
    .replace(/^(?:记录一下|日记(?:记录)?)[：:,，\s]*/, "");
  return compactLine(first || "一则生活记录", maximum);
}

function supportsExplicitJournalKey(
  client: LifeConsoleClient,
): client is CandidateJournalClient {
  return "journalWithIdempotency" in client
    && typeof client.journalWithIdempotency === "function";
}

function recordsJournalKey(): string {
  return `records_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function ConversationRecordPanel({
  client,
  dashboard,
  draftScope,
  mode,
  onSaved,
  saveTarget,
}: ConversationRecordPanelProps) {
  const supabaseMode = mode === "supabase-candidate" || mode === "supabase-production";
  const {
    persist,
    ready,
    setValue: setDraft,
    value: draft,
  } = useSessionDraft(
    `${SESSION_DRAFT_STORAGE_PREFIX}${draftScope}:records-conversation-v2`,
    EMPTY_DRAFT,
    (value) => !supabaseMode || (
      value.text === ""
      && value.fingerprint === null
      && value.idempotencyKey === null
    ),
  );
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const text = draft.text.trim();
    if (!text) return;
    setReceipt(null);

    if (!client) {
      setReceipt(`合成演示已完成；未写入真实${saveTarget}`);
      await persist(EMPTY_DRAFT);
      return;
    }

    const fact = firstSentence(text, 180);
    const title = firstSentence(text, 120);
    const input: JournalInput = supabaseMode ? {
      schema_version: 1,
      event_date: dashboard.date,
      event_time: null,
      time_precision: "unknown",
      text,
    } : {
      schema_version: 1,
      event_date: dashboard.date,
      event_time: null,
      time_precision: "unknown",
      text,
      title,
      summary: compactLine(fact, 240),
      facts: [fact],
      feelings: [],
      people: [],
      places: [],
      themes: [],
      tags: [],
    };

    savingRef.current = true;
    setSaving(true);
    try {
      let result;
      if (supabaseMode && supportsExplicitJournalKey(client)) {
        const fingerprint = JSON.stringify(input);
        const idempotencyKey = draft.idempotencyKey
          && draft.fingerprint === fingerprint
          ? draft.idempotencyKey
          : recordsJournalKey();
        await persist({ fingerprint, idempotencyKey, text: draft.text });
        result = await client.journalWithIdempotency(input, idempotencyKey);
      } else {
        result = await client.journal(input);
      }
      await persist(EMPTY_DRAFT);

      let autoEnriched = false;
      if (mode === "local") {
        try {
          const latest = await client.dashboard();
          const newest = latest.records.recent_journals.find(
            (item) => item.date === dashboard.date && item.title === title,
          );
          if (newest) {
            await client.enrichNow(newest.id);
            autoEnriched = true;
          }
        } catch {
          // 原文已经成功保存；整理失败不会回滚记录。
        }
      }

      setReceipt(
        supabaseMode
          ? result.message
          : mode === "sites"
            ? "已保存到云端真相源；iCloud 冷备已进入队列"
            : autoEnriched
              ? "已保存到 iCloud，正在用 DeepSeek 整理…"
              : "已保存到 iCloud（云端整理未启动，可稍后在日记卡中查看）",
      );
      await onSaved?.();
    } catch {
      setReceipt("保存失败，请保留当前内容并重试");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <section className="card conversation-card" aria-label="对话式记录面板">
        <form onSubmit={(event) => void save(event)}>
          <div className="card-header">
            <div>
              <h2 className="card-title">对话式记录</h2>
              <p className="card-desc">一句话也可以；只有明确保存成功才算已记录。</p>
            </div>
            <span className="status blue">主入口</span>
          </div>
          <label className="sr-only" htmlFor="capture-text">直接描述想记录的内容</label>
          <div className="input-wrap">
            <textarea
              className="capture-textarea"
              disabled={saving || (supabaseMode && !ready)}
              id="capture-text"
              onChange={(event) => setDraft((current) => ({
                ...current,
                text: event.target.value,
              }))}
              placeholder="例如：今天只做了 5 分钟最低版，身体感觉稳定。"
              value={draft.text}
            />
            <div className="input-hint">
              <span>保存前不写入，不覆盖，不同步外部展示。</span>
              <span className="mono">{draft.text.trim().length} 字</span>
            </div>
          </div>
          <div className="actions">
            <div className="button-row">
              <button
                className="button primary"
                data-readonly={mode === "candidate-preview"}
                disabled={saving || !draft.text.trim() || (supabaseMode && !ready)}
                type="submit"
              >
                {saving ? "保存中…" : `保存到 ${saveTarget}`}
              </button>
            </div>
            <span className="caption">默认不发布原文</span>
          </div>
        </form>
      </section>
      {receipt && <p className="save-receipt" role="status">{receipt}</p>}
    </>
  );
}
