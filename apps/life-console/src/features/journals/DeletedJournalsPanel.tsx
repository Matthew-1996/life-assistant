import { useEffect, useState } from "react";

import type { Journal, JournalRepositoryPort } from "../../supabase/journals";
import { RepositoryError } from "../../supabase/repository";

interface DeletedJournalsPanelProps {
  onRestored(journal: Journal): void;
  reloadToken: number;
  repository: JournalRepositoryPort;
}

export function DeletedJournalsPanel({ onRestored, reloadToken, repository }: DeletedJournalsPanelProps) {
  const [items, setItems] = useState<Journal[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void repository.listDeleted({ pageSize: 100 }).then((page) => {
      if (active) setItems(page.items);
    }).catch(() => {
      if (active) setNotice("已删除日记暂时无法读取。");
    });
    return () => { active = false; };
  }, [reloadToken, repository]);

  async function restore(journal: Journal) {
    setPending(journal.id);
    setNotice(null);
    try {
      const restored = await repository.restore(journal.id, journal.revision);
      setItems((current) => current.filter((item) => item.id !== journal.id));
      onRestored(restored);
    } catch (error) {
      setNotice(error instanceof RepositoryError && error.kind === "conflict"
        ? "日记已在其他位置更新，请刷新后再恢复。"
        : "恢复失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-label="已删除日记" className="deleted-journals-panel">
      <button className="secondary-button" onClick={() => setExpanded((value) => !value)} type="button">
        {expanded ? "收起已删除" : `查看已删除 (${items.length})`}
      </button>
      {expanded && (items.length === 0 ? <p className="empty-state">没有已删除日记。</p> : (
        <ul>{items.map((journal) => (
          <li key={journal.id}>
            <div><strong>{journal.title || "无标题日记"}</strong><time>{journal.event_date}</time></div>
            <button className="secondary-button" disabled={pending !== null} onClick={() => void restore(journal)} type="button">
              {pending === journal.id ? "正在恢复…" : "恢复日记"}
            </button>
          </li>
        ))}</ul>
      ))}
      {notice && <p className="error-message" role="alert">{notice}</p>}
    </section>
  );
}
