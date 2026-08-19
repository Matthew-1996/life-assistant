import type { Journal } from "../../supabase/journals";

interface DeleteJournalDialogProps {
  busy: boolean;
  error: string | null;
  journal: Journal | null;
  onCancel(): void;
  onConfirm(): void;
}

export function DeleteJournalDialog({ busy, error, journal, onCancel, onConfirm }: DeleteJournalDialogProps) {
  if (!journal) return null;
  return (
    <div className="todo-sheet-backdrop" role="presentation">
      <section aria-label="移到已删除" aria-modal="true" className="delete-journal-dialog" role="dialog">
        <p className="kicker">SOFT DELETE</p>
        <h3>移到已删除</h3>
        <p>“{journal.title || "无标题日记"}”将从普通列表移出，但不会永久删除；之后仍可恢复。</p>
        {error && <p className="error-message" role="alert">{error}</p>}
        <div className="button-row">
          <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">取消</button>
          <button className="primary-button danger" disabled={busy} onClick={onConfirm} type="button">
            {busy ? "正在移动…" : "确认移到已删除"}
          </button>
        </div>
      </section>
    </div>
  );
}
