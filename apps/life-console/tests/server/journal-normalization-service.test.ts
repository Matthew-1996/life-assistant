// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { normalizeJournalRequest } from "../../src/server/journal-normalization-service";

const normalization = {
  title: "Synthetic title", summary: "Synthetic summary",
  facts: [], feelings: [], people: [], places: [], themes: [],
  planning_clues: [], inferences: [], tags: [],
};

function request(
  body: unknown,
  authorization = "Bearer synthetic-owner-token",
): Request {
  return new Request("https://synthetic.example.invalid/api/journal-normalize", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const store = {
    getJournal: vi.fn(async () => ({
      id: 31,
      content: "Synthetic raw body",
      raw_revision: 2,
    })),
    getContextEntities: vi.fn(async () => [{
      display_name: "Synthetic Person",
      aliases: ["Person"],
      relation: "confirmed relation",
      revision: "profile-revision-1",
    }]),
    beginNormalization: vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000240",
      source_revision: 2,
    })),
    completeNormalization: vi.fn(async () => undefined),
    failNormalization: vi.fn(async () => undefined),
  };
  const createStore = vi.fn(() => store);
  const normalize = vi.fn(async () => normalization);
  return {
    store,
    createStore,
    normalize,
    dependencies: {
      createStore,
      normalize,
      ...overrides,
    },
  };
}

const environment = {
  supabaseUrl: "https://synthetic-project.supabase.co",
  supabasePublishableKey: "sb_publishable_synthetic_only",
  deepSeekApiKey: "synthetic-server-key",
};

describe("journal normalization service", () => {
  it("rejects missing bearer and malformed requests before reading data", async () => {
    const fixture = dependencies();
    const noBearer = await normalizeJournalRequest(
      request({ journal_id: 31, source_revision: 2, task_key: "task:synthetic-0001" }, ""),
      environment,
      fixture.dependencies,
    );
    expect(noBearer.status).toBe(401);
    expect(await noBearer.json()).toEqual({ status: "unauthenticated" });

    const malformed = await normalizeJournalRequest(
      request({ journal_id: "31", source_revision: 2, task_key: "short" }),
      environment,
      fixture.dependencies,
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ status: "invalid_request" });
    expect(fixture.createStore).not.toHaveBeenCalled();
  });

  it("uses the bearer-scoped store and only the minimal confirmed context", async () => {
    const fixture = dependencies();
    const response = await normalizeJournalRequest(
      request({
        journal_id: 31,
        source_revision: 2,
        task_key: "task:synthetic-0001",
      }),
      environment,
      fixture.dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "completed" });
    expect(fixture.createStore).toHaveBeenCalledWith(
      environment,
      "synthetic-owner-token",
    );
    expect(fixture.normalize).toHaveBeenCalledWith({
      rawText: "Synthetic raw body",
      contextEntities: [{
        text: "Synthetic Person",
        aliases: ["Person"],
        relation: "confirmed relation",
        revision: "profile-revision-1",
      }],
      contextRevisions: {
        "Synthetic Person": "profile-revision-1",
      },
    }, environment);
    expect(fixture.store.beginNormalization).toHaveBeenCalledWith({
      journalId: 31,
      sourceRevision: 2,
      processor: "deepseek",
      taskKey: "task:synthetic-0001",
    });
    expect(fixture.store.completeNormalization).toHaveBeenCalledWith({
      jobId: "00000000-0000-4000-8000-000000000240",
      sourceRevision: 2,
      normalization,
    });
  });

  it("rejects a stale source revision before calling the provider", async () => {
    const fixture = dependencies();
    const response = await normalizeJournalRequest(
      request({
        journal_id: 31,
        source_revision: 1,
        task_key: "task:synthetic-0002",
      }),
      environment,
      fixture.dependencies,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: "conflict" });
    expect(fixture.normalize).not.toHaveBeenCalled();
  });

  it("records provider failure and returns only a generic redacted result", async () => {
    const fixture = dependencies({
      normalize: vi.fn(async () => {
        throw new Error("Synthetic raw body and provider secret");
      }),
    });
    const response = await normalizeJournalRequest(
      request({
        journal_id: 31,
        source_revision: 2,
        task_key: "task:synthetic-0003",
      }),
      environment,
      fixture.dependencies,
    );
    const serialized = JSON.stringify(await response.json());
    expect(response.status).toBe(503);
    expect(serialized).toBe('{"status":"normalization_failed"}');
    expect(serialized).not.toContain("raw body");
    expect(serialized).not.toContain("provider secret");
    expect(fixture.store.failNormalization).toHaveBeenCalledWith({
      jobId: "00000000-0000-4000-8000-000000000240",
      sourceRevision: 2,
      failureCode: "provider_unavailable",
    });
  });
});
