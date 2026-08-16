import type { SupabaseClient } from "@supabase/supabase-js";

import type { JournalNormalization } from "../journal/normalization-contract";

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
  event_time?: string | null;
  time_precision?: JournalTimePrecision;
  source?: JournalSource;
  privacy?: "owner-only";
  raw_revision?: number;
  normalization_status?: JournalNormalizationStatus;
  normalization_contract_version?: string | null;
  normalization_prompt_version?: string | null;
  normalization_processor?: JournalNormalizationProcessor | null;
  normalized_source_revision?: number | null;
  metadata?: JournalNormalization | Record<string, never>;
  normalized_at?: string | null;
  normalization_error_code?: string | null;
}

export type JournalTimePrecision = "exact" | "approximate" | "unknown";
export type JournalSource = "agent" | "life_console" | "automation";
export type JournalNormalizationProcessor = "agent" | "deepseek";
export type JournalNormalizationStatus =
  | "legacy"
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "stale";

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

export interface CreateRawJournalInput {
  recordKey: string;
  date: string;
  eventTime: string | null;
  timePrecision: JournalTimePrecision;
  source: JournalSource;
  privacy: "owner-only";
  content: string;
}

export interface JournalNormalizationJob {
  id: string;
  journal_id: number;
  source_revision: number;
  status: "processing" | "completed" | "failed" | "stale";
  processor: JournalNormalizationProcessor;
}

export interface BeginJournalNormalizationInput {
  journalId: number;
  sourceRevision: number;
  contractVersion: string;
  promptVersion: string;
  processor: JournalNormalizationProcessor;
  taskKey: string;
}

export interface CompleteJournalNormalizationInput {
  jobId: string;
  sourceRevision: number;
  metadata: JournalNormalization;
  title: string;
  tags: string[];
}

export interface FailJournalNormalizationInput {
  jobId: string;
  sourceRevision: number;
  failureCode: string;
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

export interface JournalNormalizationRepositoryPort
  extends JournalRepositoryPort {
  createRaw(key: string, input: CreateRawJournalInput): Promise<Journal>;
  beginNormalization(
    input: BeginJournalNormalizationInput,
  ): Promise<JournalNormalizationJob>;
  completeNormalization(
    input: CompleteJournalNormalizationInput,
  ): Promise<Journal>;
  failNormalization(
    input: FailJournalNormalizationInput,
  ): Promise<JournalNormalizationJob>;
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

function boundedString(
  value: string,
  field: string,
  minimum: number,
  maximum: number,
): string {
  if (
    typeof value !== "string"
    || value.length < minimum
    || value.length > maximum
  ) {
    throw invalid(`${field} must contain ${minimum} through ${maximum} characters`);
  }
  return value;
}

function positiveRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalid("Source revision must be a positive integer");
  }
  return value;
}

function eventTime(
  value: string | null,
  precision: JournalTimePrecision,
): string | null {
  if (precision === "unknown") {
    if (value !== null) throw invalid("Unknown journal time must be null");
    return null;
  }
  if (
    value === null
    || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)
  ) {
    throw invalid("Known journal time must use HH:mm or HH:mm:ss");
  }
  return value;
}

function requireResult<T>(rows: T[], code: string, message: string): T {
  const result = rows[0];
  if (!result) {
    throw new RepositoryError("unknown", 500, code, message);
  }
  return result;
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

  async createRaw(
    key: string,
    input: CreateRawJournalInput,
  ): Promise<Journal> {
    const normalized = {
      recordKey: boundedString(input.recordKey, "Record key", 8, 200),
      date: isoDate(input.date),
      eventTime: eventTime(input.eventTime, input.timePrecision),
      timePrecision: input.timePrecision,
      source: input.source,
      privacy: input.privacy,
      content: content(input.content),
    };
    const rows = await this.repository.executeIdempotentWrite<Journal[]>(
      key,
      async () =>
        await this.client.rpc("create_journal_v2", {
          p_record_key: normalized.recordKey,
          p_idempotency_key: key,
          p_event_date: normalized.date,
          p_event_time: normalized.eventTime,
          p_time_precision: normalized.timePrecision,
          p_source: normalized.source,
          p_privacy: normalized.privacy,
          p_content: normalized.content,
        }) as SupabaseResult<Journal[]>,
    );
    return requireResult(
      rows,
      "empty_raw_journal_result",
      "Raw journal creation completed without a result",
    );
  }

  async beginNormalization(
    input: BeginJournalNormalizationInput,
  ): Promise<JournalNormalizationJob> {
    const journalId = positiveId(input.journalId);
    const sourceRevision = positiveRevision(input.sourceRevision);
    boundedString(input.contractVersion, "Contract version", 1, 100);
    boundedString(input.promptVersion, "Prompt version", 1, 100);
    const rows = await this.repository.executeIdempotentWrite<JournalNormalizationJob[]>(
      input.taskKey,
      async () =>
        await this.client.rpc("begin_journal_normalization", {
          p_journal_id: journalId,
          p_source_revision: sourceRevision,
          p_contract_version: input.contractVersion,
          p_prompt_version: input.promptVersion,
          p_processor: input.processor,
          p_task_key: input.taskKey,
        }) as SupabaseResult<JournalNormalizationJob[]>,
    );
    return requireResult(
      rows,
      "empty_normalization_job_result",
      "Normalization started without a job result",
    );
  }

  async completeNormalization(
    input: CompleteJournalNormalizationInput,
  ): Promise<Journal> {
    const sourceRevision = positiveRevision(input.sourceRevision);
    const normalizedTitle = title(input.title);
    if (normalizedTitle === null) {
      throw invalid("Normalized journal title is required");
    }
    const normalizedTags = tags(input.tags);
    const rows = await this.repository.executeIdempotentWrite<Journal[]>(
      boundedString(input.jobId, "Normalization job id", 16, 200),
      async () =>
        await this.client.rpc("complete_journal_normalization", {
          p_job_id: input.jobId,
          p_expected_source_revision: sourceRevision,
          p_metadata: input.metadata,
          p_title: normalizedTitle,
          p_tags: normalizedTags,
        }) as SupabaseResult<Journal[]>,
    );
    return requireResult(
      rows,
      "empty_normalized_journal_result",
      "Journal normalization completed without a result",
    );
  }

  async failNormalization(
    input: FailJournalNormalizationInput,
  ): Promise<JournalNormalizationJob> {
    const sourceRevision = positiveRevision(input.sourceRevision);
    const failureCode = boundedString(input.failureCode, "Failure code", 3, 80);
    const rows = await this.repository.executeIdempotentWrite<JournalNormalizationJob[]>(
      boundedString(input.jobId, "Normalization job id", 16, 200),
      async () =>
        await this.client.rpc("fail_journal_normalization", {
          p_job_id: input.jobId,
          p_expected_source_revision: sourceRevision,
          p_failure_code: failureCode,
        }) as SupabaseResult<JournalNormalizationJob[]>,
    );
    return requireResult(
      rows,
      "empty_failed_normalization_result",
      "Journal normalization failure was not recorded",
    );
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
