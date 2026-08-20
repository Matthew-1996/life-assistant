import type { TodoItem } from "../../domain/todos";

function startOfDay(value: Date): Date {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function dayDifference(value: Date, origin: Date): number {
  const normalized = startOfDay(value);
  return Math.round((normalized.getTime() - origin.getTime()) / 86_400_000);
}

function dayLabel(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
  }).format(value);
}

interface TodoGanttProps {
  now: Date;
  todos: readonly TodoItem[];
}

export function TodoGantt({ now, todos }: TodoGanttProps) {
  const start = startOfDay(now);
  const days = Array.from({ length: 14 }, (_, index) => addDays(start, index));

  return (
    <section aria-label="Todo 14 天甘特" className="todo-gantt" role="region">
      <div className="todo-gantt__heading">
        <strong>未来 14 天</strong>
        <span>甘特区域可独立横向滚动</span>
      </div>
      <div className="todo-gantt__scroll" tabIndex={0}>
        <div className="todo-gantt__grid todo-gantt__header" role="row">
          {days.map((day) => (
            <span key={day.toISOString()} role="columnheader">
              {dayLabel(day)}
            </span>
          ))}
        </div>
        {todos.length === 0 ? (
          <p className="todo-gantt__empty">创建 Todo 后在这里查看计划跨度。</p>
        ) : todos.map((todo) => {
          const planned = new Date(todo.planned_start_at);
          const due = new Date(todo.due_at);
          const rawStart = dayDifference(planned, start);
          const rawEnd = dayDifference(due, start) + 1;
          const barStart = Math.max(0, Math.min(13, rawStart));
          const barEnd = Math.max(barStart + 1, Math.min(14, rawEnd));
          const outside = rawEnd <= 0 || rawStart >= 14;
          return (
            <div className="todo-gantt__row" key={todo.id}>
              <span className="todo-gantt__row-title">{todo.title}</span>
              <div className="todo-gantt__grid todo-gantt__track">
                {!outside && (
                  <span
                    aria-label={`${todo.title}：第 ${barStart + 1} 天至第 ${barEnd} 天`}
                    className={`todo-gantt__bar todo-gantt__bar--${todo.status}`}
                    style={{ gridColumn: `${barStart + 1} / ${barEnd + 1}` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
