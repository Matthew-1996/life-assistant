import type { FitnessSubscriptionPort } from "../domain/fitness-subscription";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FITNESS_PAGE_SIZE,
  type CreateFitnessAppointment,
  type FitnessAppointment,
  type FitnessFields,
  type FitnessPage,
  type FitnessRange,
  type FitnessRepositoryPort,
  type FitnessRevision,
  type UpdateFitnessAppointment,
} from "../domain/fitness";
import { LifeConsoleRepository, RepositoryError, type SupabaseResult } from "./repository";

function invalid(message: string): never {
  throw new RepositoryError("validation", 400, "invalid_request", message);
}
function uuid(value: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    invalid("Appointment id must be a UUID");
  }
  return value;
}
function revision(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 2147483647) invalid("Expected revision must be a positive integer");
  return value;
}
function date(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) invalid("Calendar date must be YYYY-MM-DD");
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) invalid("Invalid calendar date");
  return ms;
}
function timestamp(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)) {
    invalid("Appointment time requires a valid ISO timestamp with explicit offset");
  }
  date(value.slice(0, 10));
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) invalid("Invalid appointment time");
  return ms;
}
function text(value: string, maximum: number, label: string): string {
  if (typeof value !== "string" || [...value].length > maximum || value.includes("\0")) invalid(`${label} is invalid or too long`);
  return value;
}
function fields(input: FitnessFields) {
  // Match SQL btrim's space normalization; reject all-whitespace titles as well.
  if (typeof input.title !== "string") invalid("Appointment title is required");
  const title = text(input.title.replace(/^ +| +$/g, ""), 120, "Title");
  if (!/\S/.test(title)) invalid("Appointment title is required");
  const start = timestamp(input.startAt);
  const end = timestamp(input.endAt);
  const shanghaiDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  const kind = input.timeKind ?? "timed";
  if (kind !== "timed" && kind !== "all_day") invalid("Invalid time kind");
  if (kind === "all_day") {
    const local = (ms: number) => new Intl.DateTimeFormat("en-GB", {timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).format(ms);
    const nextDate = new Date(Date.parse(`${shanghaiDay(start)}T00:00:00Z`) + 86400000).toISOString().slice(0,10);
    if (local(start) !== "00:00:00" || local(end) !== "00:00:00" || start % 1000 !== 0 || end % 1000 !== 0 || shanghaiDay(end) !== nextDate) invalid("All-day appointment must span one Shanghai calendar day");
  } else if (end <= start || shanghaiDay(start) !== shanghaiDay(end)) invalid("Appointment must end later on the same Shanghai day");
  return {
    ...(input.timeKind !== undefined ? { p_time_kind: kind } : {}),
    p_title: title,
    p_start_at: input.startAt,
    p_end_at: input.endAt,
    p_location: text(input.location ?? "", 240, "Location"),
    p_notes: text(input.notes ?? "", 4000, "Notes"),
  };
}

/** Phase A adapter only: no production wiring or fallback synthetic data. */
export class FitnessRepository implements FitnessRepositoryPort {
  private readonly repository: LifeConsoleRepository;
  constructor(private readonly client: SupabaseClient, readonly subscription?: FitnessSubscriptionPort) {
    this.repository = new LifeConsoleRepository(client);
  }

  private async rpc(name: string, args: Record<string, unknown>, read = false): Promise<FitnessAppointment[]> {
    const operation = async () => await this.client.rpc(name, args) as SupabaseResult<FitnessAppointment[]>;
    try {
      const rows = read
        ? await this.repository.executeRead(operation)
        : await this.repository.executeWrite(operation);
      if (!Array.isArray(rows)) throw new RepositoryError("unknown", 502, "invalid_fitness_response", "Expected appointment rows");
      return rows;
    } catch (error) {
      if (error instanceof RepositoryError) {
        if (error.code === "22023" || error.code === "22P02") throw new RepositoryError("validation", 400, error.code, error.message);
        if (error.code === "P0002") throw new RepositoryError("conflict", 409, error.code, "Appointment is no longer available");
        if (error.code === "42501" && error.status !== 401) throw new RepositoryError("forbidden", 403, error.code, error.message);
      }
      throw error;
    }
  }
  private saved(rows: FitnessAppointment[]): FitnessAppointment {
    if (rows.length !== 1) throw new RepositoryError("unknown", 502, "invalid_fitness_write_result", "Expected one saved appointment");
    return rows[0];
  }

  async listRange(input: FitnessRange): Promise<FitnessPage> {
    const start = date(input.from), end = date(input.to);
    if (end <= start || end - start > 62 * 86400_000) invalid("Calendar range must span 1 through 62 days");
    if (input.cursor) { timestamp(input.cursor.startAt); uuid(input.cursor.id); }
    const rows = await this.rpc("list_fitness_appointments", {
      p_from: input.from,
      p_to: input.to,
      p_cursor_start: input.cursor?.startAt ?? null,
      p_cursor_id: input.cursor?.id ?? null,
    }, true);
    if (rows.length > FITNESS_PAGE_SIZE + 1) throw new RepositoryError("unknown", 502, "invalid_fitness_page", "Calendar page exceeded its limit");
    const items = rows.slice(0, FITNESS_PAGE_SIZE), last = items.at(-1);
    return {
      items,
      // Keep PostgreSQL's full timestamp precision; Date would lose microseconds.
      nextCursor: rows.length > FITNESS_PAGE_SIZE && last ? { startAt: last.start_at, id: last.id } : null,
    };
  }
  async get(id: string): Promise<FitnessAppointment | null> {
    const rows = await this.rpc("get_fitness_appointment", { p_id: uuid(id) }, true);
    if (rows.length > 1) throw new RepositoryError("unknown", 502, "invalid_fitness_response", "Expected at most one appointment");
    return rows[0] ?? null;
  }
  async create(input: CreateFitnessAppointment): Promise<FitnessAppointment> {
    if (typeof input.operationKey !== "string" || input.operationKey.length < 16 || input.operationKey.length > 200) invalid("Operation key must contain 16 through 200 characters");
    return this.saved(await this.rpc("create_fitness_appointment", { p_operation_key: input.operationKey, ...fields(input) }));
  }
  async update(input: UpdateFitnessAppointment): Promise<FitnessAppointment> {
    return this.saved(await this.rpc("update_fitness_appointment", {
      p_id: uuid(input.id), p_expected_revision: revision(input.expectedRevision), ...fields(input),
    }));
  }
  async softDelete(input: FitnessRevision): Promise<FitnessAppointment> {
    return this.saved(await this.rpc("soft_delete_fitness_appointment", {
      p_id: uuid(input.id), p_expected_revision: revision(input.expectedRevision),
    }));
  }
}
