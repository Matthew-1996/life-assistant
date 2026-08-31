import type {
  CreateTodoInput,
  DeleteTodoInput,
  TodoItem,
  TodoRepositoryPort,
  TodoStatus,
  TodoStatusEvent,
  TransitionTodoInput,
  UpdateTodoInput,
} from "../../domain/todos";
import { selectTodayTodos, sortTodos } from "./todo-projections";

const syntheticUserId = "synthetic-preview";

function shifted(now: Date, hours: number): string {
  return new Date(now.getTime() + hours * 60 * 60 * 1_000).toISOString();
}

function laterToday(now: Date): string {
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  return new Date(now.getTime() + Math.floor((end.getTime() - now.getTime()) / 2))
    .toISOString();
}

function cloneTodo(todo: TodoItem): TodoItem {
  return { ...todo };
}

function unavailable(): Error {
  return new Error("Candidate Todo persistent writes are not available");
}

function missing(): Error {
  return new Error("Candidate Todo was not found");
}

function conflict(): Error {
  return new Error("Candidate Todo revision changed");
}

function syntheticTodos(now: Date): TodoItem[] {
  return [
    {
      id: 1,
      user_id: syntheticUserId,
      title: "整理旅行清单",
      priority: "P1",
      status: "not_started",
      planned_start_at: shifted(now, -26),
      due_at: shifted(now, 48),
      actual_started_at: null,
      completed_at: null,
      deleted_at: null,
      revision: 1,
      created_at: shifted(now, -72),
      updated_at: shifted(now, -72),
    },
    {
      id: 2,
      user_id: syntheticUserId,
      title: "准备本周采购",
      priority: "P0",
      status: "not_started",
      planned_start_at: laterToday(now),
      due_at: shifted(now, 24),
      actual_started_at: null,
      completed_at: null,
      deleted_at: null,
      revision: 1,
      created_at: shifted(now, -96),
      updated_at: shifted(now, -96),
    },
    {
      id: 3,
      user_id: syntheticUserId,
      title: "完成房间整理",
      priority: "P2",
      status: "completed",
      planned_start_at: shifted(now, -48),
      due_at: shifted(now, -24),
      actual_started_at: shifted(now, -36),
      completed_at: shifted(now, 0),
      deleted_at: null,
      revision: 3,
      created_at: shifted(now, -120),
      updated_at: shifted(now, 0),
    },
  ];
}

export function createCandidateTodoRepository(
  now = new Date(),
): TodoRepositoryPort {
  const items = syntheticTodos(now);
  const events: TodoStatusEvent[] = [];

  function current(id: number): TodoItem {
    const todo = items.find((item) => item.id === id && item.deleted_at === null);
    if (!todo) throw missing();
    return todo;
  }

  function replace(next: TodoItem): TodoItem {
    const index = items.findIndex((item) => item.id === next.id);
    if (index < 0) throw missing();
    items[index] = next;
    return cloneTodo(next);
  }

  return {
    async listToday(requestNow: Date) {
      return selectTodayTodos(items.filter((item) => item.deleted_at === null), requestNow)
        .map(cloneTodo);
    },
    async listAll() {
      return sortTodos(items.filter((item) => item.deleted_at === null)).map(cloneTodo);
    },
    async create(_input: CreateTodoInput) {
      throw unavailable();
    },
    async delete(_input: DeleteTodoInput) {
      throw unavailable();
    },
    async update(_input: UpdateTodoInput) {
      throw unavailable();
    },
    async transition(input: TransitionTodoInput) {
      const todo = current(input.id);
      if (todo.revision !== input.expectedRevision) throw conflict();
      if (todo.status === input.status) return cloneTodo(todo);

      const changedAt = new Date().toISOString();
      const fromStatus = todo.status;
      const next = replace({
        ...todo,
        status: input.status,
        actual_started_at: input.status === "not_started"
          ? null
          : todo.actual_started_at ?? changedAt,
        completed_at: input.status === "completed" ? changedAt : null,
        revision: todo.revision + 1,
        updated_at: changedAt,
      });
      events.push({
        id: events.length + 1,
        user_id: syntheticUserId,
        todo_id: todo.id,
        from_status: fromStatus,
        to_status: input.status as TodoStatus,
        todo_revision: next.revision,
        occurred_at: changedAt,
      });
      return next;
    },
    async listStatusEvents(todoId: number) {
      return events.filter((event) => event.todo_id === todoId).map((event) => ({ ...event }));
    },
  };
}
