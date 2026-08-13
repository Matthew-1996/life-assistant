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
  PhaseReview,
  ReviewRepositoryPort,
  WeeklyReview,
} from "../../supabase/reviews";
import {
  RepositoryError,
  type Cursor,
} from "../../supabase/repository";

export interface SupabaseReviewsPanelProps {
  repository: ReviewRepositoryPort;
  createIdempotencyKey?: (kind: "weekly" | "phase") => string;
  draftScope?: string;
}

interface Notice {
  kind: "success" | "error";
  message: string;
}

type ReviewKind = "weekly" | "phase";

interface ReviewConflict {
  draftContent: string;
  id: number;
  kind: ReviewKind;
  latestContent: string | null;
  latestLoaded: boolean;
}

interface ReviewsDraft {
  conflict: ReviewConflict | null;
  phaseCreate: {
    content: string;
    end: string;
    fingerprint: string | null;
    key: string | null;
    start: string;
  };
  phaseEdit: {
    content: string;
    id: number | null;
  };
  weeklyCreate: {
    content: string;
    date: string;
    fingerprint: string | null;
    key: string | null;
  };
  weeklyEdit: {
    content: string;
    id: number | null;
  };
}

const EMPTY_REVIEWS_DRAFT: ReviewsDraft = {
  conflict: null,
  phaseCreate: {
    content: "",
    end: "",
    fingerprint: null,
    key: null,
    start: "",
  },
  phaseEdit: { content: "", id: null },
  weeklyCreate: {
    content: "",
    date: "",
    fingerprint: null,
    key: null,
  },
  weeklyEdit: { content: "", id: null },
};

function reviewsDraftIsEmpty(draft: ReviewsDraft): boolean {
  return draft.conflict == null
    && draft.phaseCreate.content === ""
    && draft.phaseCreate.end === ""
    && draft.phaseCreate.fingerprint === null
    && draft.phaseCreate.key === null
    && draft.phaseCreate.start === ""
    && draft.phaseEdit.content === ""
    && draft.phaseEdit.id === null
    && draft.weeklyCreate.content === ""
    && draft.weeklyCreate.date === ""
    && draft.weeklyCreate.fingerprint === null
    && draft.weeklyCreate.key === null
    && draft.weeklyEdit.content === ""
    && draft.weeklyEdit.id === null;
}

function weeklyCreateFingerprint(
  draft: ReviewsDraft["weeklyCreate"],
): string {
  return JSON.stringify({ content: draft.content, weekStart: draft.date });
}

function phaseCreateFingerprint(
  draft: ReviewsDraft["phaseCreate"],
): string {
  return JSON.stringify({
    content: draft.content,
    periodEnd: draft.end,
    periodStart: draft.start,
  });
}

