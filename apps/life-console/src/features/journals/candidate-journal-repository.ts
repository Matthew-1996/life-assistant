import type { Dashboard } from "../../data/dashboard";
import type {
  CreateJournalInput,
  Journal,
  JournalRepositoryPort,
  JournalRevision,
  UpdateJournalInput,
} from "../../supabase/journals";
import { RepositoryError, type Page } from "../../supabase/repository";

type CandidateJournal = Dashboard["records"]["recent_journals"][number];

function cloneJournal(journal: Journal): Journal {
  return {
    ...journal,
    metadata: journal.metadata ? structuredClone(journal.metadata) : undefined,
    tags: [...journal.tags],
  };
}

function page(items: Journal[]): Page<Journal> {
  return {
    items: items.map(cloneJournal),
    nextCursor: null,
  };
}

function unavailable(): RepositoryError {
  return new RepositoryError(
    "validation",
    400,
    "candidate_write_not_implemented",
    "Candidate journal write is not available",
  );
}

function conflict(): RepositoryError {
  return new RepositoryError(
    "conflict",
    409,
    "candidate_revision_conflict",
    "Candidate journal revision changed",
  );
}

function missing(): RepositoryError {
  return new RepositoryError(
    "validation",
    404,
    "candidate_journal_missing",
    "Candidate journal was not found",
  );
}

function toJournal(row: CandidateJournal, index: number): Journal {
  const timestamp = `${row.date}T12:00:00.000Z`;
  return {
    id: index + 1,
    user_id: "synthetic-preview",
    event_date: row.date,
    title: row.title,
    content: row.summary,
    tags: [],
    revision: 1,
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    event_time: null,
    time_precision: "unknown",
    source: "life_console",
    privacy: "owner-only",
    raw_revision: 1,
    normalization_status: "legacy",
    metadata: {},
  };
}

export function createCandidateJournalRepository(
  rows: CandidateJournal[],
): JournalRepositoryPort {
  const journals = rows.map(toJournal);

  function current(id: number): Journal {
    const journal = journals.find((item) => item.id === id);
    if (!journal) throw missing();
    return journal;
  }

  function replace(next: Journal): Journal {
    const index = journals.findIndex((item) => item.id === next.id);
    if (index < 0) throw missing();
    journals[index] = next;
    return cloneJournal(next);
  }

  function expectRevision(journal: Journal, expectedRevision: number): void {
    if (journal.revision !== expectedRevision) throw conflict();
  }

  return {
    async list() {
      return page(journals.filter((journal) => journal.deleted_at === null));
    },
    async listDeleted() {
      return page(journals.filter((journal) => journal.deleted_at !== null));
    },
    async get(id: number) {
      const journal = journals.find((item) => item.id === id);
      return journal ? cloneJournal(journal) : null;
    },
    async revisions(_id: number): Promise<JournalRevision[]> {
      return [];
    },
    async create(_key: string, _input: CreateJournalInput): Promise<Journal> {
      throw unavailable();
    },
    async update(
      id: number,
      expectedRevision: number,
      input: UpdateJournalInput,
    ): Promise<Journal> {
      const journal = current(id);
      expectRevision(journal, expectedRevision);
      return replace({
        ...journal,
        event_date: input.date ?? journal.event_date,
        title: input.title === undefined
          ? journal.title
          : input.title?.trim() || null,
        content: input.content ?? journal.content,
        tags: input.tags ? [...input.tags] : journal.tags,
        revision: journal.revision + 1,
        updated_at: new Date().toISOString(),
      });
    },
    async softDelete(
      id: number,
      expectedRevision: number,
    ): Promise<Journal> {
      const journal = current(id);
      if (journal.deleted_at !== null) return cloneJournal(journal);
      expectRevision(journal, expectedRevision);
      const now = new Date().toISOString();
      return replace({
        ...journal,
        deleted_at: now,
        revision: journal.revision + 1,
        updated_at: now,
      });
    },
    async restore(
      id: number,
      expectedRevision: number,
    ): Promise<Journal> {
      const journal = current(id);
      if (journal.deleted_at === null) return cloneJournal(journal);
      expectRevision(journal, expectedRevision);
      return replace({
        ...journal,
        deleted_at: null,
        revision: journal.revision + 1,
        updated_at: new Date().toISOString(),
      });
    },
  };
}
