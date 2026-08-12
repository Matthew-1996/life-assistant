import {
  type FormEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  Goal,
  GoalRepositoryPort,
} from "../../supabase/goals";
import { RepositoryError } from "../../supabase/repository";

export interface SupabaseGoalsPanelProps {
  repository: GoalRepositoryPort;
  createIdempotencyKey?: () => string;
  now?: () => string;
}

interface Notice {
  kind: "success" | "error";
  message: string;
}

function defaultIdempotencyKey(): string {
  return `goal_${crypto.randomUUID().replaceAll("-", "")}`;
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
}: SupabaseGoalsPanelProps): ReactElement {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const createKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void repository.list()
      .then((page) => {
        if (active) setGoals(page.items);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, repository]);

  async function createGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("create");
    setNotice(null);
    createKey.current ??= createIdempotencyKey();
    try {
      const created = await repository.create(createKey.current, {
        title: createTitle,
        status: "active",
      });
      setGoals((current) => [created, ...current]);
      setCreateTitle("");
      createKey.current = null;
      setNotice({ kind: "success", message: "目标已保存。" });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setPending(null);
    }
  }

  function beginEdit(goal: Goal) {
    setEditingId(goal.id);
    setEditingTitle(goal.title);
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
        { title: editingTitle },
      );
      setGoals((current) =>
        current.map((item) => item.id === updated.id ? updated : item));
      setEditingId(null);
      setEditingTitle("");
      setNotice({ kind: "success", message: "目标修改已保存。" });
    } catch (error) {
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
      setNotice({ kind: "success", message: "目标已归档。" });
    } catch (error) {
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
            id="supabase-goal-title"
            maxLength={200}
            onChange={(event) => setCreateTitle(event.target.value)}
            required
            value={createTitle}
          />
          <button
            className="primary-button"
            disabled={pending !== null}
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
        <ul className="supabase-goal-list">
          {goals.map((goal) => (
            <li key={goal.id}>
              {editingId === goal.id ? (
                <form onSubmit={(event) => updateGoal(event, goal)}>
                  <label htmlFor={`goal-edit-${goal.id}`}>
                    编辑目标名称
                  </label>
                  <input
                    id={`goal-edit-${goal.id}`}
                    maxLength={200}
                    onChange={(event) =>
                      setEditingTitle(event.target.value)}
                    required
                    value={editingTitle}
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
                      onClick={() => setEditingId(null)}
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
                      {goal.status === "completed" ? "已完成" : "进行中"}
                    </span>
                  </div>
                  <div className="button-row">
                    <button
                      aria-label={`编辑 ${goal.title}`}
                      className="secondary-button"
                      disabled={pending !== null}
                      onClick={() => beginEdit(goal)}
                      type="button"
                    >
                      编辑
                    </button>
                    <button
                      aria-label={`归档 ${goal.title}`}
                      className="secondary-button danger"
                      disabled={pending !== null}
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
        </ul>
      )}
    </section>
  );
}
