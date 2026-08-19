import { type FormEvent, useEffect, useState } from "react";

import type { TodoItem, TodoPriority, UpdateTodoInput } from "../../domain/todos";

export function toDateTimeInput(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

interface TodoEditorSheetProps {
  busy: boolean;
  onClose(): void;
  onSave(input: UpdateTodoInput): Promise<void>;
  todo: TodoItem | null;
}

export function TodoEditorSheet({ busy, onClose, onSave, todo }: TodoEditorSheetProps) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TodoPriority>("P1");
  const [plannedStart, setPlannedStart] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!todo) return;
    setTitle(todo.title);
    setPriority(todo.priority);
    setPlannedStart(toDateTimeInput(todo.planned_start_at));
    setDue(toDateTimeInput(todo.due_at));
    setError(null);
  }, [todo]);

  if (!todo) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!todo) return;
    setError(null);
    if (!title.trim()) {
      setError("Todo 项目不能为空。");
      return;
    }
    if (!plannedStart || !due || Date.parse(due) <= Date.parse(plannedStart)) {
      setError("DDL 必须晚于计划开始时间。");
      return;
    }
    await onSave({
      id: todo.id,
      expectedRevision: todo.revision,
      title: title.trim(),
      priority,
      plannedStartAt: new Date(plannedStart).toISOString(),
      dueAt: new Date(due).toISOString(),
    });
  }

  return (
    <div className="todo-sheet-backdrop" role="presentation">
      <section aria-label={`编辑 ${todo.title}`} aria-modal="true" className="todo-sheet" role="dialog">
        <div className="section-head">
          <div>
            <p className="kicker">EDIT TODO</p>
            <h3>编辑 Todo</h3>
          </div>
          <button className="secondary-button" disabled={busy} onClick={onClose} type="button">关闭</button>
        </div>
        <form className="todo-editor-form" onSubmit={(event) => void submit(event)}>
          <label>
            Todo 项目
            <input aria-label="编辑 Todo 项目" maxLength={240} onChange={(event) => setTitle(event.target.value)} value={title} />
          </label>
          <label>
            优先级
            <select aria-label="编辑 Todo 优先级" onChange={(event) => setPriority(event.target.value as TodoPriority)} value={priority}>
              <option value="P0">P0</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
            </select>
          </label>
          <label>
            计划开始
            <input aria-label="编辑 Todo 计划开始" onChange={(event) => setPlannedStart(event.target.value)} type="datetime-local" value={plannedStart} />
          </label>
          <label>
            DDL
            <input aria-label="编辑 Todo DDL" onChange={(event) => setDue(event.target.value)} required type="datetime-local" value={due} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "正在保存…" : "保存 Todo"}
          </button>
        </form>
      </section>
    </div>
  );
}
