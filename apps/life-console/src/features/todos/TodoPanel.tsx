import { type FormEvent, useEffect, useState } from "react";

import type {
  TodoItem,
  TodoPriority,
  TodoRepositoryPort,
  TodoStatus,
  UpdateTodoInput,
} from "../../domain/todos";
import { isOverdue, sortTodos } from "./todo-projections";
import { TodoDeleteDialog } from "./TodoDeleteDialog";
import { TodoEditorSheet, toDateTimeInput } from "./TodoEditorSheet";
import { TodoGantt } from "./TodoGantt";

const statusLabels: Record<TodoStatus, string> = {
  not_started: "未开始",
  in_progress: "进行中",
  completed: "已完成",
};

const statusOptions: readonly TodoStatus[] = ["not_started", "in_progress", "completed"];
const defaultVisibleStatuses: readonly TodoStatus[] = ["not_started", "in_progress"];

function idempotencyKey(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `todo-ui-${Date.now()}-${random}`;
}

function dateTimeLabel(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

interface TodoPanelProps {
  now?: Date;
  repository?: TodoRepositoryPort;
}

export function TodoPanel({ now, repository }: TodoPanelProps) {
  const [currentNow] = useState(() => now ?? new Date());
  const [scope, setScope] = useState<"today" | "all">("today");
  const [items, setItems] = useState<TodoItem[]>([]);
  const [visibleStatuses, setVisibleStatuses] = useState<ReadonlySet<TodoStatus>>(
    () => new Set(defaultVisibleStatuses),
  );
  const [loading, setLoading] = useState(Boolean(repository));
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TodoPriority>("P1");
  const [plannedStart, setPlannedStart] = useState(() => toDateTimeInput(currentNow));
  const [due, setDue] = useState("");
  const [editing, setEditing] = useState<TodoItem | null>(null);
  const [deleting, setDeleting] = useState<TodoItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const visibleItems = items.filter((item) => visibleStatuses.has(item.status));

  function toggleVisibleStatus(status: TodoStatus) {
    setVisibleStatuses((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  useEffect(() => {
    let active = true;
    if (!repository) {
      setLoading(false);
      setItems([]);
      return () => { active = false; };
    }
    setLoading(true);
    setError(null);
    const request = scope === "today"
      ? repository.listToday(currentNow)
      : repository.listAll();
    void request.then((next) => {
      if (active) setItems(sortTodos(next));
    }).catch(() => {
      if (active) setError("Todo 暂时无法读取，请稍后重试。");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [currentNow, repository, scope]);

  async function createTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setReceipt(null);
    if (!repository) {
      setError("当前预览未连接 Todo 数据源。");
      return;
    }
    if (!title.trim()) {
      setError("Todo 项目不能为空。");
      return;
    }
    if (!due || Date.parse(due) <= Date.parse(plannedStart)) {
      setError("DDL 必须晚于计划开始时间。");
      return;
    }
    setBusy(true);
    try {
      const created = await repository.create({
        idempotencyKey: idempotencyKey(),
        title: title.trim(),
        priority,
        plannedStartAt: new Date(plannedStart).toISOString(),
        dueAt: new Date(due).toISOString(),
      });
      setItems((current) => sortTodos([...current.filter((item) => item.id !== created.id), created]));
      setTitle("");
      setDue("");
      setReceipt("Todo 已创建。");
    } catch {
      setError("Todo 创建失败；未覆盖已有内容。");
    } finally {
      setBusy(false);
    }
  }

  async function transition(item: TodoItem, status: TodoStatus) {
    if (!repository || status === item.status || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await repository.transition({
        expectedRevision: item.revision,
        id: item.id,
        status,
      });
      setItems((current) => sortTodos(current.map((candidate) => candidate.id === item.id ? updated : candidate)));
      setReceipt(`“${item.title}”已更新为${statusLabels[status]}。`);
    } catch {
      setError("状态保存失败，可能已有更新；请重新读取后再试。");
    } finally {
      setBusy(false);
    }
  }

  async function updateTodo(input: UpdateTodoInput) {
    if (!repository || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await repository.update(input);
      setItems((current) => sortTodos(current.map((candidate) => candidate.id === updated.id ? updated : candidate)));
      setEditing(null);
      setReceipt("Todo 已保存。");
    } catch {
      setError("Todo 保存失败，可能已有更新；请重新读取后再试。");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTodo() {
    if (!repository || !deleting || busy) return;
    const target = deleting;
    setBusy(true);
    setError(null);
    try {
      await repository.delete({
        expectedRevision: target.revision,
        id: target.id,
      });
      setItems((current) => current.filter((candidate) => candidate.id !== target.id));
      setDeleting(null);
      setReceipt(`“${target.title}”已删除。`);
    } catch {
      setError("Todo 删除失败，可能已有更新；请重新读取后再试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Todo" className="card pad todo-panel" role="region">
      <div className="section-head todo-panel__head">
        <div>
          <p className="kicker">TODAY & ALL</p>
          <h2>Todo</h2>
        </div>
        <div aria-label="Todo 范围" className="todo-scope" role="group">
          <button aria-pressed={scope === "today"} onClick={() => setScope("today")} type="button">今日</button>
          <button aria-pressed={scope === "all"} onClick={() => setScope("all")} type="button">全部</button>
        </div>
      </div>

      <div aria-label="项目状态" className="todo-status-filter" role="group">
        <span className="todo-status-filter__label">项目状态</span>
        <div className="todo-status-filter__options">
          {statusOptions.map((status) => {
            const checked = visibleStatuses.has(status);
            return (
              <label className="todo-status-filter__option" data-checked={checked} key={status}>
                <input
                  checked={checked}
                  onChange={() => toggleVisibleStatus(status)}
                  type="checkbox"
                />
                <span>{statusLabels[status]}</span>
              </label>
            );
          })}
        </div>
      </div>

      <form className="todo-quick-form" onSubmit={(event) => void createTodo(event)}>
        <label className="todo-quick-form__title">
          <span>Todo 项目</span>
          <input aria-label="Todo 项目" maxLength={240} onChange={(event) => setTitle(event.target.value)} placeholder="写下一个明确动作" value={title} />
        </label>
        <label>
          <span>优先级</span>
          <select aria-label="Todo 优先级" onChange={(event) => setPriority(event.target.value as TodoPriority)} value={priority}>
            <option value="P0">P0</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
          </select>
        </label>
        <label>
          <span>计划开始</span>
          <input aria-label="Todo 计划开始" onChange={(event) => setPlannedStart(event.target.value)} type="datetime-local" value={plannedStart} />
        </label>
        <label>
          <span>DDL</span>
          <input aria-label="Todo DDL" onChange={(event) => setDue(event.target.value)} required type="datetime-local" value={due} />
        </label>
        <button className="primary-button" disabled={busy || !repository} type="submit">
          {busy ? "正在保存…" : "新建 Todo"}
        </button>
      </form>

      {error && <p className="form-error" role="alert">{error}</p>}
      {receipt && <p className="save-receipt" role="status">{receipt}</p>}

      <div className="todo-list" aria-live="polite">
        {loading ? <p className="empty-state">正在读取 Todo…</p> : items.length === 0 ? (
          <p className="empty-state">{repository ? "当前范围还没有 Todo。" : "当前预览未连接 Todo 数据源。"}</p>
        ) : visibleItems.length === 0 ? (
          <p className="empty-state">当前状态筛选下没有 Todo。</p>
        ) : visibleItems.map((item, index) => (
          <article aria-label={`Todo ${String(index + 1).padStart(2, "0")} ${item.title}`} className="todo-row-250" key={item.id}>
            <span className="todo-row-250__index">{String(index + 1).padStart(2, "0")}</span>
            <div className="todo-row-250__main">
              <strong>{item.title}</strong>
              <span>{dateTimeLabel(item.planned_start_at)} → {dateTimeLabel(item.due_at)}</span>
            </div>
            <span className={`todo-priority todo-priority--${item.priority.toLowerCase()}`}>{item.priority}</span>
            {isOverdue(item, currentNow) && <span className="todo-overdue">已逾期</span>}
            <select
              aria-label={`${item.title}状态`}
              disabled={busy}
              onChange={(event) => void transition(item, event.target.value as TodoStatus)}
              value={item.status}
            >
              <option value="not_started">未开始</option>
              <option value="in_progress">进行中</option>
              <option value="completed">已完成</option>
            </select>
            <button className="secondary-button" disabled={busy} onClick={() => setEditing(item)} type="button">编辑</button>
            <button
              aria-label={`删除${item.title}`}
              className="secondary-button danger"
              disabled={busy}
              onClick={() => setDeleting(item)}
              type="button"
            >
              删除
            </button>
          </article>
        ))}
      </div>

      <TodoGantt
        emptyMessage={items.length > 0 && visibleItems.length === 0
          ? "当前状态筛选下没有可展示的计划。"
          : undefined}
        now={currentNow}
        todos={visibleItems}
      />
      <TodoEditorSheet busy={busy} onClose={() => setEditing(null)} onSave={updateTodo} todo={editing} />
      <TodoDeleteDialog
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void deleteTodo()}
        todo={deleting}
      />
    </section>
  );
}
