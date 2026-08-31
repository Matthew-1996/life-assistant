// @vitest-environment node

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { DailyNewsClient, DailyNewsResult } from "../../src/domain/daily-news";
import type { TodoItem } from "../../src/domain/todos";
import {
  DashboardMessageRepository,
} from "../../src/supabase/dashboard-messages";
import { HealthRepository } from "../../src/supabase/health";
import { JournalRepository } from "../../src/supabase/journals";
import { ReviewRepository } from "../../src/supabase/reviews";
import { TodoRepository } from "../../src/supabase/todos";

interface SyntheticResponse {
  status: number;
  body: unknown;
}

function syntheticClient(responses: SyntheticResponse[]) {
  const requests: Request[] = [];
  const syntheticFetch: typeof fetch = async (input, init) => {
    requests.push(new Request(input, init));
    const response = responses.shift();
    if (!response) throw new Error("Missing synthetic response");
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    client: createClient(
      "https://synthetic.supabase.invalid",
      "public-test-key",
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
        db: { retry: false },
        global: { fetch: syntheticFetch },
      },
    ),
    requests,
  };
}

const todo: TodoItem = {
  id: 71,
  user_id: "synthetic-owner",
  title: "Synthetic Todo",
  priority: "P1",
  status: "not_started",
  planned_start_at: "2030-05-01T01:00:00.000Z",
  due_at: "2030-05-02T01:00:00.000Z",
  actual_started_at: null,
  completed_at: null,
  deleted_at: null,
  revision: 1,
  created_at: "2030-05-01T00:00:00.000Z",
  updated_at: "2030-05-01T00:00:00.000Z",
};

