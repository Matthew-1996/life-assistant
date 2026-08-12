import type { SupabaseClient } from "@supabase/supabase-js";

import {
  LifeConsoleRepository,
  RepositoryError,
  type Cursor,
  type Page,
  type SupabaseResult,
} from "./repository";

export type GoalStatus = "draft" | "active" | "completed" | "archived";

export interface Goal {
  id: number;
  user_id: string;
  title: string;
  domain: string | null;
  status: GoalStatus;
  priority: number | null;
  start_date: string | null;
  target_date: string | null;
  revision: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateGoalInput {
  title: string;
  domain?: string | null;
  status: GoalStatus;
  priority?: number | null;
  startDate?: string | null;
  targetDate?: string | null;
}

export interface UpdateGoalInput {
  title?: string;
  domain?: string | null;
  status?: GoalStatus;
  priority?: number | null;
  startDate?: string | null;
  targetDate?: string | null;
}

export interface GoalListOptions {
  pageSize?: number;
  cursor?: Cursor;
}

export interface GoalRepositoryPort {
  list(options?: GoalListOptions): Promise<Page<Goal>>;
  create(key: string, input: CreateGoalInput): Promise<Goal>;
  update(
    id: number,
    expectedRevision: number,
    input: UpdateGoalInput,
  ): Promise<Goal>;
  archive(
    id: number,
    expectedRevision: number,
    deletedAt?: string,
  ): Promise<Goal>;
  restore(id: number, expectedRevision: number): Promise<Goal>;
}

const goalStatuses = new Set<GoalStatus>([
  "draft",
  "active",
  "completed",
  "archived",
]);

function invalid(message: string): RepositoryError {
  return new RepositoryError("validation", 400, "invalid_request", message);
}

function title(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 200) {
    throw invalid("Goal title must contain 1 through 200 characters");
  }
  return normalized;
}

function domain(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized || null;
}

function status(value: GoalStatus): GoalStatus {
  if (!goalStatuses.has(value)) {
    throw invalid("Goal status is invalid");
  }
  return value;
}

function priority(
  value: number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value > 9) {
    throw invalid("Goal priority must be an integer from 0 through 9");
  }
  return value;
}

function date(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value === null || value === undefined) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    throw invalid(`${label} must be an ISO date`);
  }
  return value;
}

function validateDateOrder(
  startDate: string | null,
  targetDate: string | null,
): void {
  if (startDate && targetDate && targetDate < startDate) {
    throw invalid("Goal target date cannot precede its start date");
  }
}

function timestamp(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw invalid("Goal archive timestamp must be an ISO timestamp");
  }
  return value;
}

function normalizeCreate(input: CreateGoalInput) {
  const startDate = date(input.startDate, "Goal start date");
  const targetDate = date(input.targetDate, "Goal target date");
  validateDateOrder(startDate, targetDate);
  return {
    title: title(input.title),
    domain: domain(input.domain),
    status: status(input.status),
    priority: priority(input.priority),
    startDate,
    targetDate,
  };
}

function normalizeUpdate(
  input: UpdateGoalInput,
): Record<string, unknown> {
  const fields = Object.keys(input);
  if (fields.length === 0) {
    throw invalid("Goal update must contain at least one field");
  }

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = title(input.title);
  if (input.domain !== undefined) patch.domain = domain(input.domain);
  if (input.status !== undefined) patch.status = status(input.status);
  if (input.priority !== undefined) {
    patch.priority = priority(input.priority);
  }
  if (input.startDate !== undefined) {
    patch.start_date = date(input.startDate, "Goal start date");
  }
  if (input.targetDate !== undefined) {
    patch.target_date = date(input.targetDate, "Goal target date");
  }
  if (
    "start_date" in patch
    && "target_date" in patch
  ) {
    validateDateOrder(
      patch.start_date as string | null,
      patch.target_date as string | null,
    );
  }
  return patch;
}

export class GoalRepository implements GoalRepositoryPort {
  private readonly repository: LifeConsoleRepository;

  constructor(
    private readonly client: SupabaseClient,
    repository?: LifeConsoleRepository,
  ) {
    this.repository = repository ?? new LifeConsoleRepository(client);
  }

  list(options: GoalListOptions = {}): Promise<Page<Goal>> {
    return this.repository.listPage<Goal>({
      table: "goals",
      sortColumn: "created_at",
      excludeDeleted: true,
      pageSize: options.pageSize,
      cursor: options.cursor,
    });
  }

  async create(
    key: string,
    input: CreateGoalInput,
  ): Promise<Goal> {
    const normalized = normalizeCreate(input);
    const rows = await this.repository.executeIdempotentWrite<Goal[]>(
      key,
      async () =>
        await this.client.rpc("create_goal", {
          p_idempotency_key: key,
          p_title: normalized.title,
          p_domain: normalized.domain,
          p_status: normalized.status,
          p_priority: normalized.priority,
          p_start_date: normalized.startDate,
          p_target_date: normalized.targetDate,
        }) as SupabaseResult<Goal[]>,
    );
    const created = rows[0];
    if (!created) {
      throw new RepositoryError(
        "unknown",
        500,
        "empty_goal_result",
        "Goal creation completed without a result",
      );
    }
    return created;
  }

  async update(
    id: number,
    expectedRevision: number,
    input: UpdateGoalInput,
  ): Promise<Goal> {
    return await this.repository.updateWithRevision<Goal>(
      "goals",
      id,
      expectedRevision,
      normalizeUpdate(input),
    );
  }

  async archive(
    id: number,
    expectedRevision: number,
    deletedAt = new Date().toISOString(),
  ): Promise<Goal> {
    return await this.repository.updateWithRevision<Goal>(
      "goals",
      id,
      expectedRevision,
      {
        status: "archived",
        deleted_at: timestamp(deletedAt),
      },
    );
  }

  async restore(
    id: number,
    expectedRevision: number,
  ): Promise<Goal> {
    return await this.repository.updateWithRevision<Goal>(
      "goals",
      id,
      expectedRevision,
      {
        status: "active",
        deleted_at: null,
      },
    );
  }
}
