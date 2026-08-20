export type TodoPriority = "P0" | "P1" | "P2";
export type TodoStatus = "not_started" | "in_progress" | "completed";

export interface TodoItem {
  id: number;
  user_id: string;
  title: string;
  priority: TodoPriority;
  status: TodoStatus;
  planned_start_at: string;
  due_at: string;
  actual_started_at: string | null;
  completed_at: string | null;
  deleted_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface TodoStatusEvent {
  id: number;
  user_id: string;
  todo_id: number;
  from_status: TodoStatus;
  to_status: TodoStatus;
  todo_revision: number;
  occurred_at: string;
}

export interface CreateTodoInput {
  idempotencyKey: string;
  title: string;
  priority?: TodoPriority;
  plannedStartAt?: string | null;
  dueAt: string;
}

export interface UpdateTodoInput {
  id: number;
  expectedRevision: number;
  title: string;
  priority: TodoPriority;
  plannedStartAt: string;
  dueAt: string;
}

export interface TransitionTodoInput {
  id: number;
  expectedRevision: number;
  status: TodoStatus;
}

export interface DeleteTodoInput {
  id: number;
  expectedRevision: number;
}

export interface TodoRepositoryPort {
  listToday(now: Date): Promise<TodoItem[]>;
  listAll(): Promise<TodoItem[]>;
  create(input: CreateTodoInput): Promise<TodoItem>;
  delete(input: DeleteTodoInput): Promise<TodoItem>;
  update(input: UpdateTodoInput): Promise<TodoItem>;
  transition(input: TransitionTodoInput): Promise<TodoItem>;
  listStatusEvents(todoId: number): Promise<TodoStatusEvent[]>;
}
