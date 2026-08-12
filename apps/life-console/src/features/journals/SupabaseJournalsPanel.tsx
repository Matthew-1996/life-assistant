import {
  type FormEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  Journal,
  JournalRepositoryPort,
  JournalRevision,
} from "../../supabase/journals";
import { RepositoryError } from "../../supabase/repository";

export interface SupabaseJournalsPanelProps {
  repository: JournalRepositoryPort;
  createIdempotencyKey?: () => string;
}

interface JournalDraft {
  date: string;
  title: string;
  content: string;
  tags: string;
}

interface Notice {
  kind: "success" | "error";
  message: string;
}

function emptyDraft(): JournalDraft {
  return {
    date: "",
    title: "",
    content: "",
    tags: "",
  };
}

function draftFromJournal(journal: Journal): JournalDraft {
  return {
    date: journal.event_date,
    title: journal.title ?? "",
    content: journal.content,
    tags: journal.tags.join(", "),
  };
}

function parsedTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function defaultIdempotencyKey(): string {
  return `journal_${crypto.randomUUID().replaceAll("-", "")}`;
}

function failureNotice(error: unknown): Notice {
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

export function SupabaseJournalsPanel({
  repository,
  createIdempotencyKey = defaultIdempotencyKey,
}: SupabaseJournalsPanelProps): ReactElement {
  const [journals, setJournals] = useState<Journal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [createDraft, setCreateDraft] = useState<JournalDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<JournalDraft>(emptyDraft);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<JournalRevision[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const createKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void repository.list()
      .then((page) => {
        if (active) setJournals(page.items);
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

  async function createJournal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("create");
    setNotice(null);
    createKey.current ??= createIdempotencyKey();
    try {
      const created = await repository.create(createKey.current, {
        date: createDraft.date,
        title: createDraft.title,
        content: createDraft.content,
        tags: parsedTags(createDraft.tags),
      });
      setJournals((current) => [created, ...current]);
      setCreateDraft(emptyDraft());
      createKey.current = null;
      setNotice({ kind: "success", message: "日记已保存。" });
    } catch (error) {
      setNotice(failureNotice(error));
    } finally {
      setPending(null);
    }
  }

  function beginEdit(journal: Journal) {
    setEditingId(journal.id);
    setEditDraft(draftFromJournal(journal));
    setNotice(null);
  }

  async function updateJournal(
    event: FormEvent<HTMLFormElement>,
    journal: Journal,
  ) {
    event.preventDefault();
    setPending(`update:${journal.id}`);
    setNotice(null);
    try {
      const updated = await repository.update(
        journal.id,
        journal.revision,
        {
          date: editDraft.date,
          title: editDraft.title,
          content: editDraft.content,
          tags: parsedTags(editDraft.tags),
        },
      );
      setJournals((current) =>
        current.map((item) =>
          item.id === updated.id ? updated : item));
      setEditingId(null);
      setEditDraft(emptyDraft());
      if (historyId === updated.id) {
        setHistoryId(null);
        setRevisions([]);
      }
      setNotice({ kind: "success", message: "日记修改已保存。" });
    } catch (error) {
      setNotice(failureNotice(error));
    } finally {
      setPending(null);
    }
  }

  async function showRevisions(journal: Journal) {
    setHistoryId(journal.id);
    setHistoryLoading(true);
    setRevisions([]);
    setNotice(null);
    try {
      setRevisions(await repository.revisions(journal.id));
    } catch {
      setNotice({
        kind: "error",
        message: "修订历史暂时无法读取，请稍后重试。",
      });
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <section
      aria-labelledby="supabase-journals-title"
      className="supabase-journals-panel"
    >
      <div className="section-head">
        <div>
          <p className="eyebrow">JOURNALS</p>
          <h2 id="supabase-journals-title">日记</h2>
          <p className="quiet">
            当前只开放创建、读取和修订；撤回留待后续评审。
          </p>
        </div>
        <span className="status blue">Owner-only</span>
      </div>

      <form
        className="supabase-journal-create"
        onSubmit={createJournal}
      >
        <label>
          新日记日期
          <input
            onChange={(event) => setCreateDraft((current) => ({
              ...current,
              date: event.target.value,
            }))}
            required
            type="date"
            value={createDraft.date}
          />
        </label>
        <label>
          新日记标题
          <input
            maxLength={200}
            onChange={(event) => setCreateDraft((current) => ({
              ...current,
              title: event.target.value,
            }))}
            value={createDraft.title}
          />
        </label>
        <label>
          新日记正文
          <textarea
            maxLength={100000}
            onChange={(event) => setCreateDraft((current) => ({
              ...current,
              content: event.target.value,
            }))}
            required
            value={createDraft.content}
          />
        </label>
        <label>
          新日记标签
          <input
            onChange={(event) => setCreateDraft((current) => ({
              ...current,
              tags: event.target.value,
            }))}
            placeholder="用英文逗号分隔"
            value={createDraft.tags}
          />
        </label>
        <button
          className="primary-button"
          disabled={pending !== null}
          type="submit"
        >
          {pending === "create" ? "正在保存…" : "新建日记"}
        </button>
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
        <p className="quiet" role="status">正在读取日记…</p>
      ) : loadFailed ? (
        <div className="empty-state">
          <p>日记暂时无法读取。</p>
          <button
            className="secondary-button"
            onClick={() => setLoadAttempt((value) => value + 1)}
            type="button"
          >
            重新加载
          </button>
        </div>
      ) : journals.length === 0 ? (
        <div className="empty-state">
          <strong>还没有日记</strong>
          <p>新建后会显示在这里，不使用示例内容填充。</p>
        </div>
      ) : (
        <ul className="supabase-journal-list">
          {journals.map((journal) => {
            const displayTitle = journal.title || "无标题日记";
            return (
              <li key={journal.id}>
                {editingId === journal.id ? (
                  <form
                    className="supabase-journal-edit"
                    onSubmit={(event) => updateJournal(event, journal)}
                  >
                    <label>
                      编辑日记日期
                      <input
                        onChange={(event) => setEditDraft((current) => ({
                          ...current,
                          date: event.target.value,
                        }))}
                        required
                        type="date"
                        value={editDraft.date}
                      />
                    </label>
                    <label>
                      编辑日记标题
                      <input
                        maxLength={200}
                        onChange={(event) => setEditDraft((current) => ({
                          ...current,
                          title: event.target.value,
                        }))}
                        value={editDraft.title}
                      />
                    </label>
                    <label>
                      编辑日记正文
                      <textarea
                        maxLength={100000}
                        onChange={(event) => setEditDraft((current) => ({
                          ...current,
                          content: event.target.value,
                        }))}
                        required
                        value={editDraft.content}
                      />
                    </label>
                    <label>
                      编辑日记标签
                      <input
                        onChange={(event) => setEditDraft((current) => ({
                          ...current,
                          tags: event.target.value,
                        }))}
                        value={editDraft.tags}
                      />
                    </label>
                    <div className="button-row">
                      <button
                        className="primary-button"
                        disabled={pending !== null}
                        type="submit"
                      >
                        {pending === `update:${journal.id}`
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
                    <div className="supabase-journal-summary">
                      <div>
                        <strong>{displayTitle}</strong>
                        <span>{journal.event_date}</span>
                      </div>
                      <span className="status gray">
                        revision #{journal.revision}
                      </span>
                    </div>
                    <div className="button-row">
                      <button
                        aria-label={`编辑 ${displayTitle}`}
                        className="secondary-button"
                        disabled={pending !== null}
                        onClick={() => beginEdit(journal)}
                        type="button"
                      >
                        编辑
                      </button>
                      <button
                        aria-label={`查看 ${displayTitle} 修订`}
                        className="secondary-button"
                        disabled={historyLoading}
                        onClick={() => void showRevisions(journal)}
                        type="button"
                      >
                        修订历史
                      </button>
                    </div>
                    {historyId === journal.id ? (
                      <div className="supabase-journal-revisions">
                        {historyLoading ? (
                          <p className="quiet">正在读取修订历史…</p>
                        ) : revisions.length === 0 ? (
                          <p className="quiet">没有修订历史。</p>
                        ) : (
                          <ul>
                            {revisions.map((revision) => (
                              <li key={revision.id}>
                                revision #{revision.revision} ·{" "}
                                {revision.reason ?? "update"}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