describe("Life Console 2.5.0 repositories", () => {
  it("queries unfinished Todos whose planned-to-due dates cover the local day", async () => {
    const { client, requests } = syntheticClient([{ status: 200, body: [] }]);

    await new TodoRepository(client).listToday(new Date("2030-05-01T12:00:00.000Z"));

    const filter = new URL(requests[0].url).searchParams.get("or");
    expect(filter).toContain("planned_start_at.lt.2030-05-01T16:00:00.000Z");
    expect(filter).toContain("due_at.gte.2030-04-30T16:00:00.000Z");
    expect(filter).not.toContain("planned_start_at.gte.2030-04-30T16:00:00.000Z");
  });

  it("maps Todo reads and all four write RPCs without client-authored status time", async () => {
    const updated = { ...todo, title: "Updated Todo", revision: 2 };
    const completed = {
      ...updated,
      status: "completed" as const,
      actual_started_at: "2030-05-01T08:00:00.000Z",
      completed_at: "2030-05-01T08:00:00.000Z",
      revision: 3,
    };
    const { client, requests } = syntheticClient([
      { status: 200, body: [todo] },
      { status: 200, body: [todo] },
      { status: 200, body: [todo] },
      { status: 200, body: [todo] },
      { status: 200, body: [updated] },
      { status: 200, body: [completed] },
      { status: 200, body: [{ ...completed, revision: 4, deleted_at: "2030-05-01T09:00:00.000Z" }] },
    ]);
    const repository = new TodoRepository(client);

    await repository.listToday(new Date("2030-05-01T12:00:00.000Z"));
    await repository.listAll();
    await repository.listStatusEvents(todo.id);
    await expect(repository.create({
      idempotencyKey: "synthetic-todo-key-0001",
      title: "  Synthetic Todo  ",
      dueAt: todo.due_at,
    })).resolves.toEqual(todo);
    await expect(repository.update({
      id: todo.id,
      expectedRevision: 1,
      title: " Updated Todo ",
      priority: "P2",
      plannedStartAt: todo.planned_start_at,
      dueAt: todo.due_at,
    })).resolves.toEqual(updated);
    await expect(repository.transition({
      id: todo.id,
      expectedRevision: 2,
      status: "completed",
    })).resolves.toEqual(completed);
    await expect(repository.delete({
      id: todo.id,
      expectedRevision: 3,
    })).resolves.toMatchObject({ deleted_at: "2030-05-01T09:00:00.000Z" });

    const todayUrl = new URL(requests[0].url);
    expect(todayUrl.pathname).toBe("/rest/v1/todo_items");
    expect(todayUrl.searchParams.get("or")).toContain("planned_start_at.lt.2030-05-01T16:00:00.000Z");
    expect(todayUrl.searchParams.get("or")).toContain("due_at.gte.2030-04-30T16:00:00.000Z");
    expect(todayUrl.searchParams.get("or")).not.toContain("planned_start_at.gte.");
    expect(todayUrl.searchParams.get("or")).toContain("completed_at.gte.2030-04-30T16:00:00.000Z");
    expect(todayUrl.searchParams.get("or")).toContain("completed_at.lt.2030-05-01T16:00:00.000Z");
    expect(todayUrl.searchParams.get("deleted_at")).toBe("is.null");
    expect(new URL(requests[1].url).searchParams.get("order")).toBe(
      "priority.asc,due_at.asc,created_at.asc,id.asc",
    );
    expect(new URL(requests[1].url).searchParams.get("deleted_at")).toBe("is.null");
    expect(new URL(requests[2].url).searchParams.get("todo_id")).toBe("eq.71");
    expect(JSON.parse(await requests[3].text())).toEqual({
      p_due_at: todo.due_at,
      p_idempotency_key: "synthetic-todo-key-0001",
      p_planned_start_at: null,
      p_priority: "P1",
      p_title: "Synthetic Todo",
    });
    expect(JSON.parse(await requests[4].text())).toEqual({
      p_due_at: todo.due_at,
      p_expected_revision: 1,
      p_id: 71,
      p_planned_start_at: todo.planned_start_at,
      p_priority: "P2",
      p_title: "Updated Todo",
    });
    const transitionBody = await requests[5].text();
    expect(JSON.parse(transitionBody)).toEqual({
      p_expected_revision: 2,
      p_id: 71,
      p_status: "completed",
    });
    expect(transitionBody).not.toContain("actual_started_at");
    expect(transitionBody).not.toContain("completed_at");
    expect(new URL(requests[6].url).pathname).toBe("/rest/v1/rpc/soft_delete_todo");
    expect(JSON.parse(await requests[6].text())).toEqual({
      p_expected_revision: 3,
      p_id: 71,
    });
  });

  it("fails Todo input closed and maps SQL revision conflicts", async () => {
    const invalid = syntheticClient([]);
    const repository = new TodoRepository(invalid.client);
    await expect(repository.create({
      idempotencyKey: "synthetic-todo-key-0002",
      title: " ",
      dueAt: todo.due_at,
    })).rejects.toMatchObject({ kind: "validation", status: 400 });
    expect(invalid.requests).toHaveLength(0);

    const conflict = syntheticClient([{
      status: 400,
      body: { code: "40001", message: "Todo revision changed" },
    }]);
    await expect(new TodoRepository(conflict.client).transition({
      id: todo.id,
      expectedRevision: 1,
      status: "in_progress",
    })).rejects.toMatchObject({ kind: "conflict", status: 409, code: "40001" });
  });

  it("reads and revision-upserts only the requested weekly dashboard message", async () => {
    const message = {
      id: 81,
      user_id: "synthetic-owner",
      week_start: "2030-04-29",
      message: "Synthetic weekly message",
      quote_source: null,
      image_url: null,
      image_author_name: null,
      image_author_url: null,
      image_platform_url: null,
      fallback_theme: "dawn",
      generated_at: "2030-05-01T00:00:00.000Z",
      revision: 1,
      created_at: "2030-05-01T00:00:00.000Z",
      updated_at: "2030-05-01T00:00:00.000Z",
    };
    const { client, requests } = syntheticClient([
      { status: 200, body: [message] },
      { status: 200, body: [message] },
    ]);
    const repository = new DashboardMessageRepository(client);

    await expect(repository.getCurrentWeek("2030-04-29")).resolves.toEqual(message);
    await expect(repository.upsert({
      idempotencyKey: "synthetic-message-key-0001",
      weekStart: "2030-04-29",
      expectedRevision: null,
      message: "Synthetic weekly message",
      quoteSource: null,
      imageMetadata: {},
      fallbackTheme: "dawn",
    })).resolves.toEqual(message);

    expect(new URL(requests[0].url).searchParams.get("week_start")).toBe("eq.2030-04-29");
    expect(new URL(requests[1].url).pathname).toBe(
      "/rest/v1/rpc/upsert_dashboard_message",
    );
  });

  it("reads bounded health metrics and sleep timings in ascending date order", async () => {
    const { client, requests } = syntheticClient([
      { status: 200, body: [{ id: 91, health_date: "2030-05-01", summary: {} }] },
      { status: 200, body: [{ id: 92, checkin_date: "2030-05-01", sleep_time: "23:30" }] },
    ]);
    const repository = new HealthRepository(client);

    await repository.listDailyMetrics("2030-04-18", "2030-05-01");
    await repository.listSleepTimings("2030-04-18", "2030-05-01");

    const metrics = new URL(requests[0].url);
    expect(metrics.pathname).toBe("/rest/v1/health_days");
    expect(metrics.searchParams.get("health_date")).toEqual("gte.2030-04-18");
    expect(metrics.searchParams.get("order")).toBe("health_date.asc,id.asc");
    const sleep = new URL(requests[1].url);
    expect(sleep.pathname).toBe("/rest/v1/daily_checkins");
    expect(sleep.searchParams.get("checkin_date")).toEqual("gte.2030-04-18");
    expect(sleep.searchParams.get("select")).toContain("sleep_time");
  });

  it("separates deleted journals and uses only soft-delete and restore RPCs", async () => {
    const deleted = { ...todo, id: 101, deleted_at: "2030-05-01T00:00:00.000Z" };
    const restored = { ...deleted, deleted_at: null, revision: 3 };
    const { client, requests } = syntheticClient([
      { status: 200, body: [deleted] },
      { status: 200, body: [deleted] },
      { status: 200, body: [restored] },
    ]);
    const repository = new JournalRepository(client);

    await repository.listDeleted({ pageSize: 20 });
    await expect(repository.softDelete(101, 1)).resolves.toEqual(deleted);
    await expect(repository.restore(101, 2)).resolves.toEqual(restored);

    expect(new URL(requests[0].url).searchParams.get("deleted_at")).toBe("not.is.null");
    expect(new URL(requests[1].url).pathname).toBe("/rest/v1/rpc/soft_delete_journal");
    expect(new URL(requests[2].url).pathname).toBe("/rest/v1/rpc/restore_journal");
  });

  it("preserves review structured_data and defines a discriminated news client", async () => {
    const weekly = {
      id: 111,
      user_id: "synthetic-owner",
      week_start: "2030-04-29",
      content: "Synthetic review",
      structured_data: { summary: "Structured synthetic summary" },
      revision: 1,
      deleted_at: null,
      created_at: "2030-05-01T00:00:00.000Z",
      updated_at: "2030-05-01T00:00:00.000Z",
    };
    const { client } = syntheticClient([{ status: 200, body: [weekly] }]);
    const page = await new ReviewRepository(client).listWeekly();
    expect(page.items[0].structured_data).toEqual(weekly.structured_data);

    const result: DailyNewsResult = { state: "empty", retryable: true };
    const newsClient: DailyNewsClient = {
      getDigest: async () => result,
    };
    await expect(newsClient.getDigest({ allowRebuild: false })).resolves.toEqual(result);
  });
});
