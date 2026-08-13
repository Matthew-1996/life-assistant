// @vitest-environment node

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  LifeConsoleRepository,
  RepositoryError,
} from "../../src/supabase/repository";

interface SyntheticResponse {
  status: number;
  body: unknown;
}

function createRepository(responses: Array<SyntheticResponse | Error>) {
  const requests: Request[] = [];
  const syntheticFetch: typeof fetch = async (input, init) => {
    requests.push(new Request(input, init));
    const response = responses.shift();
    if (!response) throw new Error("Missing synthetic response");
    if (response instanceof Error) throw response;
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createClient(
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
  );
  return {
    repository: new LifeConsoleRepository(client),
    requests,
  };
}

describe("Life Console Supabase Repository", () => {
  it("uses a bounded event-date cursor and returns the next composite cursor", async () => {
    const rows = [
      { id: 9, event_date: "2026-08-12", title: "A" },
      { id: 8, event_date: "2026-08-11", title: "B" },
      { id: 7, event_date: "2026-08-11", title: "C" },
    ];
    const { repository, requests } = createRepository([
      { status: 200, body: rows },
    ]);

    const page = await repository.listPage<typeof rows[number]>({
      table: "journals",
      sortColumn: "event_date",
      pageSize: 2,
    });

    expect(page).toEqual({
      items: rows.slice(0, 2),
      nextCursor: { sortValue: "2026-08-11", id: 8 },
    });
    const url = new URL(requests[0].url);
    expect(url.pathname).toBe("/rest/v1/journals");
    expect(url.searchParams.get("select")).toBe("*");
    expect(url.searchParams.get("order")).toBe(
      "event_date.desc,id.desc",
    );
    expect(url.searchParams.get("limit")).toBe("3");
  });

  it("builds the approved descending composite cursor filter", async () => {
    const { repository, requests } = createRepository([
      { status: 200, body: [] },
    ]);

    await repository.listPage({
      table: "audit_events",
      sortColumn: "created_at",
      pageSize: 20,
      cursor: {
        sortValue: "2026-08-12T08:30:00.000Z",
        id: 42,
      },
    });

    const url = new URL(requests[0].url);
    expect(url.searchParams.get("or")).toBe(
      "(created_at.lt.2026-08-12T08:30:00.000Z,and(created_at.eq.2026-08-12T08:30:00.000Z,id.lt.42))",
    );
  });

  it("uses the fixed active-goal predicate for goal pages", async () => {
    const { repository, requests } = createRepository([
      { status: 200, body: [] },
    ]);

    await repository.listPage({
      table: "goals",
      sortColumn: "created_at",
      excludeDeleted: true,
      pageSize: 20,
    });

    const url = new URL(requests[0].url);
    expect(url.pathname).toBe("/rest/v1/goals");
    expect(url.searchParams.get("deleted_at")).toBe("is.null");
    expect(url.searchParams.get("order")).toBe(
      "created_at.desc,id.desc",
    );
  });

  it("supports approved daily check-in date cursors", async () => {
    const { repository, requests } = createRepository([
      { status: 200, body: [] },
    ]);

    await repository.listPage({
      table: "daily_checkins",
      sortColumn: "checkin_date",
      pageSize: 7,
      cursor: { sortValue: "2030-02-01", id: 12 },
    });

    const url = new URL(requests[0].url);
    expect(url.pathname).toBe("/rest/v1/daily_checkins");
    expect(url.searchParams.get("order")).toBe(
      "checkin_date.desc,id.desc",
    );
    expect(url.searchParams.get("or")).toBe(
      "(checkin_date.lt.2030-02-01,and(checkin_date.eq.2030-02-01,id.lt.12))",
    );
  });

  it("uses fixed active review date cursors", async () => {
    const { repository, requests } = createRepository([
      { status: 200, body: [] },
      { status: 200, body: [] },
    ]);

    await repository.listPage({
      table: "weekly_reviews",
      sortColumn: "week_start",
      cursor: { sortValue: "2030-04-01", id: 7 },
    });
    await repository.listPage({
      table: "phase_reviews",
      sortColumn: "period_start",
      cursor: { sortValue: "2030-04-01", id: 8 },
    });

    const weeklyUrl = new URL(requests[0].url);
    expect(weeklyUrl.searchParams.get("deleted_at")).toBe("is.null");
    expect(weeklyUrl.searchParams.get("or")).toBe(
      "(week_start.lt.2030-04-01,and(week_start.eq.2030-04-01,id.lt.7))",
    );
    const phaseUrl = new URL(requests[1].url);
    expect(phaseUrl.searchParams.get("deleted_at")).toBe("is.null");
    expect(phaseUrl.searchParams.get("or")).toBe(
      "(period_start.lt.2030-04-01,and(period_start.eq.2030-04-01,id.lt.8))",
    );
  });

  it("rejects invalid page sizes and cursor values before fetching", async () => {
    const { repository, requests } = createRepository([]);

    await expect(
      repository.listPage({
        table: "journals",
        sortColumn: "event_date",
        pageSize: 0,
      }),
    ).rejects.toMatchObject({ kind: "validation", status: 400 });
    await expect(
      repository.listPage({
        table: "journals",
        sortColumn: "event_date",
        pageSize: 101,
      }),
    ).rejects.toMatchObject({ kind: "validation", status: 400 });
    await expect(
      repository.listPage({
        table: "journals",
        sortColumn: "event_date",
        cursor: { sortValue: "not-a-date", id: 1 },
      }),
    ).rejects.toMatchObject({ kind: "validation", status: 400 });
    expect(requests).toHaveLength(0);
  });

  it("retries one transient read but does not retry authorization errors", async () => {
    const transient = createRepository([
      {
        status: 503,
        body: { code: "PGRST000", message: "synthetic unavailable" },
      },
      { status: 200, body: [{ id: 1, event_date: "2026-08-12" }] },
    ]);

    await expect(
      transient.repository.listPage({
        table: "journals",
        sortColumn: "event_date",
      }),
    ).resolves.toMatchObject({
      items: [{ id: 1, event_date: "2026-08-12" }],
    });
    expect(transient.requests).toHaveLength(2);

    const unauthorized = createRepository([
      {
        status: 401,
        body: { code: "PGRST301", message: "synthetic unauthorized" },
      },
    ]);
    await expect(
      unauthorized.repository.listPage({
        table: "journals",
        sortColumn: "event_date",
      }),
    ).rejects.toMatchObject({
      kind: "unauthorized",
      status: 401,
      code: "PGRST301",
    });
    expect(unauthorized.requests).toHaveLength(1);
  });

  it("retries one network-failed read", async () => {
    const { repository, requests } = createRepository([
      new TypeError("synthetic network failure"),
      { status: 200, body: [{ id: 1, event_date: "2026-08-12" }] },
    ]);

    await expect(
      repository.listPage({
        table: "journals",
        sortColumn: "event_date",
      }),
    ).resolves.toMatchObject({
      items: [{ id: 1, event_date: "2026-08-12" }],
    });
    expect(requests).toHaveLength(2);
  });

  it("uses revision-guarded updates and maps a zero-row result to conflict", async () => {
    const { repository, requests } = createRepository([
      { status: 200, body: [] },
    ]);

    await expect(
      repository.updateWithRevision(
        "journals",
        17,
        3,
        { title: "Synthetic update" },
      ),
    ).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
      code: "revision_conflict",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("PATCH");
    const url = new URL(requests[0].url);
    expect(url.searchParams.get("id")).toBe("eq.17");
    expect(url.searchParams.get("revision")).toBe("eq.3");
    expect(JSON.parse(await requests[0].text())).toEqual({
      title: "Synthetic update",
      revision: 4,
    });
  });

  it("never retries writes, including transient and idempotent operations", async () => {
    const { repository, requests } = createRepository([
      {
        status: 503,
        body: { code: "PGRST000", message: "synthetic unavailable" },
      },
    ]);
    await expect(
      repository.updateWithRevision(
        "daily_checkins",
        7,
        2,
        { mood: 6.5 },
      ),
    ).rejects.toMatchObject({
      kind: "transient",
      status: 503,
    });
    expect(requests).toHaveLength(1);

    const operation = vi.fn(async (key: string) => ({
      data: null,
      error: {
        code: "23505",
        details: null,
        hint: null,
        message: `duplicate ${key}`,
      },
      status: 409,
    }));
    await expect(
      repository.executeIdempotentWrite(
        "synthetic-key-0001",
        operation,
      ),
    ).rejects.toBeInstanceOf(RepositoryError);
    expect(operation).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledWith("synthetic-key-0001");
  });

  it("returns successful writes and rejects protected update fields", async () => {
    const row = { id: 17, revision: 4, title: "Synthetic update" };
    const { repository, requests } = createRepository([
      { status: 200, body: [row] },
    ]);

    await expect(
      repository.updateWithRevision(
        "journals",
        17,
        3,
        { title: "Synthetic update" },
      ),
    ).resolves.toEqual(row);
    await expect(
      repository.updateWithRevision(
        "journals",
        17,
        4,
        { user_id: "forbidden" },
      ),
    ).rejects.toMatchObject({ kind: "validation", status: 400 });
    expect(requests).toHaveLength(1);

    await expect(
      repository.executeIdempotentWrite(
        "synthetic-key-0002",
        async () => ({ data: row, error: null, status: 201 }),
      ),
    ).resolves.toEqual(row);
  });
});
