import { useEffect, useState } from "react";

import { ApiError, type LifeConsoleClient } from "../../api/client";
import type { components } from "../../contracts/life-console";
import type { Dashboard } from "../../data/dashboard";
import type { PageId } from "../../components/shell/AppShell";
import { useSessionDraft } from "../../hooks/useSessionDraft";
import { SESSION_DRAFT_STORAGE_PREFIX } from "../../lib/draft-storage";

type Anchors = Dashboard["today"]["anchors"];
type AnchorKey = keyof Anchors;
type AnchorState = NonNullable<Anchors[AnchorKey]> | null;
type AnchorDraft = {
  expectRevision: number | null;
  key: AnchorKey;
  targetDate: string;
  value: NonNullable<AnchorState>;
};

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

function currentWeekPathIndex(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return 5;
  return day - 1;
}

interface TodayPageProps {
  dashboard: Dashboard;
  client?: LifeConsoleClient;
  mode?: "local" | "sites" | "candidate-preview" | "supabase-candidate" | "supabase-production";
  onNavigate?: (page: PageId) => void;
  onSaved?: () => boolean | Promise<boolean>;
  sourceTruth?: "ICLOUD_PRIMARY" | "SITES_D1_PRIMARY";
  draftScope?: string;
}

export function TodayPage({
  dashboard,
  client,
  mode = "local",
  onNavigate,
  onSaved,
  sourceTruth,
  draftScope = "anonymous",
}: TodayPageProps) {
  const supabaseCandidate = mode === "supabase-candidate" || mode === "supabase-production";
  const supabaseProduction = mode === "supabase-production";
  const todayPathIndex = currentWeekPathIndex(dashboard.date);
  const sitesPrimary = mode === "sites" && sourceTruth === "SITES_D1_PRIMARY";
  const saveTarget = mode === "candidate-preview"
    ? "候选预览"
    : supabaseCandidate
      ? supabaseProduction ? "线上数据库" : "Supabase 候选环境"
      : mode === "sites" ? "云端真相源" : "iCloud";
  const [anchors, setAnchors] = useState<Anchors>(dashboard.today.anchors);
  const [conflict, setConflict] = useState<components["schemas"]["CheckinConflict"] | null>(null);
  const [pending, setPending] = useState<AnchorKey | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const {
    persist: persistAnchorDraft,
    value: anchorDraft,
  } = useSessionDraft<AnchorDraft | null>(
    `${SESSION_DRAFT_STORAGE_PREFIX}${draftScope}:today-anchor`,
    null,
    (value) => !supabaseCandidate || value === null,
  );
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setAnchors(dashboard.today.anchors);
  }, [dashboard.today.anchors]);

  async function updateAnchor(
    key: AnchorKey,
    value: AnchorState,
    retryDraft?: AnchorDraft,
  ) {
    setStatus(null);
    if (conflict) {
      setStatus("请先处理当前冲突，再保存新选择。");
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
    const nextDraft: AnchorDraft = retryDraft ?? {
      expectRevision: dashboard.today.daily_revision,
      key,
      targetDate: dashboard.date,
      value,
    };
    setPending(key);
    setStatus(`正在保存“${anchorCopy.find((item) => item.key === key)?.title ?? key}”状态…`);
    try {
      await persistAnchorDraft(nextDraft);
      const result = await client.checkin(nextDraft.targetDate, {
        schema_version: 1,
        expect_revision: nextDraft.expectRevision,
        fields: { [key]: value },
      });
      await persistAnchorDraft(null);
      const refreshed = await onSaved?.();
      setStatus(
        refreshed === false
          ? `已保存到${saveTarget}，但页面暂时无法刷新。`
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
    if (resolvingConflict) return;
    const resolvingDraft = anchorDraft;
    setResolvingConflict(true);
    setStatus("正在读取最新记录…");
    try {
      const refreshed = await onSaved?.();
      if (refreshed === false) {
        setStatus("暂时无法读取最新记录，冲突仍保留。");
        return;
      }
      if (resolvingDraft && resolvingDraft.targetDate === dashboard.date) {
        await persistAnchorDraft((current) => {
          if (
            !current
            || current.key !== resolvingDraft.key
            || current.value !== resolvingDraft.value
            || current.targetDate !== resolvingDraft.targetDate
            || current.expectRevision !== resolvingDraft.expectRevision
          ) return current;
          return {
            ...current,
            expectRevision: conflict?.current_revision
              ?? dashboard.today.daily_revision,
          };
        });
      } else if (
        resolvingDraft
        && resolvingDraft.targetDate !== dashboard.date
      ) {
        setStatus(
          `已读取当前日期的最新记录；${resolvingDraft.targetDate} 的草稿请到记录页核对后再保存。`,
        );
        setConflict(null);
        return;
      }
      setConflict(null);
      setStatus("已读取最新记录；本次未覆盖。");
    } finally {
      setResolvingConflict(false);
    }
  }

  return (
    <section aria-labelledby="today-title">
      <section className="hero" aria-labelledby="today-title">
        <div>
          <p className="eyebrow">
            {dashboard.date} · {supabaseCandidate ? "生产环境" : "本周试行"}
          </p>
          <h1 id="today-title">
            {supabaseCandidate ? "今天，从真实数据开始。" : "一周试行控制台。"}
          </h1>
          <p className="lead">
            {supabaseCandidate
              ? "这里仅呈现当前账号在 Supabase 中明确保存的数据。没有记录就保持未知，不使用示例内容填满页面。"
              : "本周只验证两条轨道：运动恢复与 Agent 实操。今天不追求完整完成，只选择一个最低可执行版本，让生活系统继续保持轻。"}
          </p>
          <div className="pill-row hero-actions" aria-label="主要操作">
            <button className="button primary" onClick={() => onNavigate?.("records")} type="button">
              记录今天
            </button>
            <button className="button ghost" onClick={() => onNavigate?.("progress")} type="button">
              查看自然周路径
            </button>
            <span className="pill">不补作业</span>
            <span className="pill">缺失值保持未知</span>
          </div>
        </div>

        <aside className="card hero-card" aria-label="今日最低版建议">
          <span className="status blue">
            {supabaseCandidate ? "今日状态" : "今日只做一个"}
          </span>
          <h2>
            {dashboard.today.suggested_action?.label
              ?? (supabaseCandidate ? "还没有明确建议" : "先做一个最低版")}
          </h2>
          <p className="quiet">
            {supabaseCandidate
              ? "可以先记录一个锚点或一项主观评分；其余字段继续保持未知。"
              : "精力低时只保留一个可停止的小动作。最低版是有效观察，跳过也不需要追赶。"}
          </p>
          <div className="grid two metric-grid">
            <div className="metric">
              <strong>{dashboard.today.active_projects.length}</strong>
              <span>当前目标</span>
            </div>
            <div className="metric">
              <strong>
                {Object.values(dashboard.today.anchors).filter(Boolean).length}
              </strong>
              <span>已记录锚点</span>
            </div>
          </div>
        </aside>
      </section>

      {dashboard.today.active_projects.length > 0 && (
        <section
          aria-labelledby="active-projects-title"
          aria-label={supabaseCandidate ? "当前目标" : "本周双轨试行"}
          className="section grid two"
        >
          <h2 className="sr-only" id="active-projects-title">
            {supabaseCandidate ? "当前目标" : "本周双轨试行"}
          </h2>
          {dashboard.today.active_projects.map((project, index) => (
            <article className="card pad track-card" key={`${project.plan_path}:${project.title}`}>
              <div className="track-dot">{supabaseCandidate ? index + 1 : index === 0 ? "身" : "A"}</div>
              <div>
                <div className="section-head compact-head">
                  <h2>{project.title}</h2>
                  <span className="status gray">
                    {supabaseCandidate ? "当前目标" : "只读项目"}
                  </span>
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

      {supabaseCandidate && dashboard.today.active_projects.length === 0 && (
        <section className="section card pad" aria-label="目标空态">
          <div className="section-head">
            <div>
              <h2>当前目标</h2>
              <p className="quiet">还没有目标；这里不会用示例项目替代真实空态。</p>
            </div>
            <button className="button ghost" onClick={() => onNavigate?.("progress")} type="button">
              去进展页创建
            </button>
          </div>
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
            <div className={`day-row ${index === todayPathIndex ? "today" : ""}`} key={label}>
              <strong>{label}</strong>
              <span>
                {supabaseCandidate
                  ? "按日期观察，缺失保持未知"
                  : dashboard.today.active_projects[index % Math.max(dashboard.today.active_projects.length, 1)]?.title
                    ?? dashboard.today.focus.title}
              </span>
              <span className={`status ${index === todayPathIndex ? "blue" : "gray"}`}>
                {index === todayPathIndex ? "今日建议" : "可回退"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="section grid three" aria-label="控制台原则">
        <article className="card pad">
          <span className="status blue">原则 01</span>
          <h3>{supabaseCandidate ? "只显示可追溯数据" : "今日只突出一个主项"}</h3>
          <p className="quiet">
            {supabaseCandidate
              ? "工作台不从旧演示或浏览器缓存补写内容。"
              : "运动和 Agent 不要求同日都做，避免把恢复期变成双倍任务。"}
          </p>
        </article>
        <article className="card pad">
          <span className="status blue">原则 02</span>
          <h3>{supabaseCandidate ? "未知不是跳过" : "最低版不是失败"}</h3>
          <p className="quiet">
            {supabaseCandidate
              ? "没有填写的字段保持未知，不推断，也不计为失败。"
              : "短时活动或一句下一步都算有效观察，不制造连续打卡压力。"}
          </p>
        </article>
        <article className="card pad">
          <span className="status blue">原则 03</span>
          <h3>保存状态明确可见</h3>
          <p className="quiet">保存中、成功、冲突或失败都会明确反馈，失败不丢草稿。</p>
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
                role="group"
              >
                {states.map((state) => (
                  <button
                    aria-label={state.label}
                    aria-pressed={anchors[anchor.key] === state.value}
                    className="segment"
                    data-write-control
                    data-state={state.value ?? "unknown"}
                    disabled={pending !== null
                      || resolvingConflict
                      || conflict !== null
                      || state.value === null}
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

      {anchorDraft && pending === null && (
        <section
          aria-label="今日锚点未保存草稿"
          className="service-banner"
        >
          <p>
            未保存草稿：
            {anchorCopy.find((item) => item.key === anchorDraft.key)?.title}
            · {states.find((item) => item.value === anchorDraft.value)?.label}
            · {anchorDraft.targetDate}
          </p>
          <div className="button-row">
            <button
              className="secondary-button"
              disabled={conflict !== null || resolvingConflict}
              onClick={() => void updateAnchor(
                anchorDraft.key,
                anchorDraft.value,
                anchorDraft,
              )}
              type="button"
            >
              重试保存
            </button>
            <button
              className="secondary-button"
              disabled={conflict !== null || resolvingConflict}
              onClick={() => {
                void persistAnchorDraft(null);
                setStatus("已放弃本次未保存选择；真实状态未改变。");
              }}
              type="button"
            >
              放弃草稿
            </button>
          </div>
        </section>
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
          <button
            className="secondary-button"
            disabled={resolvingConflict}
            onClick={() => void useLatestRecord()}
            type="button"
          >
            {resolvingConflict ? "正在读取…" : "使用最新记录"}
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
            {supabaseProduction
              ? "当前页面通过 Owner 会话读写 Supabase 唯一真相源；iCloud 仅接收经过校验的单向备份。"
              : supabaseCandidate
              ? "当前页面通过 Owner 会话读写独立 Supabase 测试环境，只允许纯合成测试数据；iCloud 私人真相源没有读取、上传或切换。"
              : mode === "candidate-preview"
              ? "当前仅展示内置合成数据；页面没有 API client，不读取或写入 D1、R2、KEK 与 iCloud。"
              : mode === "sites"
              ? sitesPrimary
                ? "Life Console 通过 Owner-only Sites API 读取和写入 D1；日记原文与健康明细使用字段级加密，iCloud 只接收单向冷备。"
                : "Life Console 已连接 Owner-only Sites API 与空白 D1；真实生活数据和唯一真相源继续保留在 iCloud。"
              : "Life Console 是本地工作站界面。它帮助你读懂 iCloud 项目中的事实，但不会把敏感内容默认发布到网页、表格或任何外部服务。"}
          </p>
        </div>
        <div className="chain" aria-label="保存链路">
          <article className="chain-step">
            <span className="step-index">01</span>
            <div>
              <h3>{supabaseCandidate ? "Owner 会话" : mode === "candidate-preview" ? "合成投影" : mode === "sites" ? "Owner-only 读取" : "本机读取"}</h3>
              <p>{supabaseCandidate ? "页面只读取当前登录账号在 Supabase 中可见的数据。" : mode === "candidate-preview" ? "页面只加载随构建发布的非个人合成数据。" : mode === "sites" ? "页面通过受控 Sites 会话读取最小必要投影。" : "页面优先展示本机可见的项目状态，减少跨工具来回确认。"}</p>
            </div>
          </article>
          <article className="chain-step">
            <span className="step-index">02</span>
            <div>
              <h3>{supabaseCandidate ? "数据真相源" : mode === "candidate-preview" ? "不绑定真相源" : mode === "sites" ? sitesPrimary ? "D1 唯一真相源" : "iCloud 真相源" : "iCloud 真相源"}</h3>
              <p>{supabaseProduction ? "Supabase 是生活记录的唯一真相源；iCloud 仅保留单向备份与恢复副本。" : supabaseCandidate ? "当前候选仅连接独立测试数据源，不改变 iCloud 真相源。" : mode === "candidate-preview" ? "候选环境不连接 D1、R2 或 iCloud。" : mode === "sites" ? sitesPrimary ? "所有写入使用 revision、幂等、审计与字段级加密。" : "空白 D1 只用于阶段 C 基础设施验收；尚未读取或上传真实 iCloud 数据。" : "日记、目标、台账与阶段决定以 iCloud 项目文件为准。"}</p>
            </div>
          </article>
          <article className="chain-step">
            <span className="step-index">03</span>
            <div>
              <h3>{supabaseCandidate ? "显式保存" : mode === "candidate-preview" ? "候选不可写" : "真实写入需确认"}</h3>
              <p>{supabaseCandidate ? "只有点击保存才写入；revision 冲突不会静默覆盖。" : mode === "candidate-preview" ? "所有写控件仅展示禁用态，触发时只显示只读提示。" : mode === "sites" ? sitesPrimary ? "写入成功后进入 iCloud 单向冷备队列；冲突不会静默覆盖。" : "真实数据写入仍需后续独立确认；当前只验证基础设施。" : "任何会改变记录、同步状态或长期记忆的动作，都需要当次明确确认。"}</p>
            </div>
          </article>
        </div>
      </section>
      <p className="footer-note">
        {supabaseProduction
          ? "ONLINE_PRIMARY · Supabase 唯一真相源 · iCloud 单向备份。"
          : supabaseCandidate
          ? "mode=SUPABASE_CANDIDATE · 纯合成测试数据 · ICLOUD_PRIMARY 未切换。"
          : mode === "candidate-preview"
          ? "mode=CANDIDATE_PREVIEW · 合成数据 · 无真相源绑定。"
          : mode === "sites"
          ? sitesPrimary
            ? "页面只呈现安全投影；D1 是唯一真相源，iCloud 是单向冷备。"
            : "阶段 C 基础设施状态：真实记录仍以 iCloud 为准；空白 D1 未接收真实生活数据。"
          : "页面只呈现安全投影；真实记录与状态仍以 iCloud 项目为准。"}
      </p>
    </section>
  );
}
