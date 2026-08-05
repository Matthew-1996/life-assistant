import { useEffect, useState } from "react";

import { ApiError, type LifeConsoleClient } from "../../api/client";
import type { components } from "../../contracts/life-console";
import type { Dashboard } from "../../data/dashboard";

type Anchors = Dashboard["today"]["anchors"];
type AnchorKey = keyof Anchors;
type AnchorState = NonNullable<Anchors[AnchorKey]> | null;

const anchorCopy: Array<{
  key: AnchorKey;
  title: string;
  description: string;
}> = [
  {
    key: "wake",
    title: "起床",
    description: "已离开床；不自动表示晒到太阳。",
  },
  {
    key: "body_light",
    title: "身体 / 光照",
    description: "出门、晒太阳、散步，或约 5 分钟最低版。",
  },
  {
    key: "life_action",
    title: "生活动作",
    description: "一件不为工作或自我改造服务的生活活动。",
  },
  {
    key: "wind_down",
    title: "晚间降速",
    description: "睡前从高刺激切到低刺激，白天可保持未知。",
  },
];

const states: Array<{ value: AnchorState; label: string }> = [
  { value: null, label: "未记录" },
  { value: "complete", label: "完成" },
  { value: "minimum", label: "最低版" },
  { value: "skipped", label: "跳过" },
];

interface TodayPageProps {
  dashboard: Dashboard;
  client?: LifeConsoleClient;
  onSaved?: () => boolean | Promise<boolean>;
}

export function TodayPage({ dashboard, client, onSaved }: TodayPageProps) {
  const [anchors, setAnchors] = useState<Anchors>(dashboard.today.anchors);
  const [conflict, setConflict] = useState<components["schemas"]["CheckinConflict"] | null>(null);
  const [pending, setPending] = useState<AnchorKey | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setAnchors(dashboard.today.anchors);
  }, [dashboard.today.anchors]);

  async function updateAnchor(key: AnchorKey, value: AnchorState) {
    setStatus(null);
    if (value === null) {
      setStatus("“未记录”只表示没有数据，不会作为普通更新提交。");
      return;
    }
    if (!client) {
      setAnchors((current) => ({ ...current, [key]: value }));
      setStatus("合成演示已更新；未写入真实 iCloud。");
      return;
    }
    setPending(key);
    try {
      const result = await client.checkin(dashboard.date, {
        schema_version: 1,
        expect_revision: dashboard.today.daily_revision,
        fields: { [key]: value },
      });
      const refreshed = await onSaved?.();
      setStatus(
        refreshed === false
          ? "已保存到 iCloud，但页面暂时无法刷新。"
          : result.message,
      );
      if (refreshed !== false) setConflict(null);
    } catch (error) {
      if (error instanceof ApiError && error.response.conflict) {
        setConflict(error.response.conflict);
        setStatus("未覆盖已有记录；请先核对最新值。");
      } else {
        setStatus("保存失败；页面仍显示原来的真实状态，请稍后重试。");
      }
    } finally {
      setPending(null);
    }
  }

  async function useLatestRecord() {
    const refreshed = await onSaved?.();
    if (refreshed === false) {
      setStatus("暂时无法读取最新记录，冲突仍保留。");
      return;
    }
    setConflict(null);
    setStatus("已读取最新记录；本次未覆盖。");
  }

  return (
    <section aria-labelledby="today-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">今天只看必要信息</p>
          <h1 id="today-title">今日</h1>
        </div>
        <p>先看一个重点，再决定最小行动。</p>
      </div>

      <article className="focus-card">
        <span>{dashboard.today.focus.phase_label}</span>
        <h2>{dashboard.today.focus.title || "当前重点等待确认"}</h2>
        <p>保持可执行，不用完成百分比制造压力。</p>
      </article>

      <section className="section-block" aria-labelledby="action-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">一个建议行动</p>
            <h2 id="action-title">现在可以做什么</h2>
          </div>
        </div>
        <article className="action-card">
          {dashboard.today.suggested_action ? (
            <>
              <div>
                <strong>{dashboard.today.suggested_action.label}</strong>
                <p>来自已确认计划；一期不建立新的 Todo 台账。</p>
              </div>
              <span className="neutral-badge">仅建议</span>
            </>
          ) : (
            <p>今天没有必须处理的事项。</p>
          )}
        </article>
      </section>

      <section className="section-block" aria-labelledby="anchors-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">生活状态</p>
            <h2 id="anchors-title">今日锚点</h2>
          </div>
          <span className="supporting-text">未记录不等于跳过</span>
        </div>
        <div className="anchor-grid">
          {anchorCopy.map((anchor) => (
            <article className="anchor-card" key={anchor.key}>
              <h3>{anchor.title}</h3>
              <p>{anchor.description}</p>
              <div
                aria-label={`${anchor.title}状态`}
                className="segmented-control"
                role="group"
              >
                {states.map((state) => (
                  <button
                    aria-pressed={anchors[anchor.key] === state.value}
                    data-state={state.value ?? "unknown"}
                    disabled={pending !== null || state.value === null}
                    key={state.label}
                    onClick={() => void updateAnchor(anchor.key, state.value)}
                    type="button"
                  >
                    {state.label}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      {status && (
        <p className="save-receipt" role="status">
          {status}
        </p>
      )}

      {conflict && (
        <section className="conflict-card" aria-label="状态冲突">
          <h2>状态已在其他位置更新</h2>
          <div>
            <article>
              <strong>当前值</strong>
              <pre>{JSON.stringify(conflict.current, null, 2)}</pre>
            </article>
            <article>
              <strong>本次提交</strong>
              <pre>{JSON.stringify(conflict.submitted, null, 2)}</pre>
            </article>
          </div>
          <button className="secondary-button" onClick={() => void useLatestRecord()} type="button">
            使用最新记录
          </button>
        </section>
      )}

      <div className="two-column">
        <section className="section-block compact" aria-labelledby="confirm-title">
          <div className="section-heading">
            <h2 id="confirm-title">待确认</h2>
            <span className="count-badge">
              {dashboard.today.confirmations.length}
            </span>
          </div>
          {dashboard.today.confirmations.length ? (
            dashboard.today.confirmations.map((item) => (
              <article className="confirmation-card" key={item.id}>
                <strong>{item.title}</strong>
                <p>{item.message}</p>
                <button
                  className="secondary-button"
                  onClick={() => void useLatestRecord()}
                  type="button"
                >
                  {item.action_label}
                </button>
              </article>
            ))
          ) : (
            <p className="empty-state">现在没有需要确认的事项。</p>
          )}
        </section>

        <section className="section-block compact" aria-labelledby="skip-title">
          <div className="section-heading">
            <h2 id="skip-title">今天可以不做</h2>
          </div>
          <p className="permission-card">
            不需要追赶缺失记录，也不用提前报告今晚是否完成晚间降速。
          </p>
        </section>
      </div>
    </section>
  );
}
