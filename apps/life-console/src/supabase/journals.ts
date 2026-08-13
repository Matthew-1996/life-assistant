import type { SupabaseClient } from "@supabase/supabase-js";

import {
  LifeConsoleRepository,
  RepositoryError,
  type Cursor,
  type Page,
  type SupabaseResult,
} from "./repository";

export interface Journal {
  id: number;
  user_id: string;
  event_date: string;
  title: string | null;
  content: string;
  tags: string[];
  revision: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JournalSnapshot {
  event_date: string;
  title: string | null;
  content: string;
  tags: string[];
  deleted_at: string | null;
}

export interface JournalRevision {
  id: number;
  user_id: string;
  journal_id: number;
  revision: number;
  snapshot: JournalSnapshot;
  reason: string | null;
  created_at: string;
}

export interface CreateJournalInput {
  date: string;
  title?: string | null;
  content: string;
  tags?: string[];
}

export interface UpdateJournalInput {
  date?: string;
  title?: string | null;
  content?: string;
  tags?: string[];
}

export interface JournalListOptions {
  pageSize?: number;
  cursor?: Cursor;
}

export interface JournalRepositoryPort {
  list(options?: JournalListOptions): Promise<Page<Journal>>;
  get(id: number): Promise<Journal | null>;
  revisions(id: number): Promise<JournalRevision[]>;
  create(key: string, input: CreateJournalInput): Promise<Journal>;
  update(
    id: number,
    expectedRevision: number,
    input: UpdateJournalInput,
  ): Promise<Journal>;
}

const allowedUpdateFields = new Set([
  "date",
  "title",
  "content",
  "tags",
]);

function invalid(message: string): RepositoryError {
  return new RepositoryError("validation", 400, "invalid_request", message);
}

function positiveId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalid("Journal id must be a positive integer");
  }
  return value;
}

function isoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalid("Journal date must be an ISO date");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw invalid("Journal date must be an ISO date");
  }
  return value;
}

function title(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length > 200) {
    throw invalid("Journal title cannot exceed 200 characters");
  }
  return normalized || null;
}

function content(value: string): string {
  if (
    typeof value !== "string"
    || value.trim().length === 0
    || value.length > 100_000
  ) {
    throw invalid(
      "Journal content must contain 1 through 100000 characters",
    );
  }
  return value;
}

function tags(value: string[] | undefined): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value)
    || value.some((tag) => typeof tag !== "string")
  ) {
    throw invalid("Journal tags must be strings");
  }
  return [...new Set(
    value.map((tag) => tag.trim()).filter(Boolean),
  )];
}

function normalizeUpdate(
  input: UpdateJournalInput,
): Record<string, unknown> {
  const fields = Object.keys(input);
  if (
    fields.length === 0
    || fields.some((field) => !allowedUpdateFields.has(field))
  ) {
    throw invalid("Journal update fields are invalid");
  }

  const patch: Record<string, unknown> = {};
  if (input.date !== undefined) {
    patch.event_date = isoDate(input.date);
  }
  if (input.title !== undefined) {
    patch.title = title(input.title);
  }
  if (input.content !== undefined) {
    patch.content = content(input.content);
  }
  if (input.tags !== undefined) {
    patch.tags = tags(input.tags);
  }
  return patch;
}

export class JournalRepository implements JournalRepositoryPort {
  private readonly repository: LifeConsoleRepository;

  constructor(
    private readonly client: SupabaseClient,
    repository?: LifeConsoleRepository,
  ) {
    this.repository = repository ?? new LifeConsoleRepository(client);
  }

  list(options: JournalListOptions = {}): Promise<Page<Journal>> {
    return this.repository.listPage<Journal>({
      table: "journals",
      sortColumn: "event_date",
      pageSize: options.pageSize,
      cursor: options.cursor,
    });
  }

  async get(id: number): Promise<Journal | null> {
    const journalId = positiveId(id);
    const rows = await this.repository.executeRead<Journal[]>(
      async () =>
        await this.client
          .from("journals")
          .select("*")
          .eq("id", journalId)
          .is("deleted_at", null)
          .limit(1) as SupabaseResult<Journal[]>,
    );
    return rows?.[0] ?? null;
  }

  async revisions(id: number): Promise<JournalRevision[]> {
    const journalId = positiveId(id);
    return await this.repository.executeRead<JournalRevision[]>(
      async () =>
        await this.client
          .from("journal_revisions")
          .select("*")
          .eq("journal_id", journalId)
          .order("revision", { ascending: false }) as SupabaseResult<
            JournalRevision[]
          >,
    ) ?? [];
  }

  async create(
    key: string,
    input: CreateJournalInput,
  ): Promise<Journal> {
    const normalized = {
      date: isoDate(input.date),
      title: title(input.title),
      content: content(input.content),
      tags: tags(input.tags),
    };
    const rows = await this.repository.executeIdempotentWrite<Journal[]>(
      key,
      async () =>
        await this.client.rpc("create_journal", {
          p_idempotency_key: key,
          p_event_date: normalized.date,
          p_title: normalized.title,
          p_content: normalized.content,
          p_tags: normalized.tags,
        }) as SupabaseResult<Journal[]>,
    );
    const created = rows[0];
    if (!created) {
      throw new RepositoryError(
        "unknown",
        500,
        "empty_journal_result",
        "Journal creation completed without a result",
      );
    }
    return created;
  }

  async update(
    id: number,
    expectedRevision: number,
    input: UpdateJournalInput,
  ): Promise<Journal> {
    return await this.repository.updateWithRevision<Journal>(
      "journals",
      id,
      expectedRevision,
      normalizeUpdate(input),
    );
  }
}
