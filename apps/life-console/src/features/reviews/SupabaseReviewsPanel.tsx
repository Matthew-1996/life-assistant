import {
  type FormEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  PhaseReview,
  ReviewRepositoryPort,
  WeeklyReview,
} from "../../supabase/reviews";
import { RepositoryError } from "../../supabase/repository";

export interface SupabaseReviewsPanelProps {
  repository: ReviewRepositoryPort;
  createIdempotencyKey?: (kind: "weekly" | "phase") => string;
}

interface Notice {
  kind: "success" | "error";
  message: string;
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

export function SupabaseReviewsPanel({
  repository,
  createIdempotencyKey = defaultKey,
}: SupabaseReviewsPanelProps): ReactElement {
  const [weeklyRows, setWeeklyRows] = useState<WeeklyReview[]>([]);
  const [phaseRows, setPhaseRows] = useState<PhaseReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [weeklyDate, setWeeklyDate] = useState("");
  const [weeklyContent, setWeeklyContent] = useState("");
  const [phaseStart, setPhaseStart] = useState("");
  const [phaseEnd, setPhaseEnd] = useState("");
  const [phaseContent, setPhaseContent] = useState("");
  const [editingWeekly, setEditingWeekly] = useState<number | null>(null);
  const [weeklyEdit, setWeeklyEdit] = useState("");
  const [editingPhase, setEditingPhase] = useState<number | null>(null);
  const [phaseEdit, setPhaseEdit] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const weeklyKey = useRef<string | null>(null);
  const phaseKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([repository.listWeekly(), repository.listPhases()])
      .then(([weekly, phases]) => {
        if (!active) return;
        setWeeklyRows(weekly.items);
        setPhaseRows(phases.items);
      })
      .catch(() => {
        if (active) {
          setNotice({ kind: "error", message: "复盘暂时无法读取。" });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [repository]);

  async function createWeekly(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("weekly-create");
    setNotice(null);
    weeklyKey.current ??= createIdempotencyKey("weekly");
    try {
      const created = await repository.createWeekly(weeklyKey.current, {
        weekStart: weeklyDate,
        content: weeklyContent,
      });
      setWeeklyRows((rows) => [created, ...rows]);
      setWeeklyDate("");
      setWeeklyContent("");
      weeklyKey.current = null;
      setNotice({ kind: "success", message: "周复盘已保存。" });
    } catch (error) {
      setNotice(failure(error));
    } finally {
      setPending(null);
    }
  }

  async function createPhase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("phase-create");
    setNotice(null);
    phaseKey.current ??= createIdempotencyKey("phase");
    try {
      const created = await repository.createPhase(phaseKey.current, {
        periodStart: phaseStart,
        periodEnd: phaseEnd,
        content: phaseContent,
      });
      setPhaseRows((rows) => [created, ...rows]);
      setPhaseStart("");
      setPhaseEnd("");
      setPhaseContent("");
      phaseKey.current = null;
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
        { content: weeklyEdit },
      );
      setWeeklyRows((rows) =>
        rows.map((row) => row.id === updated.id ? updated : row));
      setEditingWeekly(null);
      setNotice({ kind: "success", message: "周复盘修改已保存。" });
    } catch (error) {
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
        { content: phaseEdit },
      );
      setPhaseRows((rows) =>
        rows.map((row) => row.id === updated.id ? updated : row));
      setEditingPhase(null);
      setNotice({ kind: "success", message: "阶段复盘修改已保存。" });
    } catch (error) {
      setNotice(failure(error));
    } finally {
      setPending(null);
    }
  }

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

      {loading ? <p role="status">正在读取复盘…</p> : (
        <div className="supabase-review-columns">
          <section>
            <h3>周复盘</h3>
            <form onSubmit={createWeekly}>
              <label>周起始日
                <input
                  onChange={(event) => setWeeklyDate(event.target.value)}
                  required type="date" value={weeklyDate}
                />
              </label>
              <label>周复盘内容
                <textarea
                  onChange={(event) => setWeeklyContent(event.target.value)}
                  required value={weeklyContent}
                />
              </label>
              <button disabled={pending !== null} type="submit">
                新建周复盘
              </button>
            </form>
            {weeklyRows.length === 0 ? <p>还没有周复盘</p> : (
              <ul>
                {weeklyRows.map((review) => (
                  <li key={review.id}>
                    {editingWeekly === review.id ? (
                      <form onSubmit={(event) => saveWeekly(event, review)}>
                        <label>编辑周复盘内容
                          <textarea
                            onChange={(event) =>
                              setWeeklyEdit(event.target.value)}
                            value={weeklyEdit}
                          />
                        </label>
                        <button type="submit">保存周复盘</button>
                      </form>
                    ) : (
                      <>
                        <p>{review.content}</p>
                        <button
                          onClick={() => {
                            setEditingWeekly(review.id);
                            setWeeklyEdit(review.content);
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
          </section>

          <section>
            <h3>阶段复盘</h3>
            <form onSubmit={createPhase}>
              <label>阶段开始日
                <input
                  onChange={(event) => setPhaseStart(event.target.value)}
                  required type="date" value={phaseStart}
                />
              </label>
              <label>阶段结束日
                <input
                  onChange={(event) => setPhaseEnd(event.target.value)}
                  required type="date" value={phaseEnd}
                />
              </label>
              <label>阶段复盘内容
                <textarea
                  onChange={(event) => setPhaseContent(event.target.value)}
                  required value={phaseContent}
                />
              </label>
              <button disabled={pending !== null} type="submit">
                新建阶段复盘
              </button>
            </form>
            {phaseRows.length === 0 ? <p>还没有阶段复盘</p> : (
              <ul>
                {phaseRows.map((review) => (
                  <li key={review.id}>
                    {editingPhase === review.id ? (
                      <form onSubmit={(event) => savePhase(event, review)}>
                        <label>编辑阶段复盘内容
                          <textarea
                            onChange={(event) =>
                              setPhaseEdit(event.target.value)}
                            value={phaseEdit}
                          />
                        </label>
                        <button type="submit">保存阶段复盘</button>
                      </form>
                    ) : (
                      <>
                        <p>{review.content}</p>
                        <button
                          onClick={() => {
                            setEditingPhase(review.id);
                            setPhaseEdit(review.content);
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
          </section>
        </div>
      )}
    </section>
  );
}
