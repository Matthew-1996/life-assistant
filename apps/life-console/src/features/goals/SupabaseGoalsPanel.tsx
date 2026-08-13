import {
  type FormEvent,
  type ReactElement,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

import { useSessionDraft } from "../../hooks/useSessionDraft";
import { SESSION_DRAFT_STORAGE_PREFIX } from "../../lib/draft-storage";
import type {
  Goal,
  GoalRepositoryPort,
  GoalStatus,
} from "../../supabase/goals";
import {
  RepositoryError,
  type Cursor,
} from "../../supabase/repository";

export interface SupabaseGoalsPanelProps {
  repository: GoalRepositoryPort;
  createIdempotencyKey?: () => string;
  now?: () => string;
  onSaved?: () => boolean | void | Promise<boolean | void>;
  draftScope?: string;
}

interface GoalsDraft {
  conflict: GoalConflict | null;
  createFingerprint: string | null;
  createKey: string | null;
  createTitle: string;
  editingId: number | null;
  editingTitle: string;
}

const EMPTY_GOALS_DRAFT: GoalsDraft = {
  conflict: null,
  createFingerprint: null,
  createKey: null,
  createTitle: "",
  editingId: null,
  editingTitle: "",
};

function goalsDraftIsEmpty(draft: GoalsDraft): boolean {
  return draft.conflict == null
    && draft.createTitle === ""
    && draft.createKey === null
    && draft.createFingerprint === null
    && draft.editingId === null
    && draft.editingTitle === "";
}

function goalCreateFingerprint(title: string): string {
  return JSON.stringify({ status: "active", title: title.trim() });
}

interface Notice {
  kind: "success" | "error";
  message: string;
}

interface GoalConflict {
  draftTitle: string;
  id: number;
  latestLoaded: boolean;
  latestTitle: string | null;
}

const PAGE_SIZE = 20;

const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  draft: "草稿",
  active: "进行中",
  completed: "已完成",
  archived: "已归档",
};

function defaultIdempotencyKey(): string {
  return `goal_${crypto.randomUUID().replaceAll("-", "")}`;
}

function cursorMarker(cursor: Cursor): string {
  return `${cursor.sortValue}:${cursor.id}`;
}

function errorNotice(error: unknown): Notice {
  if (
    error instanceof RepositoryError
    && error.kind === "conflict"
  ) {
    return {
      kind: "error",
      message:
        "记录已在其他页面更新；输入仍保留，请重新载入后比较。",
    };
  }
  return {
    kind: "error",
    message: "尚未保存；输入仍保留，可稍后重试。",
  };
}