function defaultKey(kind: "weekly" | "phase"): string {
  return `${kind}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function failure(error: unknown): Notice {
  return error instanceof RepositoryError && error.kind === "conflict"
    ? {
      kind: "error",
      message: "记录已在其他页面更新；输入仍保留，请重新载入后比较。",
    }
    : {
      kind: "error",
      message: "尚未保存；输入仍保留，可稍后重试。",
    };
}

function isRevisionConflict(error: unknown): boolean {
  return error instanceof RepositoryError && error.kind === "conflict";
}

function appendUnique<T extends { id: number }>(
  current: T[],
  incoming: T[],
): T[] {
  const existing = new Set(current.map((row) => row.id));
  return [
    ...current,
    ...incoming.filter((row) => !existing.has(row.id)),
  ];
}

function matchesFilter(values: string[], filter: string): boolean {
  const query = filter.trim().toLowerCase();
  return query === ""
    || values.some((value) => value.toLowerCase().includes(query));
}

function cursorMarker(cursor: Cursor): string {
  return `${cursor.sortValue}:${cursor.id}`;
}

export function SupabaseReviewsPanel({
  repository,
  createIdempotencyKey = defaultKey,
  draftScope = "anonymous",
}: SupabaseReviewsPanelProps): ReactElement {
  const [weeklyRows, setWeeklyRows] = useState<WeeklyReview[]>([]);
  const [phaseRows, setPhaseRows] = useState<PhaseReview[]>([]);
  const [weeklyCursor, setWeeklyCursor] = useState<Cursor | null>(null);
  const [phaseCursor, setPhaseCursor] = useState<Cursor | null>(null);
  const [weeklyFilter, setWeeklyFilter] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const {
    persist: persistDraft,
    setValue: setDraft,
    value: draft,
  } = useSessionDraft(
    `${SESSION_DRAFT_STORAGE_PREFIX}${draftScope}:reviews`,
    EMPTY_REVIEWS_DRAFT,
    reviewsDraftIsEmpty,
  );
  const [pending, setPending] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState<ReviewKind | null>(null);
  const listGeneration = useRef(0);
  const seenWeeklyCursors = useRef(new Set<string>());
  const seenPhaseCursors = useRef(new Set<string>());
  const [loadingConflict, setLoadingConflict] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const conflict = draft.conflict ?? null;

  function setConflict(
    action: SetStateAction<ReviewConflict | null>,
  ): void {
    setDraft((current) => ({
      ...current,
      conflict: typeof action === "function"
        ? action(current.conflict ?? null)
        : action,
    }));
  }

  useEffect(() => {
    const generation = ++listGeneration.current;
    let active = true;
    seenWeeklyCursors.current.clear();
    seenPhaseCursors.current.clear();
    setLoading(true);
    setLoadingMore(null);
    setLoadFailed(false);
    void Promise.all([repository.listWeekly(), repository.listPhases()])
      .then(([weekly, phases]) => {
        if (!active || generation !== listGeneration.current) return;
        setWeeklyRows(weekly.items);
        setPhaseRows(phases.items);
        setWeeklyCursor(weekly.nextCursor);
        setPhaseCursor(phases.nextCursor);
        if (weekly.nextCursor) {
          seenWeeklyCursors.current.add(cursorMarker(weekly.nextCursor));
        }
        if (phases.nextCursor) {
          seenPhaseCursors.current.add(cursorMarker(phases.nextCursor));
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

  async function createWeekly(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (conflict) return;
    setPending("weekly-create");
    setNotice(null);
    const fingerprint = weeklyCreateFingerprint(draft.weeklyCreate);
    const key = draft.weeklyCreate.key
        && draft.weeklyCreate.fingerprint === fingerprint
      ? draft.weeklyCreate.key
      : createIdempotencyKey("weekly");
    try {
      await persistDraft((current) => ({
        ...current,
        weeklyCreate: {
          ...current.weeklyCreate,
          fingerprint,
          key,
        },
      }));
      const created = await repository.createWeekly(key, {
        weekStart: draft.weeklyCreate.date,
        content: draft.weeklyCreate.content,
      });
      setWeeklyRows((rows) => [
        created,
        ...rows.filter((review) => review.id !== created.id),
      ]);
      await persistDraft((current) => ({
        ...current,
        weeklyCreate: EMPTY_REVIEWS_DRAFT.weeklyCreate,
      }));
      setConflict(null);
      setNotice({ kind: "success", message: "周复盘已保存。" });
    } catch (error) {
      setNotice(failure(error));
    } finally {
      setPending(null);
    }
  }

  async function createPhase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (conflict) return;
    setPending("phase-create");
    setNotice(null);
    const fingerprint = phaseCreateFingerprint(draft.phaseCreate);
    const key = draft.phaseCreate.key
        && draft.phaseCreate.fingerprint === fingerprint
      ? draft.phaseCreate.key
      : createIdempotencyKey("phase");
    try {
      await persistDraft((current) => ({
        ...current,
        phaseCreate: {
          ...current.phaseCreate,
          fingerprint,
          key,
        },
      }));
      const created = await repository.createPhase(key, {
        periodStart: draft.phaseCreate.start,
        periodEnd: draft.phaseCreate.end,
        content: draft.phaseCreate.content,
      });
      setPhaseRows((rows) => [
        created,
        ...rows.filter((review) => review.id !== created.id),
      ]);
      await persistDraft((current) => ({
        ...current,
        phaseCreate: EMPTY_REVIEWS_DRAFT.phaseCreate,
      }));
      setConflict(null);
      setNotice({ kind: "success", message: "阶段复盘已保存。" });
    } catch (error) {
      setNotice(failure(error));
    } finally {
      setPending(null);
    }
  }

  async function saveWeekly(
    event: FormEvent<HTMLFormElement>,
    review: WeeklyReview,
  ) {
    event.preventDefault();
    setPending(`weekly-${review.id}`);
    setNotice(null);
    try {
      const updated = await repository.updateWeekly(
        review.id,
        review.revision,
        { content: draft.weeklyEdit.content },
      );
      setWeeklyRows((rows) =>
        rows.map((row) => row.id === updated.id ? updated : row));
      await persistDraft((current) => ({
        ...current,
        conflict: null,
        weeklyEdit: EMPTY_REVIEWS_DRAFT.weeklyEdit,
      }));
      setConflict(null);
      setNotice({ kind: "success", message: "周复盘修改已保存。" });
    } catch (error) {
      if (isRevisionConflict(error)) {
        await persistDraft((current) => ({
          ...current,
          conflict: {
            draftContent: draft.weeklyEdit.content,
            id: review.id,
            kind: "weekly",
            latestContent: null,
            latestLoaded: false,
          },
        }));
      }
      setNotice(failure(error));
    } finally {
      setPending(null);
    }
  }

  async function savePhase(
    event: FormEvent<HTMLFormElement>,
    review: PhaseReview,
  ) {
    event.preventDefault();
    setPending(`phase-${review.id}`);
    setNotice(null);
    try {
      const updated = await repository.updatePhase(
        review.id,
        review.revision,
        { content: draft.phaseEdit.content },
      );
      setPhaseRows((rows) =>
        rows.map((row) => row.id === updated.id ? updated : row));
      await persistDraft((current) => ({
        ...current,
        conflict: null,
        phaseEdit: EMPTY_REVIEWS_DRAFT.phaseEdit,
      }));
      setConflict(null);
      setNotice({ kind: "success", message: "阶段复盘修改已保存。" });
    } catch (error) {
      if (isRevisionConflict(error)) {
        await persistDraft((current) => ({
          ...current,
          conflict: {
            draftContent: draft.phaseEdit.content,
            id: review.id,
            kind: "phase",
            latestContent: null,
            latestLoaded: false,
          },
        }));
      }
      setNotice(failure(error));
    } finally {
      setPending(null);
    }
  }

  async function loadMoreWeekly(): Promise<void> {
    if (!weeklyCursor) return;
    const generation = listGeneration.current;
    setLoadingMore("weekly");
    setNotice(null);
    try {
      const page = await repository.listWeekly({ cursor: weeklyCursor });
      if (generation !== listGeneration.current) return;
      setWeeklyRows((rows) => appendUnique(rows, page.items));
      if (
        page.nextCursor
        && seenWeeklyCursors.current.has(cursorMarker(page.nextCursor))
      ) {
        setWeeklyCursor(null);
        setNotice({
          kind: "error",
          message: "周复盘分页结果异常；已停止继续加载。",
        });
      } else {
        if (page.nextCursor) {
          seenWeeklyCursors.current.add(cursorMarker(page.nextCursor));
        }
        setWeeklyCursor(page.nextCursor);
      }
    } catch {
      if (generation === listGeneration.current) {
        setNotice({
          kind: "error",
          message: "更多周复盘暂时无法读取；已加载内容仍保留。",
        });
      }
    } finally {
      if (generation === listGeneration.current) setLoadingMore(null);
    }
  }

  async function loadMorePhases(): Promise<void> {
    if (!phaseCursor) return;
    const generation = listGeneration.current;
    setLoadingMore("phase");
    setNotice(null);
    try {
      const page = await repository.listPhases({ cursor: phaseCursor });
      if (generation !== listGeneration.current) return;
      setPhaseRows((rows) => appendUnique(rows, page.items));
      if (
        page.nextCursor
        && seenPhaseCursors.current.has(cursorMarker(page.nextCursor))
      ) {
        setPhaseCursor(null);
        setNotice({
          kind: "error",
          message: "阶段复盘分页结果异常；已停止继续加载。",
        });
      } else {
        if (page.nextCursor) {
          seenPhaseCursors.current.add(cursorMarker(page.nextCursor));
        }
        setPhaseCursor(page.nextCursor);
      }
    } catch {
      if (generation === listGeneration.current) {
        setNotice({
          kind: "error",
          message: "更多阶段复盘暂时无法读取；已加载内容仍保留。",
        });
      }
    } finally {
      if (generation === listGeneration.current) setLoadingMore(null);
    }
  }

  async function findLatestWeekly(id: number): Promise<WeeklyReview | null> {
    const visibleCount = Math.max(weeklyRows.length, 1);
    let cursor: Cursor | undefined;
    let scanned = 0;
    do {
      const page = await repository.listWeekly(cursor ? { cursor } : undefined);
      const found = page.items.find((row) => row.id === id);
      if (found) return found;
      scanned += page.items.length;
      cursor = page.nextCursor ?? undefined;
      if (page.items.length === 0) break;
    } while (cursor && scanned < visibleCount);
    return null;
  }

  async function findLatestPhase(id: number): Promise<PhaseReview | null> {
    const visibleCount = Math.max(phaseRows.length, 1);
    let cursor: Cursor | undefined;
    let scanned = 0;
    do {
      const page = await repository.listPhases(cursor ? { cursor } : undefined);
      const found = page.items.find((row) => row.id === id);
      if (found) return found;
      scanned += page.items.length;
      cursor = page.nextCursor ?? undefined;
      if (page.items.length === 0) break;
    } while (cursor && scanned < visibleCount);
    return null;
  }

  async function loadLatestConflict(): Promise<void> {
    if (!conflict) return;
    const retainedDraft = conflict.kind === "weekly"
      ? draft.weeklyEdit.content
      : draft.phaseEdit.content;
    setLoadingConflict(true);
    setNotice(null);
    try {
      let latestContent: string;
      if (conflict.kind === "weekly") {
        const latest = await findLatestWeekly(conflict.id);
        if (!latest) throw new Error("Weekly review is no longer available");
        setWeeklyRows((rows) => rows.map((row) =>
          row.id === latest.id ? latest : row));
        latestContent = latest.content;
      } else {
        const latest = await findLatestPhase(conflict.id);
        if (!latest) throw new Error("Phase review is no longer available");
        setPhaseRows((rows) => rows.map((row) =>
          row.id === latest.id ? latest : row));
        latestContent = latest.content;
      }
      await persistDraft((current) => ({
        ...current,
        conflict: current.conflict
          ? {
            ...current.conflict,
            draftContent: retainedDraft,
            latestContent,
            latestLoaded: true,
          }
          : null,
      }));
      setNotice({
        kind: "success",
        message: "已载入最新复盘；冲突前草稿仍保留在下方，可恢复后再保存。",
      });
    } catch {
      setNotice({
        kind: "error",
        message: "最新复盘暂时无法读取；冲突前草稿仍保留。",
      });
    } finally {
      setLoadingConflict(false);
    }
  }

  async function restoreConflictDraft(): Promise<void> {
    if (!conflict || !conflict.latestLoaded) return;
    await persistDraft((current) => ({ ...current, conflict: null }));
    setNotice({
      kind: "success",
      message: "已恢复冲突前草稿；下次保存将使用已载入的最新版本。",
    });
  }

  async function keepLatestConflictVersion(): Promise<void> {
    if (!conflict?.latestLoaded || conflict.latestContent === null) return;
    if (conflict.kind === "weekly") {
      await persistDraft((current) => ({
        ...current,
        conflict: null,
        weeklyEdit: { content: conflict.latestContent as string, id: conflict.id },
      }));
    } else {
      await persistDraft((current) => ({
        ...current,
        conflict: null,
        phaseEdit: { content: conflict.latestContent as string, id: conflict.id },
      }));
    }
    setNotice({ kind: "success", message: "已保留服务器最新内容。" });
  }

  const visibleWeeklyRows = weeklyRows.filter((review) => matchesFilter(
    [review.week_start, review.content],
    weeklyFilter,
  ));
  const visiblePhaseRows = phaseRows.filter((review) => matchesFilter(
    [review.period_start, review.period_end, review.content],
    phaseFilter,
  ));

  return (
    <section className="supabase-reviews-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">REVIEWS</p>
          <h2>复盘</h2>
          <p className="quiet">周复盘与阶段复盘保持独立。</p>
        </div>
        <span className="status blue">Owner-only</span>
      </div>

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
        <section
          aria-labelledby="review-conflict-title"
          className="conflict-card"
        >
          <h3 id="review-conflict-title">复盘已在其他页面更新</h3>
          <p>冲突前草稿已保留；先载入最新版本，再决定是否恢复草稿。</p>
          {conflict.latestContent !== null ? (
            <label>
              服务器最新内容
              <textarea readOnly value={conflict.latestContent} />
            </label>
          ) : null}
          <label>
            冲突前草稿
            <textarea readOnly value={conflict.draftContent} />
          </label>
          <div className="button-row">
            <button
              className="secondary-button"
              disabled={loadingConflict || pending !== null}
              onClick={() => void loadLatestConflict()}
              type="button"
            >
              {loadingConflict ? "正在载入…" : "载入最新"}
            </button>
            {conflict.latestLoaded ? (
              <>
                <button
                  className="secondary-button"
                  disabled={loadingConflict || pending !== null}
                  onClick={() => void restoreConflictDraft()}
                  type="button"
                >
                  恢复冲突前草稿
                </button>
                <button
                  className="secondary-button"
                  disabled={loadingConflict || pending !== null}
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

      {loading ? <p role="status">正在读取复盘…</p> : loadFailed ? (
        <div className="empty-state" role="alert">
          <p>复盘暂时无法读取；没有把失败误报为空记录。</p>
          <button
            disabled={pending !== null}
            onClick={() => setLoadAttempt((value) => value + 1)}
            type="button"
          >
            重新加载复盘
          </button>
        </div>
      ) : (
        <div className="supabase-review-columns">
          <section>
            <h3>周复盘</h3>
            <label htmlFor="weekly-review-filter">
              筛选已加载周复盘
              <input
                id="weekly-review-filter"
                onChange={(event) => setWeeklyFilter(event.target.value)}
                placeholder="搜索周起始日或内容"
                type="search"
                value={weeklyFilter}
              />
            </label>
            <form onSubmit={createWeekly}>
              <label>周起始日
                <input
                  disabled={conflict !== null || pending === "weekly-create"}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    weeklyCreate: {
                      ...current.weeklyCreate,
                      date: event.target.value,
                      fingerprint: null,
                      key: null,
                    },
                  }))}
                  required type="date" value={draft.weeklyCreate.date}
                />
              </label>
              <label>周复盘内容
                <textarea
                  disabled={conflict !== null || pending === "weekly-create"}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    weeklyCreate: {
                      ...current.weeklyCreate,
                      content: event.target.value,
                      fingerprint: null,
                      key: null,
                    },
                  }))}
                  required value={draft.weeklyCreate.content}
                />
              </label>
              <button
                disabled={conflict !== null || loading || pending !== null}
                type="submit"
              >
                {pending === "weekly-create"
                  ? "正在保存周复盘…"
                  : "新建周复盘"}
              </button>
            </form>
            {weeklyRows.length === 0 ? <p>还没有周复盘</p>
              : visibleWeeklyRows.length === 0 ? (
                <p>已加载的周复盘中没有匹配项。</p>
              ) : (
              <ul>
                {visibleWeeklyRows.map((review) => (
                  <li key={review.id}>
                    {draft.weeklyEdit.id === review.id ? (
                      <form onSubmit={(event) => saveWeekly(event, review)}>
                        <label>编辑周复盘内容
                          <textarea
                            disabled={pending === `weekly-${review.id}`
                              || (loadingConflict
                                && conflict?.kind === "weekly"
                                && conflict.id === review.id)}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                weeklyEdit: {
                                  content: event.target.value,
                                  id: review.id,
                                },
                              }))}
                            value={draft.weeklyEdit.content}
                          />
                        </label>
                        <button disabled={pending !== null} type="submit">
                          {pending === `weekly-${review.id}`
                            ? "正在保存周复盘…"
                            : "保存周复盘"}
                        </button>
                      </form>
                    ) : (
                      <>
                        <time dateTime={review.week_start}>
                          周起始日：{review.week_start}
                        </time>
                        <p>{review.content}</p>
                        <button
                          disabled={conflict !== null
                            || loadingConflict
                            || pending !== null}
                          onClick={() => {
                            setConflict(null);
                            setNotice(null);
                            setDraft((current) => ({
                              ...current,
                              weeklyEdit: {
                                content: review.content,
                                id: review.id,
                              },
                            }));
                          }}
                          type="button"
                        >
                          编辑周复盘
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {weeklyCursor ? (
              <button
                className="secondary-button"
                disabled={loadingMore !== null || pending !== null}
                onClick={() => void loadMoreWeekly()}
                type="button"
              >
                {loadingMore === "weekly" ? "正在加载…" : "加载更多周复盘"}
              </button>
            ) : null}
          </section>

          <section>
            <h3>阶段复盘</h3>
            <label htmlFor="phase-review-filter">
              筛选已加载阶段复盘
              <input
                id="phase-review-filter"
                onChange={(event) => setPhaseFilter(event.target.value)}
                placeholder="搜索阶段日期或内容"
                type="search"
                value={phaseFilter}
              />
            </label>
            <form onSubmit={createPhase}>
              <label>阶段开始日
                <input
                  disabled={conflict !== null || pending === "phase-create"}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    phaseCreate: {
                      ...current.phaseCreate,
                      start: event.target.value,
                      fingerprint: null,
                      key: null,
                    },
                  }))}
                  required type="date" value={draft.phaseCreate.start}
                />
              </label>
              <label>阶段结束日
                <input
                  disabled={conflict !== null || pending === "phase-create"}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    phaseCreate: {
                      ...current.phaseCreate,
                      end: event.target.value,
                      fingerprint: null,
                      key: null,
                    },
                  }))}
                  required type="date" value={draft.phaseCreate.end}
                />
              </label>
              <label>阶段复盘内容
                <textarea
                  disabled={conflict !== null || pending === "phase-create"}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    phaseCreate: {
                      ...current.phaseCreate,
                      content: event.target.value,
                      fingerprint: null,
                      key: null,
                    },
                  }))}
                  required value={draft.phaseCreate.content}
                />
              </label>
              <button
                disabled={conflict !== null || loading || pending !== null}
                type="submit"
              >
                {pending === "phase-create"
                  ? "正在保存阶段复盘…"
                  : "新建阶段复盘"}
              </button>
            </form>
            {phaseRows.length === 0 ? <p>还没有阶段复盘</p>
              : visiblePhaseRows.length === 0 ? (
                <p>已加载的阶段复盘中没有匹配项。</p>
              ) : (
              <ul>
                {visiblePhaseRows.map((review) => (
                  <li key={review.id}>
                    {draft.phaseEdit.id === review.id ? (
                      <form onSubmit={(event) => savePhase(event, review)}>
                        <label>编辑阶段复盘内容
                          <textarea
                            disabled={pending === `phase-${review.id}`
                              || (loadingConflict
                                && conflict?.kind === "phase"
                                && conflict.id === review.id)}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                phaseEdit: {
                                  content: event.target.value,
                                  id: review.id,
                                },
                              }))}
                            value={draft.phaseEdit.content}
                          />
                        </label>
                        <button disabled={pending !== null} type="submit">
                          {pending === `phase-${review.id}`
                            ? "正在保存阶段复盘…"
                            : "保存阶段复盘"}
                        </button>
                      </form>
                    ) : (
                      <>
                        <span>
                          阶段：{review.period_start} — {review.period_end}
                        </span>
                        <p>{review.content}</p>
                        <button
                          disabled={conflict !== null
                            || loadingConflict
                            || pending !== null}
                          onClick={() => {
                            setConflict(null);
                            setNotice(null);
                            setDraft((current) => ({
                              ...current,
                              phaseEdit: {
                                content: review.content,
                                id: review.id,
                              },
                            }));
                          }}
                          type="button"
                        >
                          编辑阶段复盘
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {phaseCursor ? (
              <button
                className="secondary-button"
                disabled={loadingMore !== null || pending !== null}
                onClick={() => void loadMorePhases()}
                type="button"
              >
                {loadingMore === "phase" ? "正在加载…" : "加载更多阶段复盘"}
              </button>
            ) : null}
          </section>
        </div>
      )}
    </section>
  );
}
