// @vitest-environment node

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { GoalRepository } from "../../src/supabase/goals";

interface SyntheticResponse {
  status: number;
  body: unknown;
}

function createGoalRepository(responses: SyntheticResponse[]) {
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
    repository: new GoalRepository(client),
    requests,
  };
}

const syntheticGoal = {
  id: 17,
  user_id: "synthetic-owner",
  title: "Synthetic Goal",
  domain: "test",
  status: "active" as const,
  priority: 2,
  start_date: "2030-02-01",
  target_date: "2030-02-28",
  revision: 1,
  deleted_at: null,
  created_at: "2030-01-01T08:00:00.000Z",
  updated_at: "2030-01-01T08:00:00.000Z",
};

describe("Goal Repository", () => {
  it("lists non-deleted goals through the fixed composite cursor", async () => {
    const { repository, requests } = createGoalRepository([
      { status: 200, body: [syntheticGoal] },
    ]);

    await expect(repository.list({ pageSize: 20 })).resolves.toEqual({
      items: [syntheticGoal],
      nextCursor: null,
    });
    const url = new URL(requests[0].url);
    expect(url.pathname).toBe("/rest/v1/goals");
    expect(url.searchParams.get("deleted_at")).toBe("is.null");
    expect(url.searchParams.get("order")).toBe(
      "created_at.desc,id.desc",
    );
  });

  it("maps validated create input to the idempotent RPC once", async () => {
    const { repository, requests } = createGoalRepository([
      { status: 200, body: [syntheticGoal] },
    ]);

    await expect(
      repository.create("synthetic-goal-key-0001", {
        title: "  Synthetic Goal  ",
        domain: " test ",
        status: "active",
        priority: 2,
        startDate: "2030-02-01",
        targetDate: "2030-02-28",
      }),
    ).resolves.toEqual(syntheticGoal);

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
    expect(new URL(requests[0].url).pathname).toBe(
      "/rest/v1/rpc/create_goal",
    );
    expect(JSON.parse(await requests[0].text())).toEqual({
      p_domain: "test",
      p_idempotency_key: "synthetic-goal-key-0001",
      p_priority: 2,
      p_start_date: "2030-02-01",
      p_status: "active",
      p_target_date: "2030-02-28",
      p_title: "Synthetic Goal",
    });
  });

  it("fails closed on invalid create and update input before fetching", async () => {
    const { repository, requests } = createGoalRepository([]);

    await expect(
      repository.create("synthetic-goal-key-0002", {
        title: " ",
        status: "active",
      }),
    ).rejects.toMatchObject({ kind: "validation", status: 400 });
    await expect(
      repository.create("synthetic-goal-key-0003", {
        title: "Synthetic Goal",
        status: "active",
        priority: 10,
      }),
    ).rejects.toMatchObject({ kind: "validation", status: 400 });
    await expect(
      repository.create("synthetic-goal-key-0004", {
        title: "Synthetic Goal",
        status: "active",
        startDate: "2030-03-01",
        targetDate: "2030-02-01",
      }),
    ).rejects.toMatchObject({ kind: "validation", status: 400 });
    await expect(
      repository.update(17, 1, {}),
    ).rejects.toMatchObject({ kind: "validation", status: 400 });
    expect(requests).toHaveLength(0);
  });

  it("normalizes update fields and uses revision-guarded writes", async () => {
    const updated = {
      ...syntheticGoal,
      title: "Updated Synthetic Goal",
      domain: null,
      status: "completed" as const,
      revision: 2,
    };
    const { repository, requests } = createGoalRepository([
      { status: 200, body: [updated] },
    ]);

    await expect(
      repository.update(17, 1, {
        title: " Updated Synthetic Goal ",
        domain: " ",
        status: "completed",
      }),
    ).resolves.toEqual(updated);

    const url = new URL(requests[0].url);
    expect(requests[0].method).toBe("PATCH");
    expect(url.searchParams.get("id")).toBe("eq.17");
    expect(url.searchParams.get("revision")).toBe("eq.1");
    expect(JSON.parse(await requests[0].text())).toEqual({
      domain: null,
      revision: 2,
      status: "completed",
      title: "Updated Synthetic Goal",
    });
  });

  it("archives and restores through explicit revision updates", async () => {
    const archived = {
      ...syntheticGoal,
      status: "archived" as const,
      revision: 2,
      deleted_at: "2030-03-01T10:00:00.000Z",
    };
    const restored = {
      ...syntheticGoal,
      revision: 3,
    };
    const { repository, requests } = createGoalRepository([
      { status: 200, body: [archived] },
      { status: 200, body: [restored] },
    ]);

    await expect(
      repository.archive(
        17,
        1,
        "2030-03-01T10:00:00.000Z",
      ),
    ).resolves.toEqual(archived);
    await expect(repository.restore(17, 2)).resolves.toEqual(restored);

    expect(JSON.parse(await requests[0].text())).toEqual({
      deleted_at: "2030-03-01T10:00:00.000Z",
      revision: 2,
      status: "archived",
    });
    expect(JSON.parse(await requests[1].text())).toEqual({
      deleted_at: null,
      revision: 3,
      status: "active",
    });
  });

  it("does not retry a transient create or hide a revision conflict", async () => {
    const transient = createGoalRepository([
      {
        status: 503,
        body: { code: "PGRST000", message: "synthetic unavailable" },
      },
    ]);
    await expect(
      transient.repository.create("synthetic-goal-key-0005", {
        title: "Synthetic Goal",
        status: "active",
      }),
    ).rejects.toMatchObject({ kind: "transient", status: 503 });
    expect(transient.requests).toHaveLength(1);

    const conflict = createGoalRepository([
      { status: 200, body: [] },
    ]);
    await expect(
      conflict.repository.update(17, 1, {
        title: "Synthetic Conflict",
      }),
    ).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
      code: "revision_conflict",
    });
    expect(conflict.requests).toHaveLength(1);
  });
});
