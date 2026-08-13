// @vitest-environment node

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { ReviewRepository } from "../../src/supabase/reviews";

interface SyntheticResponse {
  status: number;
  body: unknown;
}

function createReviewRepository(responses: SyntheticResponse[]) {
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
    repository: new ReviewRepository(client),
    requests,
  };
}

const syntheticWeekly = {
  id: 51,
  user_id: "synthetic-owner",
  week_start: "2030-04-01",
  content: "Synthetic weekly content",
  revision: 1,
  deleted_at: null,
  created_at: "2030-04-07T08:00:00.000Z",
  updated_at: "2030-04-07T08:00:00.000Z",
};

const syntheticPhase = {
  id: 61,
  user_id: "synthetic-owner",
  period_start: "2030-04-01",
  period_end: "2030-04-30",
  content: "Synthetic phase content",
  revision: 1,
  deleted_at: null,
  created_at: "2030-05-01T08:00:00.000Z",
  updated_at: "2030-05-01T08:00:00.000Z",
};

describe("Review Repository", () => {
  it("lists weekly and phase reviews with fixed active date cursors", async () => {
    const { repository, requests } = createReviewRepository([
      { status: 200, body: [syntheticWeekly] },
      { status: 200, body: [syntheticPhase] },
    ]);

    await repository.listWeekly({ pageSize: 10 });
    await repository.listPhases({ pageSize: 10 });

    const weeklyUrl = new URL(requests[0].url);
    expect(weeklyUrl.pathname).toBe("/rest/v1/weekly_reviews");
    expect(weeklyUrl.searchParams.get("deleted_at")).toBe("is.null");
    expect(weeklyUrl.searchParams.get("order")).toBe(
      "week_start.desc,id.desc",
    );
    const phaseUrl = new URL(requests[1].url);
    expect(phaseUrl.pathname).toBe("/rest/v1/phase_reviews");
    expect(phaseUrl.searchParams.get("deleted_at")).toBe("is.null");
    expect(phaseUrl.searchParams.get("order")).toBe(
      "period_start.desc,id.desc",
    );
  });

  it("maps weekly and phase creates to separate idempotent RPCs", async () => {
    const { repository, requests } = createReviewRepository([
      { status: 200, body: [syntheticWeekly] },
      { status: 200, body: [syntheticPhase] },
    ]);

    await expect(
      repository.createWeekly("synthetic-weekly-key-0001", {
        weekStart: "2030-04-01",
        content: "Synthetic weekly content",
      }),
    ).resolves.toEqual(syntheticWeekly);
    await expect(
      repository.createPhase("synthetic-phase-key-0001", {
        periodStart: "2030-04-01",
        periodEnd: "2030-04-30",
        content: "Synthetic phase content",
      }),
    ).resolves.toEqual(syntheticPhase);

    expect(new URL(requests[0].url).pathname).toBe(
      "/rest/v1/rpc/create_weekly_review",
    );
    expect(JSON.parse(await requests[0].text())).toEqual({
      p_content: "Synthetic weekly content",
      p_idempotency_key: "synthetic-weekly-key-0001",
      p_week_start: "2030-04-01",
    });
    expect(new URL(requests[1].url).pathname).toBe(
      "/rest/v1/rpc/create_phase_review",
    );
    expect(JSON.parse(await requests[1].text())).toEqual({
      p_content: "Synthetic phase content",
      p_idempotency_key: "synthetic-phase-key-0001",
      p_period_end: "2030-04-30",
      p_period_start: "2030-04-01",
    });
  });

  it("rejects invalid dates, date order, content, and empty updates", async () => {
    const { repository, requests } = createReviewRepository([]);

    await expect(
      repository.createWeekly("synthetic-weekly-key-0002", {
        weekStart: "2030-02-30",
        content: "Synthetic weekly content",
      }),
    ).rejects.toMatchObject({ kind: "validation", status: 400 });
    await expect(
      repository.createPhase("synthetic-phase-key-0002", {
        periodStart: "2030-05-01",
        periodEnd: "2030-04-01",
        content: "Synthetic phase content",
      }),
    ).rejects.toMatchObject({ kind: "validation", status: 400 });
    await expect(
      repository.createWeekly("synthetic-weekly-key-0003", {
        weekStart: "2030-04-01",
        content: " ",
      }),
    ).rejects.toMatchObject({ kind: "validation", status: 400 });
    await expect(
      repository.updateWeekly(51, 1, {}),
    ).rejects.toMatchObject({ kind: "validation", status: 400 });
    await expect(
      repository.updatePhase(61, 1, {}),
    ).rejects.toMatchObject({ kind: "validation", status: 400 });
    expect(requests).toHaveLength(0);
  });

  it("updates explicit review fields with revision guards", async () => {
    const weeklyUpdated = {
      ...syntheticWeekly,
      content: "Synthetic weekly revised",
      revision: 2,
    };
    const phaseUpdated = {
      ...syntheticPhase,
      period_end: "2030-05-01",
      revision: 2,
    };
    const { repository, requests } = createReviewRepository([
      { status: 200, body: [weeklyUpdated] },
      { status: 200, body: [phaseUpdated] },
    ]);

    await repository.updateWeekly(51, 1, {
      content: "Synthetic weekly revised",
    });
    await repository.updatePhase(61, 1, {
      periodEnd: "2030-05-01",
    });

    expect(JSON.parse(await requests[0].text())).toEqual({
      content: "Synthetic weekly revised",
      revision: 2,
    });
    expect(JSON.parse(await requests[1].text())).toEqual({
      period_end: "2030-05-01",
      revision: 2,
    });
  });

  it("does not retry writes or hide revision conflicts", async () => {
    const transient = createReviewRepository([
      {
        status: 503,
        body: { code: "PGRST000", message: "synthetic unavailable" },
      },
    ]);
    await expect(
      transient.repository.createWeekly(
        "synthetic-weekly-key-0004",
        {
          weekStart: "2030-04-01",
          content: "Synthetic weekly content",
        },
      ),
    ).rejects.toMatchObject({ kind: "transient", status: 503 });
    expect(transient.requests).toHaveLength(1);

    const conflict = createReviewRepository([
      { status: 200, body: [] },
    ]);
    await expect(
      conflict.repository.updatePhase(61, 1, {
        content: "Synthetic conflict",
      }),
    ).rejects.toMatchObject({
      code: "revision_conflict",
      kind: "conflict",
      status: 409,
    });
    expect(conflict.requests).toHaveLength(1);
  });
});
