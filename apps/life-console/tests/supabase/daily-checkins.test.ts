// @vitest-environment node

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { DailyCheckinRepository } from "../../src/supabase/daily-checkins";

interface SyntheticResponse {
  status: number;
  body: unknown;
}

function createDailyRepository(responses: SyntheticResponse[]) {
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
    repository: new DailyCheckinRepository(client),
    requests,
  };
}

const syntheticCheckin = {
  id: 21,
  user_id: "synthetic-owner",
  checkin_date: "2030-02-01",
  sleep_quality: 4 as const,
  energy: 3 as const,
  mood: null,
  life_feeling: 4 as const,
  anchors: { life_action: "minimum" as const },
  notes: "Synthetic status note",
  revision: 1,
  created_at: "2030-02-01T08:00:00.000Z",
  updated_at: "2030-02-01T08:00:00.000Z",
};

describe("Daily Check-in Repository", () => {
  it("lists recent check-ins with an approved date cursor", async () => {
    const { repository, requests } = createDailyRepository([
      { status: 200, body: [syntheticCheckin] },
    ]);

    await expect(repository.list({ pageSize: 7 })).resolves.toEqual({
      items: [syntheticCheckin],
      nextCursor: null,
    });
    const url = new URL(requests[0].url);
    expect(url.pathname).toBe("/rest/v1/daily_checkins");
    expect(url.searchParams.get("order")).toBe(
      "checkin_date.desc,id.desc",
    );
  });

  it("finds one date through the read retry boundary", async () => {
    const { repository, requests } = createDailyRepository([
      {
        status: 503,
        body: { code: "PGRST000", message: "synthetic unavailable" },
      },
      { status: 200, body: [syntheticCheckin] },
    ]);

    await expect(repository.get("2030-02-01")).resolves.toEqual(
      syntheticCheckin,
    );
    expect(requests).toHaveLength(2);
    const url = new URL(requests[1].url);
    expect(url.searchParams.get("checkin_date")).toBe("eq.2030-02-01");
    expect(url.searchParams.get("limit")).toBe("1");
  });

  it("maps explicit create fields to the idempotent RPC once", async () => {
    const { repository, requests } = createDailyRepository([
      { status: 200, body: [syntheticCheckin] },
    ]);

    await expect(
      repository.create("synthetic-checkin-key-0001", {
        date: "2030-02-01",
        energy: 3,
        mood: null,
        anchors: { life_action: "minimum" },
        notes: " Synthetic status note ",
      }),
    ).resolves.toEqual(syntheticCheckin);

    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).pathname).toBe(
      "/rest/v1/rpc/create_daily_checkin",
    );
    expect(JSON.parse(await requests[0].text())).toEqual({
      p_anchors: { life_action: "minimum" },
      p_checkin_date: "2030-02-01",
      p_energy: 3,
      p_idempotency_key: "synthetic-checkin-key-0001",
      p_life_feeling: null,
      p_mood: null,
      p_notes: "Synthetic status note",
      p_sleep_quality: null,
    });
  });

  it("rejects invalid dates, ratings, anchors, notes, and empty creates", async () => {
    const { repository, requests } = createDailyRepository([]);
    const base = {
      date: "2030-02-01",
      energy: 3 as const,
    };

    for (const input of [
      { ...base, date: "not-a-date" },
      { ...base, energy: 0 },
      { ...base, energy: 6 },
      { ...base, energy: 2.5 },
      { ...base, anchors: { unknown: "complete" } },
      { ...base, anchors: { wake: "invalid" } },
      { ...base, notes: "x".repeat(161) },
      { date: "2030-02-01" },
    ]) {
      await expect(
        repository.create(
          "synthetic-checkin-key-0002",
          input as never,
        ),
      ).rejects.toMatchObject({ kind: "validation", status: 400 });
    }
    expect(requests).toHaveLength(0);
  });

  it("updates only explicit fields with a revision guard", async () => {
    const updated = {
      ...syntheticCheckin,
      energy: 4 as const,
      revision: 2,
    };
    const { repository, requests } = createDailyRepository([
      { status: 200, body: [updated] },
    ]);

    await expect(
      repository.update(21, 1, { energy: 4 }),
    ).resolves.toEqual(updated);

    const url = new URL(requests[0].url);
    expect(url.searchParams.get("id")).toBe("eq.21");
    expect(url.searchParams.get("revision")).toBe("eq.1");
    expect(JSON.parse(await requests[0].text())).toEqual({
      energy: 4,
      revision: 2,
    });
  });

  it("preserves explicit nulls and full anchor replacements", async () => {
    const updated = {
      ...syntheticCheckin,
      mood: null,
      anchors: { wake: "complete" as const },
      notes: null,
      revision: 2,
    };
    const { repository, requests } = createDailyRepository([
      { status: 200, body: [updated] },
    ]);

    await repository.update(21, 1, {
      mood: null,
      anchors: { wake: "complete" },
      notes: " ",
    });

    expect(JSON.parse(await requests[0].text())).toEqual({
      anchors: { wake: "complete" },
      mood: null,
      notes: null,
      revision: 2,
    });
  });

  it("does not retry writes or hide revision conflicts", async () => {
    const transient = createDailyRepository([
      {
        status: 503,
        body: { code: "PGRST000", message: "synthetic unavailable" },
      },
    ]);
    await expect(
      transient.repository.create("synthetic-checkin-key-0003", {
        date: "2030-02-01",
        energy: 3,
      }),
    ).rejects.toMatchObject({ kind: "transient", status: 503 });
    expect(transient.requests).toHaveLength(1);

    const conflict = createDailyRepository([
      { status: 200, body: [] },
    ]);
    await expect(
      conflict.repository.update(21, 1, { energy: 4 }),
    ).rejects.toMatchObject({
      code: "revision_conflict",
      kind: "conflict",
      status: 409,
    });
    expect(conflict.requests).toHaveLength(1);
  });
});
