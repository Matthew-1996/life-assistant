import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CreateTodoInput,
  DeleteTodoInput,
  TodoItem,
  TodoPriority,
  TodoRepositoryPort,
  TodoStatus,
  TodoStatusEvent,
  TransitionTodoInput,
  UpdateTodoInput,
} from "../domain/todos";
import {
  LifeConsoleRepository,
  RepositoryError,
  type SupabaseResult,
} from "./repository";

const priorities = new Set<TodoPriority>(["P0", "P1", "P2"]);
const statuses = new Set<TodoStatus>([
  "not_started",
  "in_progress",
  "completed",
]);

function invalid(message: string): RepositoryError {
  return new RepositoryError("validation", 400, "invalid_request", message);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalid(`${label} must be a positive integer`);
  }
  return value;
}

function title(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 240) {
    throw invalid("Todo title must contain 1 through 240 characters");
  }
  return normalized;
}

function priority(value: TodoPriority | undefined): TodoPriority {
  const normalized = value ?? "P1";
  if (!priorities.has(normalized)) throw invalid("Todo priority is invalid");
  return normalized;
}

function status(value: TodoStatus): TodoStatus {
  if (!statuses.has(value)) throw invalid("Todo status is invalid");
  return value;
}

function timestamp(value: string, label: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw invalid(`${label} must be an ISO timestamp`);
  }
  return value;
}

function requireResult<T>(rows: T[], code: string): T {
  const result = rows[0];
  if (!result) {
    throw new RepositoryError("unknown", 500, code, "Todo write returned no row");
  }
  return result;
}

function ordered(query: any) {
  return query
    .order("priority", { ascending: true })
    .order("due_at", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1000);
}

export class TodoRepository implements TodoRepositoryPort {
  private readonly repository: LifeConsoleRepository;

  constructor(
    private readonly client: SupabaseClient,
    repository?: LifeConsoleRepository,
  ) {
    this.repository = repository ?? new LifeConsoleRepository(client);
  }

  async listToday(now: Date): Promise<TodoItem[]> {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw invalid("Todo current time is invalid");
    }
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const filter = [
      `and(status.neq.completed,planned_start_at.lt.${end.toISOString()},due_at.gte.${start.toISOString()})`,
      `and(status.eq.completed,completed_at.gte.${start.toISOString()},completed_at.lt.${end.toISOString()})`,
    ].join(",");
    return await this.repository.executeRead<TodoItem[]>(async () =>
      await ordered(
        this.client.from("todo_items").select("*").is("deleted_at", null).or(filter),
      ) as SupabaseResult<TodoItem[]>
    ) ?? [];
  }

  async listAll(): Promise<TodoItem[]> {
    return await this.repository.executeRead<TodoItem[]>(async () =>
      await ordered(
        this.client.from("todo_items").select("*").is("deleted_at", null),
      ) as SupabaseResult<TodoItem[]>
    ) ?? [];
  }

  async listStatusEvents(todoId: number): Promise<TodoStatusEvent[]> {
    const id = positiveInteger(todoId, "Todo id");
    return await this.repository.executeRead<TodoStatusEvent[]>(async () =>
      await this.client
        .from("todo_status_events")
        .select("*")
        .eq("todo_id", id)
        .order("occurred_at", { ascending: true })
        .order("id", { ascending: true }) as SupabaseResult<TodoStatusEvent[]>
    ) ?? [];
  }

  async create(input: CreateTodoInput): Promise<TodoItem> {
    const normalizedTitle = title(input.title);
    const normalizedPriority = priority(input.priority);
    const plannedStartAt = input.plannedStartAt == null
      ? null
      : timestamp(input.plannedStartAt, "Todo planned start");
    const dueAt = timestamp(input.dueAt, "Todo DDL");
    if (plannedStartAt && Date.parse(dueAt) <= Date.parse(plannedStartAt)) {
      throw invalid("Todo DDL must follow planned start");
    }
    const rows = await this.repository.executeIdempotentWrite<TodoItem[]>(
      input.idempotencyKey,
      async () => await this.client.rpc("create_todo", {
        p_idempotency_key: input.idempotencyKey,
        p_title: normalizedTitle,
        p_priority: normalizedPriority,
        p_planned_start_at: plannedStartAt,
        p_due_at: dueAt,
      }) as SupabaseResult<TodoItem[]>,
    );
    return requireResult(rows, "empty_todo_create_result");
  }

  async update(input: UpdateTodoInput): Promise<TodoItem> {
    const id = positiveInteger(input.id, "Todo id");
    const revision = positiveInteger(input.expectedRevision, "Expected revision");
    const plannedStartAt = timestamp(input.plannedStartAt, "Todo planned start");
    const dueAt = timestamp(input.dueAt, "Todo DDL");
    if (Date.parse(dueAt) <= Date.parse(plannedStartAt)) {
      throw invalid("Todo DDL must follow planned start");
    }
    const rows = await this.repository.executeWrite<TodoItem[]>(async () =>
      await this.client.rpc("update_todo", {
        p_id: id,
        p_expected_revision: revision,
        p_title: title(input.title),
        p_priority: priority(input.priority),
        p_planned_start_at: plannedStartAt,
        p_due_at: dueAt,
      }) as SupabaseResult<TodoItem[]>
    );
    return requireResult(rows, "empty_todo_update_result");
  }

  async transition(input: TransitionTodoInput): Promise<TodoItem> {
    const rows = await this.repository.executeWrite<TodoItem[]>(async () =>
      await this.client.rpc("transition_todo", {
        p_id: positiveInteger(input.id, "Todo id"),
        p_expected_revision: positiveInteger(input.expectedRevision, "Expected revision"),
        p_status: status(input.status),
      }) as SupabaseResult<TodoItem[]>
    );
    return requireResult(rows, "empty_todo_transition_result");
  }

  async delete(input: DeleteTodoInput): Promise<TodoItem> {
    const rows = await this.repository.executeWrite<TodoItem[]>(async () =>
      await this.client.rpc("soft_delete_todo", {
        p_id: positiveInteger(input.id, "Todo id"),
        p_expected_revision: positiveInteger(
          input.expectedRevision,
          "Expected revision",
        ),
      }) as SupabaseResult<TodoItem[]>
    );
    return requireResult(rows, "empty_todo_delete_result");
  }
}
