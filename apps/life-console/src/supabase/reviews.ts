import type { SupabaseClient } from "@supabase/supabase-js";

import {
  LifeConsoleRepository,
  RepositoryError,
  type Cursor,
  type Page,
  type SupabaseResult,
} from "./repository";

interface ReviewBase {
  id: number;
  user_id: string;
  content: string;
  structured_data: Record<string, unknown>;
  revision: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeeklyReview extends ReviewBase {
  week_start: string;
}

export interface PhaseReview extends ReviewBase {
  period_start: string;
  period_end: string;
}

export interface ReviewListOptions {
  pageSize?: number;
  cursor?: Cursor;
}

export interface CreateWeeklyReviewInput {
  weekStart: string;
  content: string;
}

export interface UpdateWeeklyReviewInput {
  weekStart?: string;
  content?: string;
}

export interface CreatePhaseReviewInput {
  periodStart: string;
  periodEnd: string;
  content: string;
}

export interface UpdatePhaseReviewInput {
  periodStart?: string;
  periodEnd?: string;
  content?: string;
}

export interface ReviewRepositoryPort {
  listWeekly(options?: ReviewListOptions): Promise<Page<WeeklyReview>>;
  listPhases(options?: ReviewListOptions): Promise<Page<PhaseReview>>;
  createWeekly(
    key: string,
    input: CreateWeeklyReviewInput,
  ): Promise<WeeklyReview>;
  createPhase(
    key: string,
    input: CreatePhaseReviewInput,
  ): Promise<PhaseReview>;
  updateWeekly(
    id: number,
    expectedRevision: number,
    input: UpdateWeeklyReviewInput,
  ): Promise<WeeklyReview>;
  updatePhase(
    id: number,
    expectedRevision: number,
    input: UpdatePhaseReviewInput,
  ): Promise<PhaseReview>;
}

function invalid(message: string): RepositoryError {
  return new RepositoryError("validation", 400, "invalid_request", message);
}

function isoDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalid(`${label} must be an ISO date`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw invalid(`${label} must be an ISO date`);
  }
  return value;
}

function content(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid("Review content cannot be empty");
  }
  return value;
}

function phaseDates(start: string, end: string): void {
  if (end < start) {
    throw invalid("Phase end date cannot precede its start date");
  }
}

function weeklyPatch(
  input: UpdateWeeklyReviewInput,
): Record<string, unknown> {
  if (Object.keys(input).length === 0) {
    throw invalid("Weekly review update requires at least one field");
  }
  const patch: Record<string, unknown> = {};
  if (input.weekStart !== undefined) {
    patch.week_start = isoDate(input.weekStart, "Week start");
  }
  if (input.content !== undefined) {
    patch.content = content(input.content);
  }
  return patch;
}

function phasePatch(
  input: UpdatePhaseReviewInput,
): Record<string, unknown> {
  if (Object.keys(input).length === 0) {
    throw invalid("Phase review update requires at least one field");
  }
  const patch: Record<string, unknown> = {};
  if (input.periodStart !== undefined) {
    patch.period_start = isoDate(input.periodStart, "Phase start");
  }
  if (input.periodEnd !== undefined) {
    patch.period_end = isoDate(input.periodEnd, "Phase end");
  }
  if (input.periodStart !== undefined && input.periodEnd !== undefined) {
    phaseDates(
      patch.period_start as string,
      patch.period_end as string,
    );
  }
  if (input.content !== undefined) {
    patch.content = content(input.content);
  }
  return patch;
}

export class ReviewRepository implements ReviewRepositoryPort {
  private readonly repository: LifeConsoleRepository;

  constructor(
    private readonly client: SupabaseClient,
    repository?: LifeConsoleRepository,
  ) {
    this.repository = repository ?? new LifeConsoleRepository(client);
  }

  listWeekly(
    options: ReviewListOptions = {},
  ): Promise<Page<WeeklyReview>> {
    return this.repository.listPage<WeeklyReview>({
      table: "weekly_reviews",
      sortColumn: "week_start",
      pageSize: options.pageSize,
      cursor: options.cursor,
    });
  }

  listPhases(
    options: ReviewListOptions = {},
  ): Promise<Page<PhaseReview>> {
    return this.repository.listPage<PhaseReview>({
      table: "phase_reviews",
      sortColumn: "period_start",
      pageSize: options.pageSize,
      cursor: options.cursor,
    });
  }

  async createWeekly(
    key: string,
    input: CreateWeeklyReviewInput,
  ): Promise<WeeklyReview> {
    const rows = await this.repository.executeIdempotentWrite<
      WeeklyReview[]
    >(
      key,
      async () =>
        await this.client.rpc("create_weekly_review", {
          p_idempotency_key: key,
          p_week_start: isoDate(input.weekStart, "Week start"),
          p_content: content(input.content),
        }) as SupabaseResult<WeeklyReview[]>,
    );
    const created = rows[0];
    if (!created) {
      throw new RepositoryError(
        "unknown",
        500,
        "empty_weekly_review_result",
        "Weekly review creation completed without a result",
      );
    }
    return created;
  }

  async createPhase(
    key: string,
    input: CreatePhaseReviewInput,
  ): Promise<PhaseReview> {
    const periodStart = isoDate(input.periodStart, "Phase start");
    const periodEnd = isoDate(input.periodEnd, "Phase end");
    phaseDates(periodStart, periodEnd);
    const rows = await this.repository.executeIdempotentWrite<
      PhaseReview[]
    >(
      key,
      async () =>
        await this.client.rpc("create_phase_review", {
          p_idempotency_key: key,
          p_period_start: periodStart,
          p_period_end: periodEnd,
          p_content: content(input.content),
        }) as SupabaseResult<PhaseReview[]>,
    );
    const created = rows[0];
    if (!created) {
      throw new RepositoryError(
        "unknown",
        500,
        "empty_phase_review_result",
        "Phase review creation completed without a result",
      );
    }
    return created;
  }

  async updateWeekly(
    id: number,
    expectedRevision: number,
    input: UpdateWeeklyReviewInput,
  ): Promise<WeeklyReview> {
    return await this.repository.updateWithRevision<WeeklyReview>(
      "weekly_reviews",
      id,
      expectedRevision,
      weeklyPatch(input),
    );
  }

  async updatePhase(
    id: number,
    expectedRevision: number,
    input: UpdatePhaseReviewInput,
  ): Promise<PhaseReview> {
    return await this.repository.updateWithRevision<PhaseReview>(
      "phase_reviews",
      id,
      expectedRevision,
      phasePatch(input),
    );
  }
}