export function SupabaseGoalsPanel({
  repository,
  createIdempotencyKey = defaultIdempotencyKey,
  now = () => new Date().toISOString(),
  onSaved,
  draftScope = "anonymous",
}: SupabaseGoalsPanelProps): ReactElement {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const listGeneration = useRef(0);
  const seenCursors = useRef(new Set<string>());
  const [statusFilter, setStatusFilter] = useState<"all" | GoalStatus>(
    "all",
  );
  const {
    persist: persistDraft,
    setValue: setDraft,
    value: draft,
  } = useSessionDraft(
    `${SESSION_DRAFT_STORAGE_PREFIX}${draftScope}:goals`,
    EMPTY_GOALS_DRAFT,
    goalsDraftIsEmpty,
  );
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const conflict = draft.conflict ?? null;

  function setConflict(
    action: SetStateAction<GoalConflict | null>,
  ): void {
    setDraft((current) => ({
      ...current,
      conflict: typeof action === "function"
        ? action(current.conflict ?? null)
        : action,
    }));
  }

  const visibleGoals = statusFilter === "all"
    ? goals
    : goals.filter((goal) => goal.status === statusFilter);

  async function notifySaved(): Promise<void> {
    try {
      await onSaved?.();
    } catch {
      // The write is already durable; a read-model refresh failure is shown by App.
    }
  }

  useEffect(() => {
    const generation = ++listGeneration.current;
    let active = true;
    seenCursors.current.clear();
    setLoading(true);
    setLoadingMore(false);
    setLoadFailed(false);
    setLoadMoreFailed(false);
    void repository.list({ pageSize: PAGE_SIZE })
      .then((page) => {
        if (active && generation === listGeneration.current) {
          setGoals(page.items);
          setNextCursor(page.nextCursor);
          if (page.nextCursor) {
            seenCursors.current.add(cursorMarker(page.nextCursor));
          }
        }
      })
      .catch(() => {
        if (active && generation === listGeneration.current) {
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (active && generation === listGeneration.current) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, repository]);

  async function loadMoreGoals(): Promise<void> {
    if (!nextCursor || loadingMore) return;
    const generation = listGeneration.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const page = await repository.list({
        pageSize: PAGE_SIZE,
        cursor: nextCursor,
      });
      if (generation !== listGeneration.current) return;
      setGoals((current) => {
        const known = new Set(current.map((goal) => goal.id));
        return [
          ...current,
          ...page.items.filter((goal) => !known.has(goal.id)),
        ];
      });
      if (
        page.nextCursor
        && seenCursors.current.has(cursorMarker(page.nextCursor))
      ) {
        setNextCursor(null);
        setLoadMoreFailed(true);
      } else {
        if (page.nextCursor) {
          seenCursors.current.add(cursorMarker(page.nextCursor));
        }
        setNextCursor(page.nextCursor);
      }
    } catch {
      if (generation === listGeneration.current) setLoadMoreFailed(true);
    } finally {
      if (generation === listGeneration.current) setLoadingMore(false);
    }
  }

  async function findLatestGoal(id: number): Promise<Goal | null> {
    let cursor: Cursor | undefined;
    const visited = new Set<string>();
    do {
      const page = await repository.list({
        pageSize: 100,
        ...(cursor ? { cursor } : {}),
      });
      const match = page.items.find((goal) => goal.id === id);
      if (match) return match;
      if (!page.nextCursor) return null;
      const marker = `${page.nextCursor.sortValue}:${page.nextCursor.id}`;
      if (visited.has(marker)) return null;
      visited.add(marker);
      cursor = page.nextCursor;
    } while (cursor);
    return null;
  }

  async function loadLatestGoal(): Promise<void> {
    if (!conflict || pending !== null) return;
    const retainedDraft = draft.editingId === conflict.id
      ? draft.editingTitle
      : conflict.draftTitle;
    setPending(`reload:${conflict.id}`);
    try {
      const latest = await findLatestGoal(conflict.id);
      if (!latest) {
        setNotice({
          kind: "error",
          message: "未找到最新目标；当前草稿仍保留，请稍后重试。",
        });
        return;
      }
      setGoals((current) => current.map((goal) =>
        goal.id === latest.id ? latest : goal));
      await persistDraft((current) => ({
        ...current,
        conflict: current.conflict
          ? {
            ...current.conflict,
            draftTitle: retainedDraft,
            latestLoaded: true,
            latestTitle: latest.title,
          }
          : null,
      }));
      setNotice({
        kind: "success",
        message: "已载入最新目标；冲突前草稿仍保留在下方，可比较后再决定。",
      });
    } catch {
      setNotice({
        kind: "error",
        message: "最新目标暂时无法读取；当前草稿仍保留。",
      });
    } finally {
      setPending(null);
    }
  }

  async function restoreConflictDraft(): Promise<void> {
    if (!conflict?.latestLoaded) return;
    await persistDraft((current) => ({
      ...current,
      conflict: null,
      editingId: conflict.id,
      editingTitle: conflict.draftTitle,
    }));
    setNotice({
      kind: "success",
      message: "已恢复冲突前草稿；下次保存将使用已载入的最新版本。",
    });
  }

  async function keepLatestConflictVersion(): Promise<void> {
    if (!conflict?.latestLoaded || conflict.latestTitle === null) return;
    if (draft.editingId === conflict.id) {
      await persistDraft((current) => ({
        ...current,
        conflict: null,
        editingTitle: conflict.latestTitle as string,
      }));
    } else {
      await persistDraft((current) => ({ ...current, conflict: null }));
    }
    setNotice({ kind: "success", message: "已保留服务器最新内容。" });
  }

  async function createGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (conflict) return;
    setPending("create");
    setNotice(null);
    const fingerprint = goalCreateFingerprint(draft.createTitle);
    const key = draft.createKey && draft.createFingerprint === fingerprint
      ? draft.createKey
      : createIdempotencyKey();
    try {
      await persistDraft((current) => ({
        ...current,
        createFingerprint: fingerprint,
        createKey: key,
      }));
      const created = await repository.create(key, {
        title: draft.createTitle,
        status: "active",
      });
      setGoals((current) => [
        created,
        ...current.filter((goal) => goal.id !== created.id),
      ]);
      await persistDraft((current) => ({
        ...current,
        createFingerprint: null,
        createKey: null,
        createTitle: "",
      }));
      setConflict(null);
      await notifySaved();
      setNotice({ kind: "success", message: "目标已保存。" });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setPending(null);
    }
  }

  function beginEdit(goal: Goal) {
    setDraft((current) => ({
      ...current,
      editingId: goal.id,
      editingTitle: goal.title,
    }));
    setConflict(null);
    setNotice(null);
  }

  async function updateGoal(
    event: FormEvent<HTMLFormElement>,
    goal: Goal,
  ) {
    event.preventDefault();
    setPending(`update:${goal.id}`);
    setNotice(null);
    try {
      const updated = await repository.update(
        goal.id,
        goal.revision,
        { title: draft.editingTitle },
      );
      setGoals((current) =>
        current.map((item) => item.id === updated.id ? updated : item));
      await persistDraft((current) => ({
        ...current,
        conflict: null,
        editingId: null,
        editingTitle: "",
      }));
      setConflict(null);
      await notifySaved();
      setNotice({ kind: "success", message: "目标修改已保存。" });
    } catch (error) {
      if (error instanceof RepositoryError && error.kind === "conflict") {
        await persistDraft((current) => ({
          ...current,
          conflict: {
            draftTitle: draft.editingTitle,
            id: goal.id,
            latestLoaded: false,
            latestTitle: null,
          },
        }));
      }
      setNotice(errorNotice(error));
    } finally {
      setPending(null);
    }
  }

  async function archiveGoal(goal: Goal) {
    setPending(`archive:${goal.id}`);
    setNotice(null);
    try {
      await repository.archive(goal.id, goal.revision, now());
      setGoals((current) =>
        current.filter((item) => item.id !== goal.id));
      setConflict(null);
      await notifySaved();
      setNotice({ kind: "success", message: "目标已归档。" });
    } catch (error) {
      if (error instanceof RepositoryError && error.kind === "conflict") {
        await persistDraft((current) => ({
          ...current,
          conflict: {
            draftTitle: goal.title,
            id: goal.id,
            latestLoaded: false,
            latestTitle: null,
          },
        }));
      }
      setNotice(errorNotice(error));
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      aria-labelledby="supabase-goals-title"
      className="supabase-goals-panel"
    >
      <div className="section-head">
        <div>
          <p className="eyebrow">GOALS</p>
          <h2 id="supabase-goals-title">目标</h2>
          <p className="quiet">
            创建、修订或归档目标；冲突和失败不会丢失输入。
          </p>
        </div>
        <span className="status blue">Owner-only</span>
      </div>

      <form className="supabase-goal-create" onSubmit={createGoal}>
        <label htmlFor="supabase-goal-title">目标名称</label>
        <div>
          <input
            disabled={conflict !== null || pending === "create"}
            id="supabase-goal-title"
            maxLength={200}
            onChange={(event) => setDraft((current) => ({
              ...current,
              createFingerprint: null,
              createKey: null,
              createTitle: event.target.value,
            }))}
            required
            value={draft.createTitle}
          />
          <button
            className="primary-button"
            disabled={conflict !== null || loading || pending !== null}
            type="submit"
          >
            {pending === "create" ? "正在保存…" : "新建目标"}
          </button>
        </div>
      </form>

      {notice ? (
        <p
          className={notice.kind === "error"
            ? "error-message"
            : "success-message"}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}

      {conflict ? (
        <section aria-labelledby="goal-conflict-title" className="conflict-card">
          <h3 id="goal-conflict-title">目标已在其他页面更新</h3>
          <p>冲突前草稿已保留；先载入最新版本，再比较和选择。</p>
          {conflict.latestTitle !== null ? (
            <label>
              服务器最新目标
              <input readOnly value={conflict.latestTitle} />
            </label>
          ) : null}
          <label>
            冲突前草稿
            <input readOnly value={conflict.draftTitle} />
          </label>
          <div className="button-row">
            <button
              className="secondary-button"
              disabled={pending !== null}
              onClick={() => void loadLatestGoal()}
              type="button"
            >
              {pending === `reload:${conflict.id}`
                ? "正在载入…"
                : "载入最新目标"}
            </button>
            {conflict.latestLoaded ? (
              <>
                <button
                  className="secondary-button"
                  disabled={pending !== null}
                  onClick={() => void restoreConflictDraft()}
                  type="button"
                >
                  恢复冲突前草稿
                </button>
                <button
                  className="secondary-button"
                  disabled={pending !== null}
                  onClick={() => void keepLatestConflictVersion()}
                  type="button"
                >
                  保留服务器最新内容
                </button>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {loading ? (
        <p className="quiet" role="status">正在读取目标…</p>
      ) : loadFailed ? (
        <div className="empty-state">
          <p>目标暂时无法读取。</p>
          <button
            className="secondary-button"
            onClick={() => setLoadAttempt((value) => value + 1)}
            type="button"
          >
            重新加载
          </button>
        </div>
      ) : goals.length === 0 ? (
        <div className="empty-state">
          <strong>还没有目标</strong>
          <p>新建后会显示在这里，不使用示例内容填充。</p>
        </div>
      ) : (
        <>
          <div className="supabase-record-filter">
            <label>
              筛选目标状态
              <select
                onChange={(event) => setStatusFilter(
                  event.target.value as "all" | GoalStatus,
                )}
                value={statusFilter}
              >
                <option value="all">全部状态</option>
                <option value="draft">草稿</option>
                <option value="active">进行中</option>
                <option value="completed">已完成</option>
                <option value="archived">已归档</option>
              </select>
            </label>
            <p className="quiet">
              筛选只作用于当前已加载的 {goals.length} 项
              {nextCursor ? "；继续加载可扩大筛选范围。" : "。"}
            </p>
          </div>
          {visibleGoals.length === 0 ? (
            <div className="empty-state">
              <strong>当前已加载记录中没有该状态的目标</strong>
              {nextCursor ? <p>可继续加载更多目标后再查看。</p> : null}
            </div>
          ) : <ul className="supabase-goal-list">
          {visibleGoals.map((goal) => (
            <li key={goal.id}>
              {draft.editingId === goal.id ? (
                <form onSubmit={(event) => updateGoal(event, goal)}>
                  <label htmlFor={`goal-edit-${goal.id}`}>
                    编辑目标名称
                  </label>
                  <input
                    id={`goal-edit-${goal.id}`}
                    disabled={pending === `reload:${goal.id}`
                      || pending === `update:${goal.id}`}
                    maxLength={200}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        editingTitle: event.target.value,
                      }))}
                    required
                    value={draft.editingTitle}
                  />
                  <div className="button-row">
                    <button
                      className="primary-button"
                      disabled={pending !== null}
                      type="submit"
                    >
                      {pending === `update:${goal.id}`
                        ? "正在保存…"
                        : "保存修改"}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={pending !== null}
                      onClick={() => setDraft((current) => ({
                        ...current,
                        editingId: null,
                        editingTitle: "",
                      }))}
                      type="button"
                    >
                      取消
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div>
                    <strong>{goal.title}</strong>
                    <span className="status gray">
                      {GOAL_STATUS_LABELS[goal.status]}
                    </span>
                  </div>
                  <div className="button-row">
                    <button
                      aria-label={`编辑 ${goal.title}`}
                      className="secondary-button"
                      disabled={conflict !== null || pending !== null}
                      onClick={() => beginEdit(goal)}
                      type="button"
                    >
                      编辑
                    </button>
                    <button
                      aria-label={`归档 ${goal.title}`}
                      className="secondary-button danger"
                      disabled={conflict !== null || pending !== null}
                      onClick={() => void archiveGoal(goal)}
                      type="button"
                    >
                      {pending === `archive:${goal.id}`
                        ? "正在归档…"
                        : "归档"}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>}
          {nextCursor ? (
            <button
              className="secondary-button"
              disabled={loadingMore}
              onClick={() => void loadMoreGoals()}
              type="button"
            >
              {loadingMore ? "正在加载…" : "加载更多目标"}
            </button>
          ) : null}
          {loadMoreFailed ? (
            <p className="error-message" role="alert">
              更多目标暂时无法读取；已加载内容不受影响，可重试。
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
