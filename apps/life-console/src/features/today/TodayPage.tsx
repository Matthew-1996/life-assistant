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
  onNavigate?: (page: PageId) => void;
  onSaved?: () => boolean | Promise<boolean>;
}

export function TodayPage({
  dashboard,
  client,
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
      <section className="hero-grid" aria-labelledby="today-title">
        <div className="hero-panel focus-card">
          <div>
            <p className="eyebrow">MAC-ONLY LOCAL WORKSTATION</p>
            <h1 id="today-title">今天，只看必要信息</h1>
            <p className="hero-copy">
              不追赶、不误报、不把趋势当结论。总览页只把今天真正需要处理的生活信号放在桌面上，其余内容留给记录与进展页慢慢整理。
            </p>
          </div>
          <div className="hero-actions" aria-label="主要操作">
            <button
              className="primary-button"
              onClick={() => onNavigate?.("records")}
              type="button"
            >
              快速记录
            </button>
            <button
              className="secondary-button"
              onClick={() => onNavigate?.("progress")}
              type="button"
            >
              查看进展
            </button>
          </div>
        </div>

        <aside className="status-panel card" aria-label="今日状态摘要">
          <header>
            <div>
              <p className="kicker">今日桌面</p>
              <h2>只保留可行动的提醒</h2>
              <p className="quiet-note">这里不会把单日波动包装成结论，也不会自动替你决定写入真实记录。</p>
            </div>
          </header>
          <div className="metric-stack" aria-label="保存与确认状态">
            <div className="metric-row">
              <span>真相源</span>
              <strong>iCloud 项目</strong>
            </div>
            <div className="metric-row">
              <span>默认动作</span>
              <strong>只读整理</strong>
            </div>
            <div className="metric-row">
              <span>真实写入</span>
              <strong>确认后执行</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="info-grid" aria-label="必要信息区">
        <article className="card quiet-card">
          <span className="card-label">当前重点</span>
          <h3>{dashboard.today.focus.title || "把今天压缩到一件主事"}</h3>
          <p>先看工作台与最近记录，只选择一个最能降低摩擦的生活或工作动作，避免把清单扩成新的负担。</p>
        </article>
        <article className="card quiet-card">
          <span className="card-label">一个建议行动</span>
          <h3>{dashboard.today.suggested_action?.label ?? "先做 5 分钟小版本"}</h3>
          <p>如果精力不足，优先完成一个可停止的小动作：整理桌面、出门见光、写下事实，任意一种都可以。</p>
        </article>
        <article className="card quiet-card">
          <span className="card-label">待确认</span>
          <h3>{dashboard.today.confirmations.length ? "写入前再问一次" : "现在没有必须确认的事"}</h3>
          <p>日记、状态、阶段决定与对外同步都需要明确边界；未确认的内容只作为页面提示，不进入台账。</p>
        </article>
      </section>

      {dashboard.today.active_projects.length > 0 && (
        <section
          aria-labelledby="active-projects-title"
          className="section-block"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">已确认辅助目标</p>
              <h2 id="active-projects-title">本周试行项目</h2>
            </div>
            <span className="supporting-text">来自 iCloud 项目，不建立新的 Todo 真相源</span>
          </div>
          <div className="active-project-grid">
            {dashboard.today.active_projects.map((project) => (
              <article
                className="active-project-card"
                key={`${project.plan_path}:${project.title}`}
              >
                <div className="active-project-meta">
                  <span className="neutral-badge">只读项目</span>
                  <span>{project.period}</span>
                </div>
                <h3>{project.title}</h3>
                <p>{project.summary}</p>
                <div className="active-project-footer">
                  <strong>{project.status}</strong>
                  <code>{project.plan_path}</code>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {dashboard.today.suggested_action && (
        <section className="section-block" aria-labelledby="action-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">一个行动</p>
              <h2 id="action-title">现在可以做什么</h2>
            </div>
          </div>
          <article className="action-card">
            <div>
              <strong>{dashboard.today.suggested_action.label}</strong>
              <p>来自已确认计划；一期不建立新的 Todo 台账。</p>
            </div>
            <span className="neutral-badge">仅建议</span>
          </article>
        </section>
      )}

      <section className="section-block" aria-labelledby="anchors-title">
        <div className="section-heading section-title">
          <h2 id="anchors-title">今日锚点</h2>
          <p>四个锚点只用于帮助回到现实节奏。状态采用分段胶囊展示，保留“未填写”作为正常选项。</p>
        </div>
        <div className="anchor-grid">
          {anchorCopy.map((anchor) => (
            <article className="card anchor-card" key={anchor.key}>
              <div>
                <p className="anchor-title">{anchor.title}</p>
                <p className="anchor-help">{anchor.description}</p>
              </div>
              <div
                aria-label={`${anchor.title}状态`}
                className="segmented-control segmented"
                role="group"
              >
                {states.map((state) => (
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

      <section className="section-block card privacy-card" aria-labelledby="privacy-title">
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
    </section>
  );
}
