import { type SyntheticEvent, useState } from "react";

import { ApiError, type LifeConsoleClient } from "../../api/client";
import type { components } from "../../contracts/life-console";
import type { Dashboard } from "../../data/dashboard";

type FormMode = "journal" | "checkin";
type RecentJournal = Dashboard["records"]["recent_journals"][number];

interface RecordsPageProps {
  dashboard: Dashboard;
  client?: LifeConsoleClient;
  onSaved?: () => boolean | Promise<boolean>;
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
  onChanged,
}: {
  journal: RecentJournal;
  client?: LifeConsoleClient;
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
      await client.deleteJournal(journal.id);
      setRemoved(true);
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
        <button
          className="secondary-button"
          type="button"
          disabled={busy || state === "working"}
          onClick={() => void enrichNow()}
        >
          {state === "failed" ? "重新整理" : "整理"}
        </button>
        <button
          className="secondary-button danger"
          type="button"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          删除
        </button>
      </div>
      {note && <p className="save-receipt" role="status">{note}</p>}
      {confirming && (
        <div className="confirm-dialog" role="alertdialog" aria-label="确认删除这条记录">
          <p>删除后这条日记将从当前项目移除（不影响聊天、旧备份与设备历史）。确认删除？</p>
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
              确认删除
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export function RecordsPage({ dashboard, client, onSaved }: RecordsPageProps) {
  const [formMode, setFormMode] = useState<FormMode>("journal");
  const [captureText, setCaptureText] = useState("");
  const [captureSaving, setCaptureSaving] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [conflict, setConflict] = useState<components["schemas"]["CheckinConflict"] | null>(null);

  async function saveConversation(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const eventText = captureText.trim();
    if (!eventText) return;
    setReceipt(null);
    if (!client) {
      setReceipt("合成演示已完成；未写入真实 iCloud");
      setCaptureText("");
      return;
    }
    const fact = firstSentence(eventText, 180);
    const title = firstSentence(eventText, 120);
    setCaptureSaving(true);
    try {
      await client.journal({
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
      });
      setCaptureText("");
      // 保存成功后自动触发一次 DeepSeek 语义整理：读回最新看板定位这条，
      // 再一步 enrich；效果等同于直接把记录交给助手自动整理。
      let autoEnriched = false;
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
        // 云端整理失败不影响已保存的本地记录；卡片会显示"整理失败"并可手动重试。
      }
      setReceipt(
        autoEnriched
          ? "已保存到 iCloud，正在用 DeepSeek 整理…"
          : "已保存到 iCloud（云端整理未启动，可在卡片上手动整理）",
      );
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
    if (!client) {
      setReceipt("合成演示已完成；未写入真实 iCloud");
      event.currentTarget.reset();
      return;
    }
    const form = event.currentTarget;
    const values = new FormData(form);
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
        const result = await client.journal({
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
        });
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
        const result = await client.checkin(String(values.get("date")), {
          schema_version: 1,
          expect_revision: dashboard.today.daily_revision,
          fields,
        });
        setReceipt(result.message);
      }
      setConflict(null);
      form.reset();
      await onSaved?.();
    } catch (error) {
      if (error instanceof ApiError && error.response.conflict) {
        setConflict(error.response.conflict);
      } else {
        setReceipt("保存失败，请保留当前内容并重试");
      }
    }
  }

  return (
    <section aria-labelledby="records-title">
      <header className="hero capture-hero">
        <div>
          <p className="eyebrow">记录输入</p>
          <h1 id="records-title">记录，不打断生活</h1>
        </div>
        <p>
          {client
            ? "通过本机 Life Hub 写入 iCloud 真相源；保存失败时保留当前输入。"
            : "当前是合成演示；不会写入真实 iCloud。"}
        </p>
      </header>

      <section className="capture-grid" aria-label="记录输入">
        <section className="card conversation-card" aria-label="对话式记录面板">
          <form onSubmit={saveConversation}>
            <div className="card-header">
              <div>
                <h2 className="card-title">对话式记录</h2>
                <p className="card-desc">主入口是自然语言。系统先保存，再慢慢整理。</p>
              </div>
              <span className="status-pill">Mac 本地</span>
            </div>
            <p className="input-prompt">写一句也可以</p>
            <label className="sr-only" htmlFor="capture-text">直接描述想记录的内容</label>
            <div className="input-wrap">
              <textarea
                className="capture-textarea"
                id="capture-text"
                onChange={(event) => setCaptureText(event.target.value)}
                placeholder="写一句也可以。例如：今天散步后感觉轻松一些……"
                value={captureText}
              />
              <div className="input-hint">
                <span>先原样保存到 iCloud；外部展示待刷新不回滚本地成功。</span>
                <span className="mono">{captureText.trim().length} 字</span>
              </div>
            </div>
            <div className="actions">
              <div className="button-row">
                <button
                  className="primary-button btn btn-primary"
                  type="submit"
                  disabled={captureSaving || !captureText.trim()}
                >
                  {captureSaving ? "保存中…" : "保存记录"}
                </button>
                <span className="text-link">先预览</span>
              </div>
              <span className="status-pill">默认不发布原文</span>
            </div>
          </form>
        </section>

        <aside className="card form-card" aria-label="简洁表单">
          <div className="side-card-head">
            <div>
              <span className="neutral-badge">简洁表单</span>
          <h2 className="card-title">简洁表单</h2>
            </div>
            <p className="card-desc">当需要补全状态时，用少量字段辅助回顾；表单只是兜底，不要求重复录入。</p>
          </div>
          <div className="subtabs" role="tablist" aria-label="表单类型">
            <button
              aria-selected={formMode === "journal"}
              onClick={() => setFormMode("journal")}
              role="tab"
              type="button"
            >
              日记
            </button>
            <button
              aria-selected={formMode === "checkin"}
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
                id="journal-event"
                name="event"
                placeholder="例如：和双双去看了展，回来路上聊得很开心。"
                required
              />
              <label htmlFor="journal-feeling">当时的感受（可选）</label>
              <input
                id="journal-feeling"
                maxLength={180}
                name="feeling"
                placeholder="例如：轻松、开心、疲惫"
                type="text"
              />
              <p className="form-hint">会立刻生成标题、摘要、事实和感受；不会调用外部 AI。</p>
              <label htmlFor="journal-date">事件日期</label>
              <input
                defaultValue={dashboard.date}
                id="journal-date"
                name="date"
                type="date"
              />
              <details>
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
              </details>
              <button className="primary-button" type="submit">
                保存日记
              </button>
            </form>
          ) : (
            <form className="stacked-form" onSubmit={(event) => void saveForm(event)}>
              <label htmlFor="checkin-date">日期</label>
              <input
                defaultValue={dashboard.date}
                id="checkin-date"
                name="date"
                type="date"
              />
              <div className="rating-grid">
                {ratingFields.map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <select defaultValue="" name={key}>
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
              <details>
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
              </details>
              <button className="primary-button" type="submit">
                更新这些状态
              </button>
            </form>
          )}
        </aside>
      </section>

      <section className="feedback-bar" aria-label="保存反馈">
        <div>
          <strong>本地成功先算完成，外部展示待刷新不回滚</strong>
          <span>记录先落在 Mac 本地真相源；表格或网页只是派生视图，失败时保留待刷新状态。</span>
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

      <section className="section-block" aria-labelledby="recent-title">
        <div className="section-heading">
          <h2 id="recent-title">最近记录</h2>
          <span className="supporting-text">安全轻量投影</span>
        </div>
        <div className="recent-list">
          {dashboard.records.recent_journals.map((item) => (
            <JournalCard
              key={item.id}
              journal={item}
              client={client}
              onChanged={onSaved}
            />
          ))}
        </div>
      </section>
    </section>
  );
}
