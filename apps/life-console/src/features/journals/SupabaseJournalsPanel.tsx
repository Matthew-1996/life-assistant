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
  Journal,
  JournalRepositoryPort,
  JournalRevision,
} from "../../supabase/journals";
import {
  RepositoryError,
  type Cursor,
} from "../../supabase/repository";
import { DeleteJournalDialog } from "./DeleteJournalDialog";
import { DeletedJournalsPanel } from "./DeletedJournalsPanel";
import { JournalCard } from "./JournalCard";

export interface SupabaseJournalsPanelProps {
  repository: JournalRepositoryPort;
  createIdempotencyKey?: () => string;
  showCreate?: boolean;
  onSaved?: () => boolean | void | Promise<boolean | void>;
  draftScope?: string;
  reloadToken?: string | number;
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

interface JournalConflict {
  draft: JournalDraft;
  id: number;
  latest: JournalDraft | null;
  latestLoaded: boolean;
}

interface JournalsDraft {
  conflict: JournalConflict | null;
  create: JournalDraft;
  createFingerprint: string | null;
  createKey: string | null;
  edit: JournalDraft;
  editingId: number | null;
}

function emptyDraft(): JournalDraft {
  return {
    date: "",
    title: "",
    content: "",
    tags: "",
  };
}

const EMPTY_JOURNALS_DRAFT: JournalsDraft = {
  conflict: null,
  create: emptyDraft(),
  createFingerprint: null,
  createKey: null,
  edit: emptyDraft(),
  editingId: null,
};

function journalDraftIsEmpty(draft: JournalDraft): boolean {
  return draft.date === ""
    && draft.title === ""
    && draft.content === ""
    && draft.tags === "";
}

function journalsDraftIsEmpty(draft: JournalsDraft): boolean {
  return draft.conflict == null
    && journalDraftIsEmpty(draft.create)
    && draft.createFingerprint == null
    && draft.createKey == null
    && journalDraftIsEmpty(draft.edit)
    && draft.editingId === null;
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

function journalCreateFingerprint(draft: JournalDraft): string {
  return JSON.stringify({
    content: draft.content,
    date: draft.date,
    tags: parsedTags(draft.tags),
    title: draft.title.trim() || null,
  });
}

function defaultIdempotencyKey(): string {
  return `journal_${crypto.randomUUID().replaceAll("-", "")}`;
}

const PAGE_SIZE = 20;

function cursorMarker(cursor: Cursor): string {
  return `${cursor.sortValue}:${cursor.id}`;
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
  showCreate = true,
  onSaved,
  draftScope = "anonymous",
  reloadToken = "",
}: SupabaseJournalsPanelProps): ReactElement {
  const [journals, setJournals] = useState<Journal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const listGeneration = useRef(0);
  const seenCursors = useRef(new Set<string>());
  const [dateFilter, setDateFilter] = useState("");
  const {
    persist: persistDraft,
    setValue: setDraft,
    value: draft,
  } = useSessionDraft(
    `${SESSION_DRAFT_STORAGE_PREFIX}${draftScope}:journals`,
    EMPTY_JOURNALS_DRAFT,
    journalsDraftIsEmpty,
  );
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<JournalRevision[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [deleting, setDeleting] = useState<Journal | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletedReloadToken, setDeletedReloadToken] = useState(0);
  const conflict = draft.conflict ?? null;

  function setConflict(
    action: SetStateAction<JournalConflict | null>,
  ): void {
    setDraft((current) => ({
      ...current,
      conflict: typeof action === "function"
        ? action(current.conflict ?? null)
        : action,
    }));
  }

  const visibleJournals = dateFilter
    ? journals.filter((journal) => journal.event_date === dateFilter)
    : journals;

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
          setJournals(page.items);
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
  }, [loadAttempt, reloadToken, repository]);

  async function loadMoreJournals(): Promise<void> {
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
      setJournals((current) => {
        const known = new Set(current.map((journal) => journal.id));
        return [
          ...current,
          ...page.items.filter((journal) => !known.has(journal.id)),
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

  async function loadLatestJournal(): Promise<void> {
    if (!conflict || pending !== null) return;
    const retainedDraft = draft.editingId === conflict.id
      ? draft.edit
      : conflict.draft;
    setPending(`reload:${conflict.id}`);
    try {
      const latest = await repository.get(conflict.id);
      if (!latest) {
        setNotice({
          kind: "error",
          message: "未找到最新日记；当前草稿仍保留，请稍后重试。",
        });
        return;
      }
      setJournals((current) => current.map((journal) =>
        journal.id === latest.id ? latest : journal));
      const latestDraft = draftFromJournal(latest);
      await persistDraft((current) => ({
        ...current,
        conflict: current.conflict
          ? {
            ...current.conflict,
            draft: retainedDraft,
            latest: latestDraft,
            latestLoaded: true,
          }
          : null,
      }));
      setNotice({
        kind: "success",
        message: "已载入最新日记；冲突前草稿仍保留在下方，可比较后再决定。",
      });
    } catch {
      setNotice({
        kind: "error",
        message: "最新日记暂时无法读取；当前草稿仍保留。",
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
      edit: conflict.draft,
      editingId: conflict.id,
    }));
    setNotice({
      kind: "success",
      message: "已恢复冲突前草稿；下次保存将使用已载入的最新版本。",
    });
  }

  async function keepLatestConflictVersion(): Promise<void> {
    if (!conflict?.latestLoaded || conflict.latest === null) return;
    const latest = conflict.latest;
    if (draft.editingId === conflict.id) {
      await persistDraft((current) => ({
        ...current,
        conflict: null,
        edit: latest,
      }));
    } else {
      await persistDraft((current) => ({ ...current, conflict: null }));
    }
    setNotice({ kind: "success", message: "已保留服务器最新内容。" });
  }

  async function createJournal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (conflict) return;
    setPending("create");
    setNotice(null);
    const fingerprint = journalCreateFingerprint(draft.create);
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
        date: draft.create.date,
        title: draft.create.title,
        content: draft.create.content,
        tags: parsedTags(draft.create.tags),
      });
      setJournals((current) => [
        created,
        ...current.filter((journal) => journal.id !== created.id),
      ]);
      await persistDraft((current) => ({
        ...current,
        create: emptyDraft(),
        createFingerprint: null,
        createKey: null,
      }));
      setConflict(null);
      await notifySaved();
      setNotice({ kind: "success", message: "日记已保存。" });
    } catch (error) {
      setNotice(failureNotice(error));
    } finally {
      setPending(null);
    }
  }

  function beginEdit(journal: Journal) {
    setDraft((current) => ({
      ...current,
      edit: draftFromJournal(journal),
      editingId: journal.id,
    }));
    setConflict(null);
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
          date: draft.edit.date,
          title: draft.edit.title,
          content: draft.edit.content,
          tags: parsedTags(draft.edit.tags),
        },
      );
      setJournals((current) =>
        current.map((item) =>
          item.id === updated.id ? updated : item));
      await persistDraft((current) => ({
        ...current,
        conflict: null,
        edit: emptyDraft(),
        editingId: null,
      }));
      setConflict(null);
      if (historyId === updated.id) {
        setHistoryId(null);
        setRevisions([]);
      }
      await notifySaved();
      setNotice({ kind: "success", message: "日记修改已保存。" });
    } catch (error) {
      if (error instanceof RepositoryError && error.kind === "conflict") {
        await persistDraft((current) => ({
          ...current,
          conflict: {
            draft: draft.edit,
            id: journal.id,
            latest: null,
            latestLoaded: false,
          },
        }));
      }
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

  async function softDeleteJournal(): Promise<void> {
    if (!deleting || pending !== null) return;
    setPending(`delete:${deleting.id}`);
    setDeleteError(null);
    try {
      await repository.softDelete(deleting.id, deleting.revision);
      setJournals((current) => current.filter((journal) => journal.id !== deleting.id));
      setDeleting(null);
      setDeletedReloadToken((value) => value + 1);
      setNotice({ kind: "success", message: "日记已移到已删除，可随时恢复。" });
      await notifySaved();
    } catch (error) {
      setDeleteError(error instanceof RepositoryError && error.kind === "conflict"
        ? "日记已在其他位置更新；请刷新后核对最新版本。"
        : "尚未删除；请稍后重试。");
    } finally {
      setPending(null);
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
          <h2 id="supabase-journals-title">
            {showCreate ? "日记" : "日记管理与修订"}
          </h2>
          <p className="quiet">
            日记默认只显示用户原话；助手整理和修订按需展开，删除后可恢复。
          </p>
        </div>
        <span className="status blue">Owner-only</span>
      </div>

      {showCreate && <form
        className="supabase-journal-create"
        onSubmit={createJournal}
      >
        <label>
          新日记日期
          <input
            disabled={conflict !== null || pending === "create"}
            onChange={(event) => setDraft((current) => ({
              ...current,
              create: { ...current.create, date: event.target.value },
              createFingerprint: null,
              createKey: null,
            }))}
            required
            type="date"
            value={draft.create.date}
          />
        </label>
        <label>
          新日记标题
          <input
            disabled={conflict !== null || pending === "create"}
            maxLength={200}
            onChange={(event) => setDraft((current) => ({
              ...current,
              create: { ...current.create, title: event.target.value },
              createFingerprint: null,
              createKey: null,
            }))}
            value={draft.create.title}
          />
        </label>
        <label>
          新日记正文
          <textarea
            disabled={conflict !== null || pending === "create"}
            maxLength={100000}
            onChange={(event) => setDraft((current) => ({
              ...current,
              create: { ...current.create, content: event.target.value },
              createFingerprint: null,
              createKey: null,
            }))}
            required
            value={draft.create.content}
          />
        </label>
        <label>
          新日记标签
          <input
            disabled={conflict !== null || pending === "create"}
            onChange={(event) => setDraft((current) => ({
              ...current,
              create: { ...current.create, tags: event.target.value },
              createFingerprint: null,
              createKey: null,
            }))}
            placeholder="用英文逗号分隔"
            value={draft.create.tags}
          />
        </label>
        <button
          className="primary-button"
          disabled={conflict !== null || loading || pending !== null}
          type="submit"
        >
          {pending === "create" ? "正在保存…" : "新建日记"}
        </button>
      </form>}

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
          aria-labelledby="journal-conflict-title"
          className="conflict-card"
        >
          <h3 id="journal-conflict-title">日记已在其他页面更新</h3>
          <p>冲突前草稿已保留；先载入最新版本，再比较和选择。</p>
          {conflict.latest ? (
            <div>
              <p>
                <strong>服务器最新日记</strong>
                {` · ${conflict.latest.date} · ${conflict.latest.title || "无标题"}`}
              </p>
              <label>
                服务器最新正文
                <textarea readOnly value={conflict.latest.content} />
              </label>
              <p className="quiet">
                服务器最新标签：{conflict.latest.tags || "无"}
              </p>
            </div>
          ) : null}
          <p>
            <strong>冲突前日记草稿</strong>
            {` · ${conflict.draft.date} · ${conflict.draft.title || "无标题"}`}
          </p>
          <label>
            冲突前正文草稿
            <textarea readOnly value={conflict.draft.content} />
          </label>
          <p className="quiet">冲突前标签：{conflict.draft.tags || "无"}</p>
          <div className="button-row">
            <button
              className="secondary-button"
              disabled={pending !== null}
              onClick={() => void loadLatestJournal()}
              type="button"
            >
              {pending === `reload:${conflict.id}`
                ? "正在载入…"
                : "载入最新日记"}
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
        <>
          <div className="supabase-record-filter">
            <label>
              筛选日记日期
              <input
                onChange={(event) => setDateFilter(event.target.value)}
                type="date"
                value={dateFilter}
              />
            </label>
            {dateFilter ? (
              <button
                className="secondary-button"
                onClick={() => setDateFilter("")}
                type="button"
              >
                清除日期筛选
              </button>
            ) : null}
            <p className="quiet">
              筛选只作用于当前已加载的 {journals.length} 项
              {nextCursor ? "；继续加载可扩大筛选范围。" : "。"}
            </p>
          </div>
          {visibleJournals.length === 0 ? (
            <div className="empty-state">
              <strong>当前已加载记录中没有该日期的日记</strong>
              {nextCursor ? <p>可继续加载更多日记后再查看。</p> : null}
            </div>
          ) : <ul className="supabase-journal-list">
          {visibleJournals.map((journal) => {
            return (
              <li key={journal.id}>
                {draft.editingId === journal.id ? (
                  <form
                    className="supabase-journal-edit"
                    onSubmit={(event) => updateJournal(event, journal)}
                  >
                    <label>
                      编辑日记日期
                      <input
                        disabled={pending === `reload:${journal.id}`
                          || pending === `update:${journal.id}`}
                        onChange={(event) => setDraft((current) => ({
                          ...current,
                          edit: { ...current.edit, date: event.target.value },
                        }))}
                        required
                        type="date"
                        value={draft.edit.date}
                      />
                    </label>
                    <label>
                      编辑日记标题
                      <input
                        disabled={pending === `reload:${journal.id}`
                          || pending === `update:${journal.id}`}
                        maxLength={200}
                        onChange={(event) => setDraft((current) => ({
                          ...current,
                          edit: { ...current.edit, title: event.target.value },
                        }))}
                        value={draft.edit.title}
                      />
                    </label>
                    <label>
                      编辑日记正文
                      <textarea
                        disabled={pending === `reload:${journal.id}`
                          || pending === `update:${journal.id}`}
                        maxLength={100000}
                        onChange={(event) => setDraft((current) => ({
                          ...current,
                          edit: { ...current.edit, content: event.target.value },
                        }))}
                        required
                        value={draft.edit.content}
                      />
                    </label>
                    <label>
                      编辑日记标签
                      <input
                        disabled={pending === `reload:${journal.id}`
                          || pending === `update:${journal.id}`}
                        onChange={(event) => setDraft((current) => ({
                          ...current,
                          edit: { ...current.edit, tags: event.target.value },
                        }))}
                        value={draft.edit.tags}
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
                        onClick={() => setDraft((current) => ({
                          ...current,
                          edit: emptyDraft(),
                          editingId: null,
                        }))}
                        type="button"
                      >
                        取消
                      </button>
                    </div>
                  </form>
                ) : (
                  <JournalCard
                    busy={conflict !== null || pending !== null}
                    journal={journal}
                    onDelete={() => {
                      setDeleteError(null);
                      setDeleting(journal);
                    }}
                    onEdit={() => beginEdit(journal)}
                    onLoadRevisions={() => void showRevisions(journal)}
                    revisions={historyId === journal.id ? revisions : []}
                    revisionsLoading={historyId === journal.id && historyLoading}
                  />
                )}
              </li>
            );
          })}
        </ul>}
          {nextCursor ? (
            <button
              className="secondary-button"
              disabled={loadingMore}
              onClick={() => void loadMoreJournals()}
              type="button"
            >
              {loadingMore ? "正在加载…" : "加载更多日记"}
            </button>
          ) : null}
          {loadMoreFailed ? (
            <p className="error-message" role="alert">
              更多日记暂时无法读取；已加载内容不受影响，可重试。
            </p>
          ) : null}
        </>
      )}
      <DeletedJournalsPanel
        onRestored={(journal) => {
          setJournals((current) => [journal, ...current.filter((item) => item.id !== journal.id)]);
          setNotice({ kind: "success", message: "日记已恢复。" });
        }}
        reloadToken={deletedReloadToken}
        repository={repository}
      />
      <DeleteJournalDialog
        busy={deleting ? pending === `delete:${deleting.id}` : false}
        error={deleteError}
        journal={deleting}
        onCancel={() => {
          if (pending === null) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
        onConfirm={() => void softDeleteJournal()}
      />
    </section>
  );
}
