import {
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ApiError,
  type CapturePreview,
  type LifeConsoleClient,
} from "../../api/client";
import type { components } from "../../contracts/life-console";
import type { Dashboard } from "../../data/dashboard";
import { useSessionDraft } from "../../hooks/useSessionDraft";
import { SESSION_DRAFT_STORAGE_PREFIX } from "../../lib/draft-storage";
import type { DailyCheckinRepositoryPort } from "../../supabase/daily-checkins";

type FormMode = "journal" | "checkin";
type RecentJournal = Dashboard["records"]["recent_journals"][number];
type JournalInput = Parameters<LifeConsoleClient["journal"]>[0];

interface JournalRequestDraft {
  fingerprint: string | null;
  idempotencyKey: string | null;
}

interface ConversationDraft extends JournalRequestDraft {
  text: string;
}

interface SimpleFormsDraft {
  checkin: {
    date: string;
    energy: string;
    life_feeling: string;
    mood: string;
    sleep_quality: string;
  };
  journal: JournalRequestDraft & {
    date: string;
    event: string;
    feeling: string;
  };
}

function emptySimpleFormsDraft(date: string): SimpleFormsDraft {
  return {
    checkin: {
      date,
      energy: "",
      life_feeling: "",
      mood: "",
      sleep_quality: "",
    },
    journal: {
      date,
      event: "",
      feeling: "",
      fingerprint: null,
      idempotencyKey: null,
    },
  };
}

function simpleFormsDraftIsEmpty(draft: SimpleFormsDraft): boolean {
  return draft.journal.event === ""
    && draft.journal.feeling === ""
    && draft.journal.fingerprint === null
    && draft.journal.idempotencyKey === null
    && draft.checkin.energy === ""
    && draft.checkin.life_feeling === ""
    && draft.checkin.mood === ""
    && draft.checkin.sleep_quality === "";
}

const EMPTY_CONVERSATION_DRAFT: ConversationDraft = {
  fingerprint: null,
  idempotencyKey: null,
  text: "",
};

function journalFingerprint(input: JournalInput): string {
  return JSON.stringify(input);
}

function recordsJournalKey(): string {
  return `records_${crypto.randomUUID().replaceAll("-", "")}`;
}

interface CandidateJournalClient extends LifeConsoleClient {
  journalWithIdempotency(
    input: JournalInput,
    idempotencyKey: string,
  ): ReturnType<LifeConsoleClient["journal"]>;
}

function supportsExplicitJournalKey(
  client: LifeConsoleClient,
): client is CandidateJournalClient {
  return "journalWithIdempotency" in client
    && typeof client.journalWithIdempotency === "function";
}

interface RecordsPageProps {
  dashboard: Dashboard;
  client?: LifeConsoleClient;
  mode?: "local" | "sites" | "candidate-preview" | "supabase-candidate";
  onSaved?: () => boolean | Promise<boolean>;
  dailyCheckins?: DailyCheckinRepositoryPort;
  supabasePanels?: ReactNode;
  draftScope?: string;
}

const ratingFields = [
  ["sleep_quality", "睡眠质量"],
  ["energy", "精力"],
  ["mood", "情绪"],
  ["life_feeling", "生活实感"],
] as const;
const advancedCheckinFields = [
  ["sleep_time", "入睡", "time"],
  ["wake_time", "最终醒来", "time"],
  ["out_of_bed_time", "离床", "time"],
] as const;
const anchorFields = [
  ["wake", "起床"],
  ["body_light", "身体 / 光照"],
  ["life_action", "生活动作"],
  ["wind_down", "晚间降速"],
] as const;

const anchorContextLabels = {
  wake: "醒来",
  body_light: "身体 / 光照",
  life_action: "生活动作",
  wind_down: "晚间降速",
} as const;

const anchorStateLabels = {
  complete: "完成",
  minimum: "最低版",
  skipped: "跳过",
} as const;

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

function splitJournalList(value: FormDataEntryValue | null): string[] {
  return Array.from(new Set(String(value ?? "")
    .split(/[，,、\n]/)
    .map((item) => compactLine(item, 180))
    .filter(Boolean))).slice(0, 12);
}

type EnrichmentState = NonNullable<RecentJournal["enrichment_state"]>;

const STATE_LABELS: Record<EnrichmentState, string> = {
  raw: "原始记录",
  working: "整理中",
  enriched: "已整理",
  failed: "整理失败",
};

