import type { SupabaseClient } from "@supabase/supabase-js";

export interface Cursor {
  sortValue: string;
  id: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: Cursor | null;
}

export type ListPageOptions =
  | {
    table: "journals";
    sortColumn: "event_date";
    pageSize?: number;
    cursor?: Cursor;
  }
  | {
    table: "goals";
    sortColumn: "created_at";
    excludeDeleted: true;
    pageSize?: number;
    cursor?: Cursor;
  }
  | {
    table: "daily_checkins";
    sortColumn: "checkin_date";
    pageSize?: number;
    cursor?: Cursor;
  }
  | {
    table: "weekly_reviews";
    sortColumn: "week_start";
    pageSize?: number;
    cursor?: Cursor;
  }
  | {
    table: "phase_reviews";
    sortColumn: "period_start";
    pageSize?: number;
    cursor?: Cursor;
  }
  | {
    table: "audit_events" | "backup_runs";
    sortColumn: "created_at";
    pageSize?: number;
    cursor?: Cursor;
  };

export type MutableTable =
  | "goals"
  | "journals"
  | "daily_checkins"
  | "weekly_reviews"
  | "phase_reviews"
  | "health_days";

export interface SupabaseErrorLike {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

export interface SupabaseResult<T> {
  data: T | null;
  error: SupabaseErrorLike | null;
  status: number;
}

export type RepositoryErrorKind =
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "validation"
  | "transient"
  | "unknown";

export class RepositoryError extends Error {
  constructor(
    public readonly kind: RepositoryErrorKind,
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

const protectedUpdateFields = new Set([
  "id",
  "user_id",
  "revision",
  "created_at",
  "updated_at",
]);

function validationError(message: string): RepositoryError {
  return new RepositoryError("validation", 400, "invalid_request", message);
}

function normalizedError(
  error: SupabaseErrorLike,
  status: number,
): RepositoryError {
  const code = error.code ?? "repository_error";
  if (status === 401) {
    return new RepositoryError(
      "unauthorized",
      status,
      code,
      error.message,
    );
  }
  if (status === 403) {
    return new RepositoryError("forbidden", status, code, error.message);
  }
  if (status === 409 || code === "23505") {
    return new RepositoryError("conflict", 409, code, error.message);
  }
  if (
    status === 400
    || status === 422
    || code === "23502"
    || code === "23514"
  ) {
    return new RepositoryError(
      "validation",
      status || 400,
      code,
      error.message,
    );
  }
  if (
    status === 0
    || status === 408
    || status === 429
    || status >= 500
    || code === "PGRST000"
  ) {
    return new RepositoryError(
      "transient",
      status || 503,
      code,
      error.message,
    );
  }
  return new RepositoryError("unknown", status, code, error.message);
}

function pageSize(value: number | undefined): number {
  const resolved = value ?? 50;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 100) {
    throw validationError("Page size must be an integer from 1 through 100");
  }
  return resolved;
}

function validateCursor(
  sortColumn:
    | "event_date"
    | "checkin_date"
    | "week_start"
    | "period_start"
    | "created_at",
  cursor: Cursor,
): void {
  if (!Number.isSafeInteger(cursor.id) || cursor.id < 1) {
    throw validationError("Cursor id must be a positive integer");
  }
  const validSortValue = sortColumn !== "created_at"
    ? /^\d{4}-\d{2}-\d{2}$/.test(cursor.sortValue)
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      cursor.sortValue,
    ) && !Number.isNaN(Date.parse(cursor.sortValue));
  if (!validSortValue) {
    throw validationError(`Invalid ${sortColumn} cursor value`);
  }
}

function compositeCursorFilter(
  sortColumn:
    | "event_date"
    | "checkin_date"
    | "week_start"
    | "period_start"
    | "created_at",
  cursor: Cursor,
): string {
  return `${sortColumn}.lt.${cursor.sortValue},and(${sortColumn}.eq.${cursor.sortValue},id.lt.${cursor.id})`;
}

export class LifeConsoleRepository {
  constructor(private readonly client: SupabaseClient) {}

  async executeRead<T>(
    operation: () => Promise<SupabaseResult<T>>,
  ): Promise<T | null> {
    let result = await operation();
    if (result.error) {
      const firstError = normalizedError(result.error, result.status);
      if (firstError.kind !== "transient") throw firstError;
      result = await operation();
    }
    if (result.error) {
      throw normalizedError(result.error, result.status);
    }
    return result.data;
  }

  async listPage<T extends { id: number }>(
    options: ListPageOptions,
  ): Promise<Page<T>> {
    const limit = pageSize(options.pageSize);
    if (options.cursor) {
      validateCursor(options.sortColumn, options.cursor);
    }

    const read = async (): Promise<SupabaseResult<T[]>> => {
      let query = this.client
        .from(options.table)
        .select("*")
        .order(options.sortColumn, { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1);
      if (options.cursor) {
        query = query.or(
          compositeCursorFilter(options.sortColumn, options.cursor),
        );
      }
      if (
        options.table === "journals"
        || options.table === "weekly_reviews"
        || options.table === "phase_reviews"
        || (
          options.table === "goals"
          && options.excludeDeleted
        )
      ) {
        query = query.is("deleted_at", null);
      }
      return await query as SupabaseResult<T[]>;
    };

    const rows = await this.executeRead(read) ?? [];
    const items = rows.slice(0, limit);
    const lastItem = items.at(-1) as
      | (T & Record<string, unknown>)
      | undefined;
    const nextCursor = rows.length > limit && lastItem
      ? {
        sortValue: String(lastItem[options.sortColumn]),
        id: lastItem.id,
      }
      : null;
    return { items, nextCursor };
  }

  async updateWithRevision<T>(
    table: MutableTable,
    id: number,
    expectedRevision: number,
    patch: Record<string, unknown>,
  ): Promise<T> {
    if (!Number.isSafeInteger(id) || id < 1) {
      throw validationError("Record id must be a positive integer");
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw validationError("Expected revision must be a positive integer");
    }
    if (
      Object.keys(patch).some((field) => protectedUpdateFields.has(field))
    ) {
      throw validationError("Update patch contains a protected field");
    }

    const result = await this.client
      .from(table)
      .update({
        ...patch,
        revision: expectedRevision + 1,
      })
      .eq("id", id)
      .eq("revision", expectedRevision)
      .select("*")
      .limit(1) as SupabaseResult<T[]>;
    if (result.error) {
      throw normalizedError(result.error, result.status);
    }
    const updated = result.data?.[0];
    if (!updated) {
      throw new RepositoryError(
        "conflict",
        409,
        "revision_conflict",
        "The record changed before this update was applied",
      );
    }
    return updated;
  }

  async executeIdempotentWrite<T>(
    key: string,
    operation: (key: string) => Promise<SupabaseResult<T>>,
  ): Promise<T> {
    if (key.length < 16 || key.length > 200) {
      throw validationError(
        "Idempotency key must contain 16 through 200 characters",
      );
    }
    const result = await operation(key);
    if (result.error) {
      throw normalizedError(result.error, result.status);
    }
    if (result.data === null) {
      throw new RepositoryError(
        "unknown",
        result.status,
        "empty_write_result",
        "The write completed without a result",
      );
    }
    return result.data;
  }
}
