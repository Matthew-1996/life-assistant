import { useEffect, useState } from "react";

import { ApiError, type LifeConsoleClient } from "../../api/client";
import type { PageId } from "../../components/shell/AppShell";
import type { components } from "../../contracts/life-console";
import type { Dashboard } from "../../data/dashboard";
import type { DailyNewsClient } from "../../domain/daily-news";
import type { TodoRepositoryPort } from "../../domain/todos";
import { useSessionDraft } from "../../hooks/useSessionDraft";
import { SESSION_DRAFT_STORAGE_PREFIX } from "../../lib/draft-storage";
import type { DashboardMessageRepositoryPort } from "../../supabase/dashboard-messages";
import { WeeklyMessageHero } from "../messages/WeeklyMessageHero";
import { DailyNewsPanel } from "../news/DailyNewsPanel";
import { TodoPanel } from "../todos/TodoPanel";

type Anchors = Dashboard["today"]["anchors"];
type AnchorKey = keyof Anchors;
type AnchorState = NonNullable<Anchors[AnchorKey]> | null;
type AnchorDraft = {
  expectRevision: number | null;
  key: AnchorKey;
  targetDate: string;
  value: NonNullable<AnchorState>;
};

const anchorCopy: Array<{ key: AnchorKey; title: string; description: string }> = [
  { key: "wake", title: "起床", description: "已离开床；不自动表示晒到太阳。" },
  { key: "body_light", title: "身体 / 光照", description: "出门、晒太阳、散步，或约 5 分钟最低版。" },
  { key: "life_action", title: "生活动作", description: "一件不为工作或自我改造服务的生活活动。" },
  { key: "wind_down", title: "晚间降速", description: "睡前从高刺激切到低刺激，白天可保持未知。" },
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
  dailyNews?: DailyNewsClient;
  dashboardMessages?: DashboardMessageRepositoryPort;
  draftScope?: string;
  mode?: "local" | "sites" | "candidate-preview" | "supabase-candidate" | "supabase-production";
  onNavigate?: (page: PageId) => void;
  onSaved?: () => boolean | Promise<boolean>;
  sourceTruth?: "ICLOUD_PRIMARY" | "SITES_D1_PRIMARY";
  todos?: TodoRepositoryPort;
}

export function TodayPage({
  client,
  dailyNews,
  dashboard,
  dashboardMessages,
  draftScope = "anonymous",
  mode = "local",
  onSaved,
  todos,
}: TodayPageProps) {
  const supabaseMode = mode === "supabase-candidate" || mode === "supabase-production";
  const saveTarget = mode === "supabase-production"
    ? "线上数据库"
    : mode === "supabase-candidate"
      ? "Supabase 候选环境"
      : mode === "sites" ? "云端真相源" : "iCloud";
  const [anchors, setAnchors] = useState<Anchors>(dashboard.today.anchors);
  const [conflict, setConflict] = useState<components["schemas"]["CheckinConflict"] | null>(null);
  const [pending, setPending] = useState<AnchorKey | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const { persist: persistAnchorDraft, value: anchorDraft } = useSessionDraft<AnchorDraft | null>(
    `${SESSION_DRAFT_STORAGE_PREFIX}${draftScope}:today-anchor`,
    null,
    (value) => !supabaseMode || value === null,
  );

  useEffect(() => {
    setAnchors(dashboard.today.anchors);
  }, [dashboard.today.anchors]);

  async function updateAnchor(key: AnchorKey, value: AnchorState, retryDraft?: AnchorDraft) {
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
      setStatus("合成演示已更新；未写入真实数据。");
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
      setStatus(refreshed === false ? `已保存到${saveTarget}，但页面暂时无法刷新。` : result.message);
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
          if (!current
            || current.key !== resolvingDraft.key
            || current.value !== resolvingDraft.value
            || current.targetDate !== resolvingDraft.targetDate
            || current.expectRevision !== resolvingDraft.expectRevision) return current;
          return { ...current, expectRevision: conflict?.current_revision ?? dashboard.today.daily_revision };
        });
      } else if (resolvingDraft && resolvingDraft.targetDate !== dashboard.date) {
        setStatus(`已读取当前日期的最新记录；${resolvingDraft.targetDate} 的草稿请到记录页核对后再保存。`);
        setConflict(null);
        return;
      }
      setConflict(null);
      setStatus("已读取最新记录；本次未覆盖。");
    } finally {
      setResolvingConflict(false);
    }
  }

  const completedAnchors = Object.values(anchors).filter(Boolean).length;

  return (
    <section aria-labelledby="today-title" className="workbench-250">
      <WeeklyMessageHero date={dashboard.date} repository={dashboardMessages} />

      <div className="workbench-primary" data-wide-layout="8-4">
        <div className="workbench-primary__item"><TodoPanel repository={todos} /></div>
        <div className="workbench-primary__item"><DailyNewsPanel client={dailyNews} /></div>
      </div>

      <section aria-label="今日锚点" className="card pad anchor-section-250 section" role="region">
        <div className="section-head">
          <div>
            <p className="kicker">TODAY ANCHORS</p>
            <h2>今日锚点</h2>
            <p className="quiet">保留未填写、完成、最低版与跳过的不同语义；点击即可修改。</p>
          </div>
          <span className="anchor-progress">{completedAnchors} / 4 已填写</span>
        </div>
        <div className="anchor-grid">
          {anchorCopy.map((anchor) => (
            <article className="anchor-card-250" key={anchor.key}>
              <div>
                <p className="anchor-title">{anchor.title}</p>
                <p className="anchor-help">{anchor.description}</p>
              </div>
              <div aria-label={`${anchor.title}状态`} className="segmented-control segmented" role="group">
                {states.map((state) => (
                  <button
                    aria-label={state.label}
                    aria-pressed={anchors[anchor.key] === state.value}
                    className="segment"
                    data-state={state.value ?? "unknown"}
                    data-write-control
                    disabled={pending !== null || resolvingConflict || conflict !== null || state.value === null}
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

      {status && <p className="save-receipt" role="status">{status}</p>}

      {anchorDraft && pending === null && (
        <section aria-label="今日锚点未保存草稿" className="service-banner" role="region">
          <p>
            未保存草稿：{anchorCopy.find((item) => item.key === anchorDraft.key)?.title}
            · {states.find((item) => item.value === anchorDraft.value)?.label}
            · {anchorDraft.targetDate}
          </p>
          <div className="button-row">
            <button className="secondary-button" disabled={conflict !== null || resolvingConflict} onClick={() => void updateAnchor(anchorDraft.key, anchorDraft.value, anchorDraft)} type="button">重试保存</button>
            <button className="secondary-button" disabled={conflict !== null || resolvingConflict} onClick={() => {
              void persistAnchorDraft(null);
              setStatus("已放弃本次未保存选择；真实状态未改变。");
            }} type="button">放弃草稿</button>
          </div>
        </section>
      )}

      {conflict && (
        <section aria-label="状态冲突" className="conflict-card">
          <h2>状态已在其他位置更新</h2>
          <div>
            <article><strong>当前值</strong><pre>{JSON.stringify(conflict.current, null, 2)}</pre></article>
            <article><strong>本次提交</strong><pre>{JSON.stringify(conflict.submitted, null, 2)}</pre></article>
          </div>
          <button className="secondary-button" disabled={resolvingConflict} onClick={() => void useLatestRecord()} type="button">
            {resolvingConflict ? "正在读取…" : "使用最新记录"}
          </button>
        </section>
      )}
    </section>
  );
}
