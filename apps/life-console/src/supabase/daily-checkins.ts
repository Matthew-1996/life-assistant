import type { SupabaseClient } from "@supabase/supabase-js";

import {
  LifeConsoleRepository,
  RepositoryError,
  type Cursor,
  type Page,
  type SupabaseResult,
} from "./repository";

export type Rating = 1 | 2 | 3 | 4 | 5;
export type AnchorState = "complete" | "minimum" | "skipped";
export type AnchorKey =
  | "wake"
  | "body_light"
  | "life_action"
  | "wind_down";
export type DailyAnchors = Partial<Record<AnchorKey, AnchorState>>;

export interface DailyCheckin {
  id: number;
  user_id: string;
  checkin_date: string;
  sleep_quality: Rating | null;
  energy: Rating | null;
  mood: Rating | null;
  life_feeling: Rating | null;
  anchors: DailyAnchors | null;
  notes: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface DailyCheckinFields {
  sleepQuality?: Rating | number | null;
  energy?: Rating | number | null;
  mood?: Rating | number | null;
  lifeFeeling?: Rating | number | null;
  anchors?: DailyAnchors | null;
  notes?: string | null;
}

export interface CreateDailyCheckinInput extends DailyCheckinFields {
  date: string;
}

export interface DailyCheckinListOptions {
  pageSize?: number;
  cursor?: Cursor;
}

export interface DailyCheckinRepositoryPort {
  get(date: string): Promise<DailyCheckin | null>;
  list(options?: DailyCheckinListOptions): Promise<Page<DailyCheckin>>;
  create(
    key: string,
    input: CreateDailyCheckinInput,
  ): Promise<DailyCheckin>;
  update(
    id: number,
    expectedRevision: number,
    fields: DailyCheckinFields,
  ): Promise<DailyCheckin>;
}

const allowedFieldNames = new Set([
  "sleepQuality",
  "energy",
  "mood",
  "lifeFeeling",
  "anchors",
  "notes",
]);
const anchorKeys = new Set<AnchorKey>([
  "wake",
  "body_light",
  "life_action",
  "wind_down",
]);
const anchorStates = new Set<AnchorState>([
  "complete",
  "minimum",
  "skipped",
]);

function invalid(message: string): RepositoryError {
  return new RepositoryError("validation", 400, "invalid_request", message);
}

function isoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalid("Daily check-in date must be an ISO date");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw invalid("Daily check-in date must be an ISO date");
  }
  return value;
}

function rating(
  value: number | null | undefined,
  label: string,
): Rating | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw invalid(`${label} must be an integer from 1 through 5`);
  }
  return value as Rating;
}

function anchors(
  value: DailyAnchors | null | undefined,
): DailyAnchors | null {
  if (value === null || value === undefined) return null;
  const entries = Object.entries(value);
  for (const [key, state] of entries) {
    if (
      !anchorKeys.has(key as AnchorKey)
      || !anchorStates.has(state as AnchorState)
    ) {
      throw invalid("Daily check-in anchors are invalid");
    }
  }
  return entries.length > 0 ? value : null;
}

function notes(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length > 160) {
    throw invalid("Daily check-in notes cannot exceed 160 characters");
  }
  return normalized || null;
}

function normalizeFields(
  fields: DailyCheckinFields,
  requireValue: boolean,
): Record<string, unknown> {
  const names = Object.keys(fields);
  if (
    names.length === 0
    || names.some((name) => !allowedFieldNames.has(name))
  ) {
    throw invalid("Daily check-in fields are invalid");
  }

  const normalized: Record<string, unknown> = {};
  if (fields.sleepQuality !== undefined) {
    normalized.sleep_quality = rating(
      fields.sleepQuality,
      "Sleep quality",
    );
  }
  if (fields.energy !== undefined) {
    normalized.energy = rating(fields.energy, "Energy");
  }
  if (fields.mood !== undefined) {
    normalized.mood = rating(fields.mood, "Mood");
  }
  if (fields.lifeFeeling !== undefined) {
    normalized.life_feeling = rating(
      fields.lifeFeeling,
      "Life feeling",
    );
  }
  if (fields.anchors !== undefined) {
    normalized.anchors = anchors(fields.anchors);
  }
  if (fields.notes !== undefined) {
    normalized.notes = notes(fields.notes);
  }

  if (
    requireValue
    && Object.values(normalized).every((value) => value === null)
  ) {
    throw invalid("Daily check-in requires one explicit value");
  }
  return normalized;
}

export class DailyCheckinRepository
implements DailyCheckinRepositoryPort {
  private readonly repository: LifeConsoleRepository;

  constructor(
    private readonly client: SupabaseClient,
    repository?: LifeConsoleRepository,
  ) {
    this.repository = repository ?? new LifeConsoleRepository(client);
  }

  async get(date: string): Promise<DailyCheckin | null> {
    const checkinDate = isoDate(date);
    const rows = await this.repository.executeRead<DailyCheckin[]>(
      async () =>
        await this.client
          .from("daily_checkins")
          .select("*")
          .eq("checkin_date", checkinDate)
          .limit(1) as SupabaseResult<DailyCheckin[]>,
    );
    return rows?.[0] ?? null;
  }

  list(
    options: DailyCheckinListOptions = {},
  ): Promise<Page<DailyCheckin>> {
    return this.repository.listPage<DailyCheckin>({
      table: "daily_checkins",
      sortColumn: "checkin_date",
      pageSize: options.pageSize,
      cursor: options.cursor,
    });
  }

  async create(
    key: string,
    input: CreateDailyCheckinInput,
  ): Promise<DailyCheckin> {
    const checkinDate = isoDate(input.date);
    const {
      date: _date,
      ...inputFields
    } = input;
    const fields = normalizeFields(inputFields, true);
    const rows = await this.repository.executeIdempotentWrite<
      DailyCheckin[]
    >(
      key,
      async () =>
        await this.client.rpc("create_daily_checkin", {
          p_idempotency_key: key,
          p_checkin_date: checkinDate,
          p_sleep_quality: fields.sleep_quality ?? null,
          p_energy: fields.energy ?? null,
          p_mood: fields.mood ?? null,
          p_life_feeling: fields.life_feeling ?? null,
          p_anchors: fields.anchors ?? null,
          p_notes: fields.notes ?? null,
        }) as SupabaseResult<DailyCheckin[]>,
    );
    const created = rows[0];
    if (!created) {
      throw new RepositoryError(
        "unknown",
        500,
        "empty_daily_checkin_result",
        "Daily check-in creation completed without a result",
      );
    }
    return created;
  }

  async update(
    id: number,
    expectedRevision: number,
    fields: DailyCheckinFields,
  ): Promise<DailyCheckin> {
    return await this.repository.updateWithRevision<DailyCheckin>(
      "daily_checkins",
      id,
      expectedRevision,
      normalizeFields(fields, false),
    );
  }
}
