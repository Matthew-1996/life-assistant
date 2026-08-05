import { type SyntheticEvent, useState } from "react";

import { ApiError, type EnrichmentJob, type EnrichmentPreview, type LifeConsoleClient } from "../../api/client";
import type { components } from "../../contracts/life-console";
import type { Dashboard } from "../../data/dashboard";

type EntryMode = "conversation" | "forms";
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

type EnrichmentPhase = "idle" | "preview" | "working" | "succeeded" | "failed";

function EnrichmentControl({
  journal,
  client,
}: {
  journal: RecentJournal;
  client?: LifeConsoleClient;
}) {
  const [phase, setPhase] = useState<EnrichmentPhase>("idle");
  const [preview, setPreview] = useState<EnrichmentPreview | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function pollUntilDone(jobId: string): Promise<void> {
    if (!client) return;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const job: EnrichmentJob = await client.enrichmentStatus(jobId);
      if (job.status === "succeeded") {
        setPhase("succeeded");
        setNote("结构化整理已保存；原文与时间不变。");
        return;
      }
      if (job.status === "failed") {
        setPhase("failed");
        setNote("云端整理未完成；本地原文和索引保持不变，可主动重试。");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    setPhase("failed");
    setNote("云端整理仍在进行，请稍后在此重试。");
  }

  async function startPreview() {
    setNote(null);
    if (!client) {
      setPhase("preview");
      setPreview(null);
      setNote("合成演示：预览不联网，也不会发送任何日记。");
      return;
    }
    try {
      const result = await client.enrichmentPreview(journal.id);
      setPreview(result);
      setPhase("preview");
    } catch {
      setPhase("failed");
      setNote("暂时无法生成发送预览，请稍后重试。");
    }
  }

  async function confirmSend() {
    if (!client || !preview) {
      setPhase("idle");
      setNote("合成演示未发送任何数据。");
      return;
    }
    setPhase("working");
    setNote("已提交；可继续使用工作台。");
    try {
      const job = await client.enrichmentCommit(preview.preview_token);
      await pollUntilDone(job.job_id);
    } catch (error) {
      setPhase("failed");
      setNote(
        error instanceof ApiError && error.response.error.code === "SOURCE_CHANGED"
          ? "这篇日记刚刚有改动，未发送旧内容；请重新生成预览。"
          : "云端整理未成功；本地记录未受影响，可主动重试。",
      );
    }
  }

  return (
    <div className="enrichment-control">
      {phase === "idle" && (
        <button className="secondary-button" type="button" onClick={() => void startPreview()}>
          用 DeepSeek 整理此篇
        </button>
      )}

      {phase === "preview" && (
        <article className="preview-card" aria-label="云端整理发送预览">
          <span className="neutral-badge">发送预览（尚未联网）</span>
          <h3>将这一篇发送给 DeepSeek 做结构化整理</h3>
          {preview ? (
            <>
              <dl>
                <div><dt>接收方</dt><dd>{preview.provider} · {preview.model}</dd></div>
                <div><dt>可写回字段</dt><dd>{preview.writable_fields.join("、")}</dd></div>
                <div><dt>最多重试</dt><dd>{preview.max_retries} 次</dd></div>
              </dl>
              <ul className="disclosure-list">
                {preview.disclosures.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>{note}</p>
          )}
          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={() => { setPhase("idle"); setPreview(null); }}>
              取消
            </button>
            <button className="primary-button" type="button" onClick={() => void confirmSend()}>
              确认发送
            </button>
          </div>
        </article>
      )}

      {phase === "working" && <p className="save-receipt" role="status">{note}</p>}

      {phase === "succeeded" && <p className="save-receipt" role="status">{note}</p>}

      {phase === "failed" && (
        <div className="enrichment-failed" role="status">
          <p>{note}</p>
          <button className="secondary-button" type="button" onClick={() => void startPreview()}>
            重新预览并重试
          </button>
        </div>
      )}
    </div>
  );
}

export function RecordsPage({ dashboard, client, onSaved }: RecordsPageProps) {
  const [entryMode, setEntryMode] = useState<EntryMode>("conversation");
  const [formMode, setFormMode] = useState<FormMode>("journal");
  const [captureText, setCaptureText] = useState("");
  const [previewReady, setPreviewReady] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [previewMessage, setPreviewMessage] = useState("前往现有生活助手对话继续");
  const [conflict, setConflict] = useState<components["schemas"]["CheckinConflict"] | null>(null);

  async function previewCapture(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!captureText.trim()) return;
    setReceipt(null);
    if (client) {
      try {
        const preview = await client.preview(
          captureText,
          dashboard.source_revisions.journal ?? "empty",
        );
        setPreviewMessage(preview.message);
      } catch {
        setPreviewMessage("本地服务暂不可用，请稍后重试");
      }
    }
    setPreviewReady(true);
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
      <div className="page-heading">
        <div>
          <p className="eyebrow">对话优先，表单兜底</p>
          <h1 id="records-title">记录</h1>
        </div>
        <p>
          {client
            ? "通过本机 Life Hub 写入 iCloud 真相源；保存失败时保留当前输入。"
            : "当前是合成演示；不会写入真实 iCloud。"}
        </p>
      </div>

      <div className="tab-list" role="tablist" aria-label="记录入口">
        <button
          aria-selected={entryMode === "conversation"}
          onClick={() => setEntryMode("conversation")}
          role="tab"
          type="button"
        >
          对话式记录
        </button>
        <button
          aria-selected={entryMode === "forms"}
          onClick={() => setEntryMode("forms")}
          role="tab"
          type="button"
        >
          简洁表单
        </button>
      </div>

      {entryMode === "conversation" ? (
        <section className="record-panel" aria-label="对话式记录面板">
          <form onSubmit={previewCapture}>
            <label htmlFor="capture-text">直接描述想记录的内容</label>
            <textarea
              id="capture-text"
              onChange={(event) => {
                setCaptureText(event.target.value);
                setPreviewReady(false);
              }}
              placeholder="例如：今天散步后感觉轻松一些……"
              value={captureText}
            />
            <div className="form-actions">
              <span>正文只保留在当前页面内存。</span>
              <button className="primary-button" type="submit">
                生成保存预览
              </button>
            </div>
          </form>
          {previewReady && (
            <article className="preview-card" aria-live="polite">
              <span className="neutral-badge">需要转交</span>
              <h2>{previewMessage}</h2>
              <dl>
                <div>
                  <dt>意图</dt>
                  <dd>等待生活助手识别</dd>
                </div>
                <div>
                  <dt>日期</dt>
                  <dd>{dashboard.date}</dd>
                </div>
                <div>
                  <dt>隐私</dt>
                  <dd>当前工作台不保存或持久化这段正文</dd>
                </div>
              </dl>
              <button
                className="secondary-button"
                onClick={() =>
                  setReceipt("已准备转交；合成演示未访问剪贴板或外部服务")
                }
                type="button"
              >
                模拟转交
              </button>
            </article>
          )}
        </section>
      ) : (
        <section className="record-panel" aria-label="简洁表单面板">
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
        </section>
      )}

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
            <article key={item.id}>
              <time>{item.date}</time>
              <strong>{item.title}</strong>
              <p>{item.summary}</p>
              <EnrichmentControl journal={item} client={client} />
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
