import type { TodoItem, TodoPriority } from "../../domain/todos";

const priorityOrder: Record<TodoPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
};

function time(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

export function sortTodos(items: readonly TodoItem[]): TodoItem[] {
  return [...items].sort((left, right) =>
    priorityOrder[left.priority] - priorityOrder[right.priority]
    || time(left.due_at) - time(right.due_at)
    || time(left.created_at) - time(right.created_at)
    || left.id - right.id
  );
}

export function isOverdue(todo: TodoItem, now: Date): boolean {
  if (todo.status === "completed" || Number.isNaN(now.getTime())) return false;
  return time(todo.due_at) < now.getTime();
}

export function selectTodayTodos(
  items: readonly TodoItem[],
  now: Date,
): TodoItem[] {
  if (Number.isNaN(now.getTime())) return [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return sortTodos(items.filter((todo) => {
    if (todo.status !== "completed") {
      const plannedStartAt = time(todo.planned_start_at);
      return plannedStartAt >= start.getTime() && plannedStartAt < end.getTime();
    }
    const completedAt = todo.completed_at ? time(todo.completed_at) : Number.NaN;
    return completedAt >= start.getTime() && completedAt < end.getTime();
  }));
}
