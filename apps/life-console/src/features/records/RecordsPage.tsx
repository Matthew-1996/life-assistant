import { type SyntheticEvent, useState } from "react";

import type { Dashboard } from "../../data/dashboard";

type EntryMode = "conversation" | "forms";
type FormMode = "journal" | "checkin";

interface RecordsPageProps {
  dashboard: Dashboard;
}

export function RecordsPage({ dashboard }: RecordsPageProps) {
  const [entryMode, setEntryMode] = useState<EntryMode>("conversation");
  const [formMode, setFormMode] = useState<FormMode>("journal");
  const [captureText, setCaptureText] = useState("");
  const [previewReady, setPreviewReady] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  function previewCapture(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!captureText.trim()) return;
    setPreviewReady(true);
    setReceipt(null);
  }

  function saveSynthetic(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault();
    setReceipt("合成演示已完成；未写入真实 iCloud");
    event.currentTarget.reset();
  }

  return (
    <section aria-labelledby="records-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">对话优先，表单兜底</p>
          <h1 id="records-title">记录</h1>
        </div>
        <p>当前阶段只使用内存合成数据，刷新后清空。</p>
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
              <h2>前往现有生活助手对话继续</h2>
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
            <form className="stacked-form" onSubmit={saveSynthetic}>
              <label htmlFor="journal-text">正文</label>
              <textarea id="journal-text" name="text" required />
              <label htmlFor="journal-date">事件日期</label>
              <input
                defaultValue={dashboard.date}
                id="journal-date"
                name="date"
                type="date"
              />
              <details>
                <summary>补充时间信息</summary>
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
                </div>
              </details>
              <button className="primary-button" type="submit">
                保存日记
              </button>
            </form>
          ) : (
            <form className="stacked-form" onSubmit={saveSynthetic}>
              <label htmlFor="checkin-date">日期</label>
              <input
                defaultValue={dashboard.date}
                id="checkin-date"
                name="date"
                type="date"
              />
              <div className="rating-grid">
                {["睡眠质量", "精力", "情绪", "生活实感"].map((label) => (
                  <label key={label}>
                    {label}
                    <select defaultValue="" name={label}>
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
                <p className="supporting-text">
                  入睡、最终醒来和离床保持独立；未填写字段不会提交。
                </p>
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

      <section className="section-block" aria-labelledby="recent-title">
        <div className="section-heading">
          <h2 id="recent-title">最近记录</h2>
          <span className="supporting-text">安全轻量投影</span>
        </div>
        <div className="recent-list">
          {dashboard.records.recent_journals.map((item) => (
            <article key={`${item.date}-${item.title}`}>
              <time>{item.date}</time>
              <strong>{item.title}</strong>
              <p>{item.summary}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
