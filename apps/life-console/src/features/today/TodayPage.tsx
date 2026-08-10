import { useEffect, useState } from "react";

import { ApiError, type LifeConsoleClient } from "../../api/client";
import type { components } from "../../contracts/life-console";
import type { Dashboard } from "../../data/dashboard";
import type { PageId } from "../../components/shell/AppShell";

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
  readOnly?: boolean;
  onNavigate?: (page: PageId) => void;
  onSaved?: () => boolean | Promise<boolean>;
}

export function TodayPage({
  dashboard,
  client,
  readOnly = false,
  onNavigate,
  onSaved,
}: TodayPageProps) {
  const [anchors, setAnchors] = useState<Anchors>(dashboard.today.anchors);
  const [conflict, setConflict] = useState<components["schemas"]["CheckinConflict"] | null>(null);
  const [pending, setPending] = useState<AnchorKey | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setAnchors(dashboard.today.anchors);
  }, [dashboard.today.anchors]);

  async function updateAnchor(key: AnchorKey, value: AnchorState) {
    setStatus(null);
    if (readOnly) {
      setStatus("线上版只读；请通过对话或本机版记录。");
      return;
    }
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
      <section className="hero" aria-labelledby="today-title">
        <div>
          <p className="eyebrow">{dashboard.date} · 本周试行</p>
          <h1 id="today-title">一周试行控制台。</h1>
          <p className="lead">
            本周只验证两条轨道：运动恢复与 Agent 实操。今天不追求完整完成，只选择一个最低可执行版本，让生活系统继续保持轻。
          </p>
          <div className="pill-row hero-actions" aria-label="主要操作">
            <button className="button primary" onClick={() => onNavigate?.("records")} type="button">
              {readOnly ? "查看记录边界" : "记录今天"}
            </button>
            <button className="button ghost" onClick={() => onNavigate?.("progress")} type="button">
              查看自然周路径
            </button>
            <span className="pill">不补作业</span>
            <span className="pill">缺失值保持未知</span>
          </div>
        </div>

        <aside className="card hero-card" aria-label="今日最低版建议">
          <span className="status blue">今日只做一个</span>
          <h2>{dashboard.today.suggested_action?.label ?? "先做一个最低版"}</h2>
          <p className="quiet">
            精力低时只保留一个可停止的小动作。最低版是有效观察，跳过也不需要追赶。
          </p>
          <div className="grid two metric-grid">
            <div className="metric">
              <strong>5</strong>
              <span>分钟最低版</span>
            </div>
            <div className="metric">
              <strong>1</strong>
              <span>条明确下一步</span>
            </div>
          </div>
        </aside>
      </section>

      {dashboard.today.active_projects.length > 0 && (
        <section
          aria-labelledby="active-projects-title"
          aria-label="本周双轨试行"
          className="section grid two"
        >
          <h2 className="sr-only" id="active-projects-title">本周双轨试行</h2>
          {dashboard.today.active_projects.map((project, index) => (
            <article className="card pad track-card" key={`${project.plan_path}:${project.title}`}>
              <div className="track-dot">{index === 0 ? "身" : "A"}</div>
              <div>
                <div className="section-head compact-head">
                  <h2>{project.title}</h2>
                  <span className="status gray">只读项目</span>
                </div>
                <p className="quiet">{project.summary}</p>
                <div className="pill-row">
                  <span className="pill">{project.period}</span>
                  <span className="pill">{project.status}</span>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="section" aria-labelledby="week-path-title">
        <div className="section-head">
          <div>
            <h2 id="week-path-title">本周路径，轻量可回退。</h2>
            <p className="quiet">按自然周观察，不把未知、最低版或跳过显示成失败。</p>
          </div>
          <span className="status blue">自然周</span>
        </div>
        <div className="card pad timeline">
          {["周一", "周二", "周三", "周四", "周五", "周末"].map((label, index) => (
            <div className={`day-row ${index === 0 ? "today" : ""}`} key={label}>
              <strong>{label}</strong>
              <span>
                {dashboard.today.active_projects[index % Math.max(dashboard.today.active_projects.length, 1)]?.title
                  ?? dashboard.today.focus.title}
              </span>
              <span className={`status ${index === 0 ? "blue" : "gray"}`}>
                {index === 0 ? "今日建议" : "可回退"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="section grid three" aria-label="控制台原则">
        <article className="card pad">
          <span className="status blue">原则 01</span>
          <h3>今日只突出一个主项</h3>
          <p className="quiet">运动和 Agent 不要求同日都做，避免把恢复期变成双倍任务。</p>
        </article>
        <article className="card pad">
          <span className="status blue">原则 02</span>
          <h3>最低版不是失败</h3>
          <p className="quiet">短时活动或一句下一步都算有效观察，不制造连续打卡压力。</p>
        </article>
        <article className="card pad">
          <span className="status blue">原则 03</span>
          <h3>保存前不改变真相源</h3>
          <p className="quiet">界面先展示预览语义，真正写入必须经过明确保存动作。</p>
        </article>
      </section>

      <section className="section" aria-labelledby="anchors-title">
        <div className="section-head">
          <h2 id="anchors-title">今日锚点</h2>
          <p className="quiet">保留未记录、最低版与跳过的不同语义。</p>
        </div>
        <div className="anchor-grid">
          {anchorCopy.map((anchor) => (
            <article className="card pad anchor-card" key={anchor.key}>
              <div>
                <p className="anchor-title">{anchor.title}</p>
                <p className="anchor-help">{anchor.description}</p>
              </div>
              <div
                aria-label={`${anchor.title}状态`}
                className="segmented-control segmented"
                role={readOnly ? undefined : "group"}
              >
                {readOnly ? (
                  <span className="status gray">
                    {states.find((state) => state.value === anchors[anchor.key])?.label ?? "未记录"}
                  </span>
                ) : (
                  states.map((state) => (
                    <button
                      aria-label={state.label}
                      aria-pressed={anchors[anchor.key] === state.value}
                      className="segment"
                      data-state={state.value ?? "unknown"}
                      disabled={pending !== null || state.value === null}
                      key={state.label}
                      onClick={() => void updateAnchor(anchor.key, state.value)}
                      type="button"
                    >
                      {state.label === "未记录" ? "未填写" : state.label}
                    </button>
                  ))
                )}
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

      <div className="grid two section">
        <section aria-labelledby="confirm-title">
          <div className="section-head">
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

        <section aria-labelledby="skip-title">
          <div className="section-head">
            <h2 id="skip-title">今天可以不做</h2>
          </div>
          <p className="permission-card">
            不需要追赶缺失记录，也不用提前报告今晚是否完成晚间降速。
          </p>
        </section>
      </div>

      <section className="section card pad privacy-card" aria-labelledby="privacy-title">
        <div>
          <p className="kicker">PRIVACY AND SAVE PATH</p>
          <h2 id="privacy-title">隐私与保存链路</h2>
          <p className="quiet-note">
            Life Console 是本地工作站界面。它帮助你读懂 iCloud 项目中的事实，但不会把敏感内容默认发布到网页、表格或任何外部服务。
          </p>
        </div>
        <div className="chain" aria-label="保存链路">
          <article className="chain-step">
            <span className="step-index">01</span>
            <div>
              <h3>本机读取</h3>
              <p>页面优先展示本机可见的项目状态，减少跨工具来回确认。</p>
            </div>
          </article>
          <article className="chain-step">
            <span className="step-index">02</span>
            <div>
              <h3>iCloud 真相源</h3>
              <p>日记、目标、台账与阶段决定以 iCloud 项目文件为准。</p>
            </div>
          </article>
          <article className="chain-step">
            <span className="step-index">03</span>
            <div>
              <h3>真实写入需确认</h3>
              <p>任何会改变记录、同步状态或长期记忆的动作，都需要当次明确确认。</p>
            </div>
          </article>
        </div>
      </section>
      <p className="footer-note">页面只呈现安全投影；真实记录与状态仍以 iCloud 项目为准。</p>
    </section>
  );
}