function JournalCard({
  journal,
  client,
  mode,
  onChanged,
}: {
  journal: RecentJournal;
  client?: LifeConsoleClient;
  mode: "local" | "sites" | "candidate-preview" | "supabase-candidate";
  onChanged?: () => boolean | Promise<boolean>;
}) {
  // 本地覆盖状态：卡片内触发整理/删除后立即反映，不必等下一次看板刷新。
  const [override, setOverride] = useState<EnrichmentState | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  const state: EnrichmentState = override ?? journal.enrichment_state ?? "raw";

  async function pollUntilSettled(): Promise<void> {
    if (!client) return;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      let status;
      try {
        status = await client.enrichmentByJournal(journal.id);
      } catch {
        continue;
      }
      if (status.status === "succeeded") {
        setOverride("enriched");
        await onChanged?.();
        return;
      }
      if (status.status === "failed") {
        setOverride("failed");
        return;
      }
    }
  }

  async function enrichNow() {
    setNote(null);
    if (!client) {
      setNote("合成演示：未联网，也未发送任何日记。");
      return;
    }
    setBusy(true);
    setOverride("working");
    try {
      await client.enrichNow(journal.id);
      await pollUntilSettled();
    } catch {
      setOverride("failed");
      setNote("云端整理未成功；本地记录未受影响，可再次点击整理。");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!client) {
      setRemoved(true);
      return;
    }
    setBusy(true);
    try {
      const result = await client.deleteJournal(journal.id);
      if (mode === "sites") {
        setNote(result.message);
        setConfirming(false);
      } else {
        setRemoved(true);
      }
      await onChanged?.();
    } catch {
      setNote("删除失败，请稍后重试。");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (removed) {
    return (
      <article className="journal-card journal-card--removed" aria-live="polite">
        <p className="supporting-text">已删除这条记录。</p>
      </article>
    );
  }

  return (
    <article className="journal-card">
      <div className="journal-card-head">
        <time>{journal.date}</time>
        <span className={`enrichment-badge enrichment-badge--${state}`}>
          {STATE_LABELS[state]}
        </span>
      </div>
      <strong>{journal.title}</strong>
      <p>{journal.summary}</p>
      <div className="journal-card-actions">
        {mode === "local" && (
          <button
            className="secondary-button"
            type="button"
            disabled={busy || state === "working"}
            onClick={() => void enrichNow()}
          >
            {state === "failed" ? "重新整理" : "整理"}
          </button>
        )}
        {mode !== "supabase-candidate" && (
          <button
            className="secondary-button danger"
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            删除
          </button>
        )}
      </div>
      {note && <p className="save-receipt" role="status">{note}</p>}
      {confirming && (
        <div className="confirm-dialog" role="alertdialog" aria-label="确认删除这条记录">
          <p>
            {mode === "sites"
              ? "将创建 7 天删除计划；计划期内可取消，不会立即永久删除。确认继续？"
              : "删除后这条日记将从当前项目移除（不影响聊天、旧备份与设备历史）。确认删除？"}
          </p>
          <div className="form-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
            <button
              className="primary-button danger"
              type="button"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              {mode === "sites" ? "创建删除计划" : "确认删除"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export function RecordsPage({
  dashboard,
  client,
  mode = "local",
  onSaved,
  dailyCheckins,
  supabasePanels,
  draftScope = "anonymous",
}: RecordsPageProps) {
  const supabaseCandidate = mode === "supabase-candidate";
  const saveTarget = mode === "candidate-preview"
    ? "候选预览"
    : supabaseCandidate
      ? "Supabase 候选环境"
      : mode === "sites" ? "云端真相源" : "iCloud";
  const [formMode, setFormMode] = useState<FormMode>("journal");
  const {
    persist: persistCaptureDraft,
    ready: captureReady,
    setValue: setCaptureDraft,
    value: captureDraft,
  } = useSessionDraft(
    `${SESSION_DRAFT_STORAGE_PREFIX}${draftScope}:records-conversation-v2`,
    EMPTY_CONVERSATION_DRAFT,
    (value) => !supabaseCandidate || (
      value.text === ""
      && value.fingerprint === null
      && value.idempotencyKey === null
    ),
  );
  const {
    persist: persistSimpleFormsDraft,
    ready: simpleFormsReady,
    setValue: setSimpleFormsDraft,
    value: simpleFormsDraft,
  } = useSessionDraft(
    `${SESSION_DRAFT_STORAGE_PREFIX}${draftScope}:records-simple-forms-v2`,
    emptySimpleFormsDraft(dashboard.date),
    (value) => !supabaseCandidate || simpleFormsDraftIsEmpty(value),
  );
  const captureText = captureDraft.text;

  useEffect(() => {
    if (!simpleFormsReady) return;
    setSimpleFormsDraft((current) => {
      const journalUntouched = current.journal.event === ""
        && current.journal.feeling === ""
        && current.journal.fingerprint === null
        && current.journal.idempotencyKey === null;
      const checkinUntouched = current.checkin.energy === ""
        && current.checkin.life_feeling === ""
        && current.checkin.mood === ""
        && current.checkin.sleep_quality === "";
      if (
        (!journalUntouched || current.journal.date === dashboard.date)
        && (!checkinUntouched || current.checkin.date === dashboard.date)
      ) return current;
      return {
        ...current,
        journal: journalUntouched
          ? { ...current.journal, date: dashboard.date }
          : current.journal,
        checkin: checkinUntouched
          ? { ...current.checkin, date: dashboard.date }
          : current.checkin,
      };
    });
  }, [dashboard.date, setSimpleFormsDraft, simpleFormsReady]);

  function setCaptureText(text: string): void {
    setCaptureDraft((current) => ({ ...current, text }));
  }
  const [captureSaving, setCaptureSaving] = useState(false);
  const [capturePreviewing, setCapturePreviewing] = useState(false);
  const [capturePreview, setCapturePreview] = useState<CapturePreview | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [conflict, setConflict] = useState<components["schemas"]["CheckinConflict"] | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [quickAnchorSaving, setQuickAnchorSaving] = useState(false);
  const formSavingRef = useRef(false);

  async function expectedCheckinRevision(date: string): Promise<number | null> {
    if (!supabaseCandidate) return dashboard.today.daily_revision;
    if (!dailyCheckins) {
      throw new Error("Supabase daily check-in repository is unavailable");
    }
    return (await dailyCheckins.get(date))?.revision ?? null;
  }

  async function previewConversation() {
    const eventText = captureText.trim();
    if (!eventText) return;
    setReceipt(null);
    if (!client) {
      setCapturePreview({
        schema_version: 1,
        state: "available",
        message: `合成预览，不会写入真实${saveTarget}`,
        intent: "journal",
        preview: {
          date: dashboard.date,
          source: "对话式记录",
          summary: compactLine(eventText, 120),
        },
      });
      return;
    }
    setCapturePreviewing(true);
    try {
      const result = await client.preview(
        eventText,
        dashboard.source_revisions.journal,
      );
      setCapturePreview(result);
    } catch {
      setReceipt("预览失败；草稿仍保留在当前页面。");
    } finally {
      setCapturePreviewing(false);
    }
  }

  async function saveConversation(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (conflict) {
      setReceipt("请先处理当前状态冲突，再保存新记录。");
      return;
    }
    const eventText = captureText.trim();
    if (!eventText) return;
    setReceipt(null);
    if (!client) {
      setReceipt(`合成演示已完成；未写入真实${saveTarget}`);
      await persistCaptureDraft(EMPTY_CONVERSATION_DRAFT);
      return;
    }
    const fact = firstSentence(eventText, 180);
    const title = firstSentence(eventText, 120);
    const journalInput: JournalInput = {
      schema_version: 1,
      event_date: dashboard.date,
      event_time: null,
      time_precision: "unknown",
      text: eventText,
      title,
      summary: compactLine(fact, 240),
      facts: [fact],
      feelings: [],
      people: [],
      places: [],
      themes: [],
      tags: [],
    };
    setCaptureSaving(true);
    try {
      if (supabaseCandidate && supportsExplicitJournalKey(client)) {
        const fingerprint = journalFingerprint(journalInput);
        const idempotencyKey = captureDraft.idempotencyKey
          && captureDraft.fingerprint === fingerprint
          ? captureDraft.idempotencyKey
          : recordsJournalKey();
        await persistCaptureDraft({
          fingerprint,
          idempotencyKey,
          text: captureText,
        });
        await client.journalWithIdempotency(journalInput, idempotencyKey);
      } else {
        await client.journal(journalInput);
      }
      await persistCaptureDraft(EMPTY_CONVERSATION_DRAFT);
      let autoEnriched = false;
      try {
        if (mode === "sites" || supabaseCandidate) {
          throw new Error("Remote mode keeps enrichment disabled");
        }
        const latest = await client.dashboard();
        const newest = latest.records.recent_journals.find(
          (item) => item.date === dashboard.date && item.title === title,
        );
        if (newest) {
          await client.enrichNow(newest.id);
          autoEnriched = true;
        }
      } catch {
        // 云端整理失败不影响已保存的本地记录；卡片会显示"整理失败"并可手动重试。
      }
      setReceipt(
        mode === "sites"
          ? "已保存到云端真相源；iCloud 冷备已进入队列"
          : supabaseCandidate
            ? "已保存到 Supabase 候选环境"
          : autoEnriched
            ? "已保存到 iCloud，正在用 DeepSeek 整理…"
            : "已保存到 iCloud（云端整理未启动，可在卡片上手动整理）",
      );
        setCapturePreview(null);
      await onSaved?.();
    } catch {
      setReceipt("保存失败，请保留当前内容并重试");
    } finally {
      setCaptureSaving(false);
    }
  }

  async function useLatestRecord() {
    const refreshed = await onSaved?.();
    if (refreshed === false) {
      setReceipt("暂时无法读取最新记录，冲突仍保留。");
      return;
    }
    setConflict(null);
    setReceipt("已读取最新记录；本次未覆盖。");
  }

  async function saveForm(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault();
    if (conflict) {
      setReceipt("请先处理当前状态冲突，再保存新记录。");
      return;
    }
    if (formSavingRef.current) return;
    if (!client) {
      setReceipt(`合成演示已完成；未写入真实${saveTarget}`);
      await persistSimpleFormsDraft((current) => formMode === "journal"
        ? {
          ...current,
          journal: emptySimpleFormsDraft(dashboard.date).journal,
        }
        : {
          ...current,
          checkin: emptySimpleFormsDraft(dashboard.date).checkin,
        });
      event.currentTarget.reset();
      return;
    }
    const form = event.currentTarget;
    const values = new FormData(form);
    formSavingRef.current = true;
    setFormSaving(true);
    setReceipt(null);
    try {
      if (formMode === "journal") {
        const time = String(values.get("time") ?? "");
        const eventText = String(values.get("event") ?? "").trim();
        const feeling = compactLine(String(values.get("feeling") ?? ""), 180);
        const fact = firstSentence(eventText, 180);
        const title = firstSentence(eventText, 120);
        const summary = compactLine(
          feeling ? `${fact}；感到${feeling}` : fact,
          240,
        );
        const raw = feeling ? `${eventText}\n\n感受：${feeling}` : eventText;
        const journalInput: JournalInput = {
          schema_version: 1,
          event_date: String(values.get("date")),
          event_time: time || null,
          time_precision: String(values.get("precision")) as "exact" | "approximate" | "unknown",
          text: raw,
          title,
          summary,
          facts: [fact],
          feelings: feeling ? [feeling] : [],
          people: splitJournalList(values.get("people")),
          places: splitJournalList(values.get("places")),
          themes: splitJournalList(values.get("themes")),
          tags: splitJournalList(values.get("tags")),
        };
        let result;
        if (supabaseCandidate && supportsExplicitJournalKey(client)) {
          const fingerprint = journalFingerprint(journalInput);
          const idempotencyKey = simpleFormsDraft.journal.idempotencyKey
            && simpleFormsDraft.journal.fingerprint === fingerprint
            ? simpleFormsDraft.journal.idempotencyKey
            : recordsJournalKey();
          await persistSimpleFormsDraft((current) => ({
            ...current,
            journal: {
              ...current.journal,
              fingerprint,
              idempotencyKey,
            },
          }));
          result = await client.journalWithIdempotency(
            journalInput,
            idempotencyKey,
          );
        } else {
          result = await client.journal(journalInput);
        }
        setReceipt(result.message);
      } else {
        const fields: Record<string, string | number> = {};
        for (const [key] of ratingFields) {
          const value = String(values.get(key) ?? "");
          if (value) fields[key] = Number(value);
        }
        for (const [key] of advancedCheckinFields) {
          const value = String(values.get(key) ?? "");
          if (value) fields[key] = value;
        }
        for (const [key] of anchorFields) {
          const value = String(values.get(key) ?? "");
          if (value) fields[key] = value;
        }
        for (const key of ["awake_in_bed", "note_summary"]) {
          const value = String(values.get(key) ?? "").trim();
          if (value) fields[key] = value;
        }
        if (!Object.keys(fields).length) {
          setReceipt("请至少提供一个状态字段");
          return;
        }
        const targetDate = String(values.get("date"));
        const result = await client.checkin(targetDate, {
          schema_version: 1,
          expect_revision: await expectedCheckinRevision(targetDate),
          fields,
        });
        setReceipt(result.message);
      }
      setConflict(null);
      await persistSimpleFormsDraft((current) => formMode === "journal"
        ? {
          ...current,
          journal: emptySimpleFormsDraft(dashboard.date).journal,
        }
        : {
          ...current,
          checkin: emptySimpleFormsDraft(dashboard.date).checkin,
        });
      if (!supabaseCandidate) form.reset();
      await onSaved?.();
    } catch (error) {
      if (error instanceof ApiError && error.response.conflict) {
        setConflict(error.response.conflict);
      } else {
        setReceipt("保存失败，请保留当前内容并重试");
      }
    } finally {
      formSavingRef.current = false;
      setFormSaving(false);
    }
  }

  async function saveQuickAnchors(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault();
    if (conflict || quickAnchorSaving) {
      if (conflict) {
        setReceipt("请先处理当前状态冲突，再保存新锚点。");
      }
      return;
    }
    if (!client) {
      setReceipt(`合成演示已完成；未写入真实${saveTarget}`);
      event.currentTarget.reset();
      return;
    }
    const form = event.currentTarget;
    const values = new FormData(form);
    const fields: Record<string, string> = {};
    for (const [key] of anchorFields) {
      const value = String(values.get(key) ?? "");
      if (value) fields[key] = value;
    }
    if (!Object.keys(fields).length) {
      setReceipt("请至少提供一个今日锚点");
      return;
    }
    setQuickAnchorSaving(true);
    try {
      const targetDate = String(values.get("date"));
      const result = await client.checkin(targetDate, {
        schema_version: 1,
        expect_revision: await expectedCheckinRevision(targetDate),
        fields,
      });
      setConflict(null);
      setReceipt(result.message);
      await onSaved?.();
    } catch (error) {
      if (error instanceof ApiError && error.response.conflict) {
        setConflict(error.response.conflict);
      } else {
        setReceipt("保存失败，请保留当前内容并重试");
      }
    } finally {
      setQuickAnchorSaving(false);
    }
  }

  function previewMovement(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault();
    setReceipt(`已生成运动恢复草稿；尚未写入${saveTarget}。`);
  }

  return (
    <section aria-labelledby="records-title">
      <header className="hero capture-hero">
        <div>
          <p className="eyebrow">记录，不打断生活</p>
          <h1 id="records-title">
            {supabaseCandidate ? "轻量记录，明确保存。" : "先预览，再写入。"}
          </h1>
          <p className="lead">
            {supabaseCandidate
              ? "记录页沿用原有的大输入与清晰层级；当前候选只开放已评审的日记、每日状态、周复盘和阶段复盘能力。"
              : "记录页以大对话输入为主，同时提供运动恢复、今日锚点与简洁表单兜底。点击保存前，内容只停留在当前草稿与预览。"}
          </p>
        </div>
        <aside className="card hero-card">
          <span className="status blue">写入语义</span>
          <h2>草稿不会自动生效</h2>
          <p className="quiet">
            {supabaseCandidate
              ? "只有明确点击保存才写入独立测试库；冲突或失败时输入继续保留。"
              : mode === "candidate-preview"
              ? "当前只展示合成数据；所有写动作都会被候选只读边界拦截。"
              : client
              ? "系统可以生成结构化预览；只有确认保存后，才调用本机白名单工具写入。"
              : `当前是合成演示；预览与保存都不会改变真实${saveTarget}。`}
          </p>
          <div className="pill-row">
            <span className="pill">预览</span>
            <span className="pill">确认</span>
            <span className="pill">
              {supabaseCandidate ? "Owner-only" : "本地保存"}
            </span>
          </div>
        </aside>
      </header>

      <section className="capture-grid" aria-label="记录输入">
        <section className="card conversation-card" aria-label="对话式记录面板">
          <form onSubmit={saveConversation}>
            <div className="card-header">
              <div>
                <h2 className="card-title">对话式记录</h2>
                  <p className="card-desc">一句话也可以。先看预览，再决定是否写入。</p>
              </div>
                <span className="status blue">主入口</span>
            </div>
            <label className="sr-only" htmlFor="capture-text">直接描述想记录的内容</label>
            <div className="input-wrap">
              <textarea
                className="capture-textarea"
                  disabled={captureSaving
                    || conflict !== null
                    || (supabaseCandidate && !captureReady)}
                id="capture-text"
                  onChange={(event) => {
                    setCaptureText(event.target.value);
                    setCapturePreview(null);
                  }}
                  placeholder="例如：今天只做了 5 分钟最低版，身体感觉稳定。"
                value={captureText}
              />
              <div className="input-hint">
                  <span>保存前不写入，不覆盖，不同步外部展示。</span>
                <span className="mono">{captureText.trim().length} 字</span>
              </div>
            </div>
            <div className="actions">
              <div className="button-row">
                <button
                    className="button ghost"
                    disabled={
                      capturePreviewing
                      || conflict !== null
                      || !captureText.trim()
                      || (supabaseCandidate && !captureReady)
                    }
                    onClick={() => void previewConversation()}
                    type="button"
                  >
                    {capturePreviewing ? "预览中…" : "生成预览"}
                  </button>
                  <button
                    className="button primary"
                    data-readonly={mode === "candidate-preview"}
                  type="submit"
                  disabled={
                    captureSaving
                    || conflict !== null
                    || !captureText.trim()
                    || (supabaseCandidate && !captureReady)
                  }
                >
                    {captureSaving ? "保存中…" : `保存到 ${saveTarget}`}
                </button>
              </div>
                <span className="caption">默认不发布原文</span>
            </div>
          </form>
        </section>

          <aside className="card pad preview-panel" aria-live="polite">
            <div className="section-head">
              <div>
                <h2>结构化预览</h2>
                <p className="quiet">只展示会写入的字段与未知项。</p>
              </div>
              <span className={`status ${capturePreview ? "blue" : "gray"}`}>
                {capturePreview ? "已生成" : "草稿"}
              </span>
            </div>
            {capturePreview ? (
              <>
                <p className="quiet">{capturePreview.message}</p>
                <dl className="preview-list">
                  <div><dt>日期</dt><dd>{String(capturePreview.preview?.event_date ?? capturePreview.preview?.date ?? dashboard.date)}</dd></div>
                  <div><dt>来源</dt><dd>对话式记录</dd></div>
                  <div><dt>意图</dt><dd>{capturePreview.intent ?? "未知"}</dd></div>
                  <div><dt>摘要</dt><dd>{String(capturePreview.preview?.summary ?? "等待对话继续确认")}</dd></div>
                </dl>
              </>
            ) : (
              <p className="empty-state">输入内容后生成预览；此步骤不会写入。</p>
            )}
          </aside>

          <aside className="card form-card" aria-label="简洁表单">
          <div className="side-card-head">
            <div>
                <span className="status gray">可选</span>
                <h2 className="card-title">简洁表单兜底</h2>
            </div>
            <p className="card-desc">当需要补全状态时，用少量字段辅助回顾；表单只是兜底，不要求重复录入。</p>
          </div>
          <div className="subtabs" role="tablist" aria-label="表单类型">
            <button
              aria-selected={formMode === "journal"}
              disabled={conflict !== null || formSaving}
              onClick={() => setFormMode("journal")}
              role="tab"
              type="button"
            >
              日记
            </button>
            <button
              aria-selected={formMode === "checkin"}
              disabled={conflict !== null || formSaving}
              onClick={() => setFormMode("checkin")}
              role="tab"
              type="button"
            >
              每日状态
            </button>
          </div>

          {formMode === "journal" ? (
            <form className="stacked-form" onSubmit={(event) => void saveForm(event)}>
              <label htmlFor="journal-event">发生了什么</label>
              <textarea
                disabled={conflict !== null || formSaving}
                id="journal-event"
                name="event"
                onChange={(event) => setSimpleFormsDraft((current) => ({
                  ...current,
                  journal: {
                    ...current.journal,
                    event: event.target.value,
                  },
                }))}
                placeholder="例如：和朋友去看了展，回来路上聊得很开心。"
                required
                value={simpleFormsDraft.journal.event}
              />
              <label htmlFor="journal-feeling">当时的感受（可选）</label>
              <input
                disabled={conflict !== null || formSaving}
                id="journal-feeling"
                maxLength={180}
                name="feeling"
                onChange={(event) => setSimpleFormsDraft((current) => ({
                  ...current,
                  journal: {
                    ...current.journal,
                    feeling: event.target.value,
                  },
                }))}
                placeholder="例如：轻松、开心、疲惫"
                type="text"
                value={simpleFormsDraft.journal.feeling}
              />
              <p className="form-hint">会立刻生成标题、摘要、事实和感受；不会调用外部 AI。</p>
              <label htmlFor="journal-date">事件日期</label>
              <input
                disabled={conflict !== null || formSaving}
                id="journal-date"
                name="date"
                onChange={(event) => setSimpleFormsDraft((current) => ({
                  ...current,
                  journal: {
                    ...current.journal,
                    date: event.target.value,
                  },
                }))}
                type="date"
                value={simpleFormsDraft.journal.date}
              />
              {!supabaseCandidate && <details>
                <summary>补充时间、人物或场景</summary>
                <div className="advanced-fields">
                  <label htmlFor="journal-time">事件时间</label>
                  <input id="journal-time" name="time" type="time" />
                  <label htmlFor="time-precision">时间精度</label>
                  <select
                    defaultValue="unknown"
                    id="time-precision"
                    name="precision"
                  >
                    <option value="exact">精确</option>
                    <option value="approximate">大约</option>
                    <option value="unknown">未知</option>
                  </select>
                  <label htmlFor="journal-people">人物（可选，逗号分隔）</label>
                  <input id="journal-people" maxLength={360} name="people" type="text" />
                  <label htmlFor="journal-places">地点或场景（可选，逗号分隔）</label>
                  <input id="journal-places" maxLength={360} name="places" type="text" />
                  <label htmlFor="journal-themes">主题（可选，逗号分隔）</label>
                  <input id="journal-themes" maxLength={360} name="themes" type="text" />
                  <label htmlFor="journal-tags">标签（可选，逗号分隔）</label>
                  <input id="journal-tags" maxLength={360} name="tags" type="text" />
                </div>
              </details>}
              <button
                className="primary-button"
                disabled={
                  formSaving
                  || conflict !== null
                  || (supabaseCandidate && !simpleFormsReady)
                }
                type="submit"
              >
                {formSaving ? "正在保存…" : "保存日记"}
              </button>
            </form>
          ) : (
            <form className="stacked-form" onSubmit={(event) => void saveForm(event)}>
              <label htmlFor="checkin-date">日期</label>
              <input
                disabled={conflict !== null || formSaving}
                id="checkin-date"
                name="date"
                onChange={(event) => setSimpleFormsDraft((current) => ({
                  ...current,
                  checkin: { ...current.checkin, date: event.target.value },
                }))}
                type="date"
                value={simpleFormsDraft.checkin.date}
              />
              <div className="rating-grid">
                {ratingFields.map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <select
                      disabled={conflict !== null || formSaving}
                      name={key}
                      onChange={(event) => setSimpleFormsDraft((current) => ({
                        ...current,
                        checkin: {
                          ...current.checkin,
                          [key]: event.target.value,
                        },
                      }))}
                      value={simpleFormsDraft.checkin[key]}
                    >
                      <option value="">未提供</option>
                      <option value="1">1 很差</option>
                      <option value="2">2</option>
                      <option value="3">3 一般</option>
                      <option value="4">4</option>
                      <option value="5">5 很好</option>
                    </select>
                  </label>
                ))}
              </div>
              {!supabaseCandidate && <details>
                <summary>补充睡眠与锚点</summary>
                <div className="advanced-fields">
                  {advancedCheckinFields.map(([key, label, type]) => (
                    <label key={key}>
                      {label}
                      <input name={key} type={type} />
                    </label>
                  ))}
                  <label>
                    醒后是否长时间躺在床上
                    <select defaultValue="" name="awake_in_bed">
                      <option value="">未提供</option>
                      <option value="yes">是</option>
                      <option value="no">否</option>
                    </select>
                  </label>
                  {anchorFields.map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <select defaultValue="" name={key}>
                        <option value="">未提供</option>
                        <option value="complete">完成</option>
                        <option value="minimum">最低版</option>
                        <option value="skipped">跳过</option>
                      </select>
                    </label>
                  ))}
                  <label>
                    去敏短备注
                    <input maxLength={160} name="note_summary" type="text" />
                  </label>
                  <p className="supporting-text">
                    入睡、最终醒来和离床保持独立；未填写字段不会提交。
                  </p>
                </div>
              </details>}
              <button
                className="primary-button"
                disabled={
                  formSaving
                  || conflict !== null
                  || (supabaseCandidate && !simpleFormsReady)
                }
                type="submit"
              >
                {formSaving ? "正在保存…" : "更新这些状态"}
              </button>
            </form>
          )}
        </aside>
      </section>

      {!supabaseCandidate && (
        <section className="quick-record-grid section" aria-label="双轨快速记录">
          <article className="card pad quick-record-card">
            <div className="section-head">
              <div>
                <h2>运动恢复快速记录</h2>
                <p className="quiet">只生成本页草稿，不建立新的运动台账。</p>
              </div>
              <span className="status green">恢复轨</span>
            </div>
            <form className="form-grid" onSubmit={previewMovement}>
              <label className="field">
                <span>今天做了什么</span>
                <select aria-label="今天做了什么" defaultValue="minimum">
                  <option value="minimum">5 分钟全身最低版</option>
                  <option value="strength-a">室内力量 A</option>
                  <option value="strength-b">室内力量 B</option>
                  <option value="recovery">室内恢复力量</option>
                  <option value="skipped">今天跳过</option>
                </select>
              </label>
              <label className="field">
                <span>身体反应</span>
                <select aria-label="身体反应" defaultValue="unknown">
                  <option value="stable">稳定，没有明显不适</option>
                  <option value="tired">轻微疲劳，可观察</option>
                  <option value="downgrade">不适，需要降级</option>
                  <option value="unknown">未知，稍后再补</option>
                </select>
              </label>
              <label className="field">
                <span>主观用力</span>
                <input aria-label="主观用力" placeholder="例如：5 / 10，仍有余力" />
              </label>
              <label className="field">
                <span>下一次调整</span>
                <input aria-label="下一次调整" placeholder="例如：保持最低版" />
              </label>
              <button className="button ghost" type="submit">生成运动草稿</button>
            </form>
          </article>

          <article className="card pad quick-record-card">
            <div className="section-head">
              <div>
                <h2>今日锚点快速记录</h2>
                <p className="quiet">Agent 实操不做字段化反馈；这里补齐生活锚点。</p>
              </div>
              <span className="status blue">今日锚点</span>
            </div>
            <form className="anchor-quick-form" onSubmit={(event) => void saveQuickAnchors(event)}>
              <input type="hidden" name="date" value={dashboard.date} />
              <div className="anchor-quick-grid">
                {anchorFields.map(([key, label]) => (
                  <label className="field" key={key}>
                    <span>{label}</span>
                    <select
                      aria-label={`快速记录${label}状态`}
                      disabled={conflict !== null || quickAnchorSaving}
                      name={key}
                      defaultValue={dashboard.today.anchors[key] ?? ""}
                    >
                      <option value="">未记录</option>
                      <option value="complete">完成</option>
                      <option value="minimum">最低版</option>
                      <option value="skipped">跳过</option>
                    </select>
                  </label>
                ))}
              </div>
              <button
                className="button primary"
                disabled={conflict !== null || quickAnchorSaving}
                type="submit"
              >
                {quickAnchorSaving ? "正在保存…" : "保存今日锚点"}
              </button>
            </form>
          </article>
        </section>
      )}

      {supabaseCandidate && supabasePanels && (
        <section className="section supabase-records-workspace" aria-label="候选记录工作区">
          <div className="section-head">
            <div>
              <p className="eyebrow">OWNER WORKSPACE</p>
              <h2>已开放的候选记录</h2>
              <p className="quiet">日记、每日状态与复盘各自保留真实空态、修订和失败反馈。</p>
            </div>
            <span className="status blue">纯合成数据</span>
          </div>
          {supabasePanels}
        </section>
      )}

      <section className="feedback-bar" aria-label="保存反馈">
        <div>
          <strong>
            {supabaseCandidate
              ? "保存结果明确可见，失败时不丢草稿"
              : "本地成功先算完成，派生展示只在需要时更新"}
          </strong>
          <span>
            {supabaseCandidate
              ? "候选写入只进入独立 Supabase 测试项目；iCloud 仍是私人真相源，当前没有切换或同步。"
              : mode === "candidate-preview"
              ? "候选环境只展示合成投影，不连接或写入任何真相源。"
              : mode === "sites"
              ? "记录先写入 D1 唯一真相源；成功后进入 iCloud 单向冷备队列。"
              : "记录先落在 iCloud 私人真相源；Google 与 XLSX 只按需派生，失败不回滚本地结果。"}
          </span>
        </div>
        <span className="feedback-state">local saved</span>
      </section>

      {receipt && (
        <p className="save-receipt" role="status">
          {receipt}
        </p>
      )}
      {conflict && (
        <section className="conflict-card" aria-label="状态冲突">
          <h2>当前值与本次提交不同</h2>
          <div>
            <article><strong>当前值</strong><pre>{JSON.stringify(conflict.current, null, 2)}</pre></article>
            <article><strong>本次提交</strong><pre>{JSON.stringify(conflict.submitted, null, 2)}</pre></article>
          </div>
          <button className="secondary-button" onClick={() => void useLatestRecord()} type="button">
            使用最新记录
          </button>
        </section>
      )}

      <section
        aria-label="已录入与上下文"
        className="section-block"
      >
        <div className="section-heading">
          <div>
            <h2>已录入与上下文</h2>
            <span className="supporting-text">放在当前页下方，避免新增 tab 打断记录流程</span>
          </div>
          <span className="supporting-text">安全轻量投影</span>
        </div>
        <div className="record-context-grid">
          <section className="record-context-card" aria-labelledby="recent-title">
            <div className="context-card-head">
              <h3 id="recent-title">最近日记</h3>
              <span>已录入</span>
            </div>
            <div className="recent-list">
              {dashboard.records.recent_journals.map((item) => (
                <JournalCard
                  key={item.id}
                  journal={item}
                  client={client}
                  mode={mode}
                  onChanged={onSaved}
                />
              ))}
              {dashboard.records.recent_journals.length === 0 && (
                <p className="empty-state">还没有日记；这里不会展示示例记录。</p>
              )}
            </div>
          </section>

          <aside className="record-context-card" aria-label="今日锚点与派生状态">
            <div className="context-card-head">
              <h3>今日锚点</h3>
              <span>其它信息</span>
            </div>
            <dl className="context-list">
              {Object.entries(dashboard.today.anchors).map(([key, value]) => (
                <div key={key}>
                  <dt>{anchorContextLabels[key as keyof typeof anchorContextLabels]}</dt>
                  <dd>{value ? anchorStateLabels[value] : "未记录"}</dd>
                </div>
              ))}
              <div>
                <dt>Google / XLSX</dt>
                <dd>按需</dd>
              </div>
              <div>
                <dt>移动网页</dt>
                <dd>已归档</dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>
    </section>
  );
}
