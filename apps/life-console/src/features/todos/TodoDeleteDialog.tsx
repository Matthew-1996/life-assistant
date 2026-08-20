import type { TodoItem } from "../../domain/todos";

interface TodoDeleteDialogProps {
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
  todo: TodoItem | null;
}

export function TodoDeleteDialog({
  busy,
  onCancel,
  onConfirm,
  todo,
}: TodoDeleteDialogProps) {
  if (!todo) return null;
  return (
    <div className="todo-sheet-backdrop" role="presentation">
      <section aria-label="删除 Todo" aria-modal="true" className="todo-sheet" role="dialog">
        <p className="kicker">SOFT DELETE</p>
        <h3>删除 Todo</h3>
        <p>“{todo.title}”将从 Todo 列表和甘特图移除，但不会被永久清除。</p>
        <div className="button-row">
          <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">取消</button>
          <button className="primary-button danger" disabled={busy} onClick={onConfirm} type="button">
            {busy ? "正在删除…" : "确认删除"}
          </button>
        </div>
      </section>
    </div>
  );
}
