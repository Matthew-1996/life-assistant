// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { RuntimeCacheLike } from "../../src/server/daily-news-cache";
import { createRuntimeDailyNewsRunStore } from "../../src/server/daily-news-runs";

const now = new Date("2030-05-14T02:00:00.000Z");
const startedAt = "2030-05-14T01:30:00.000Z";
const finishedAt = "2030-05-14T01:31:00.000Z";

function runtimeCache(initial?: unknown) {
  let value = initial;
  const runtime: RuntimeCacheLike = {
    get: vi.fn(async () => value ?? null),
    set: vi.fn(async (_key, next) => { value = next; }),
  };
  return runtime;
}

describe("daily news Cron run store", () => {
  it("stores a sanitized running and completed receipt for seven days", async () => {
    const runtime = runtimeCache();
    const store = createRuntimeDailyNewsRunStore(runtime, () => now);

    await store.start({ runId: "run-synthetic", startedAt });
    await store.finish("run-synthetic", {
      state: "empty",
      finishedAt,
      discoverySource: "publisher_fallback",
      failureStage: "selection",
      errorCode: "candidate_mix_unavailable",
      digestDate: null,
      digestGeneratedAt: null,
    });

    await expect(store.listRecent()).resolves.toEqual([{
      schemaVersion: 1,
      runId: "run-synthetic",
      startedAt,
      state: "empty",
      finishedAt,
      discoverySource: "publisher_fallback",
      failureStage: "selection",
      errorCode: "candidate_mix_unavailable",
      digestDate: null,
      digestGeneratedAt: null,
    }]);
    expect(runtime.set).toHaveBeenLastCalledWith(
      "daily-news:v1:cron-runs",
      expect.any(Array),
      expect.objectContaining({ ttl: 604_800, tags: ["daily-news-runs"] }),
    );
    expect(JSON.stringify(await store.listRecent())).not.toContain("synthetic-secret");
  });

  it("sorts newest first and retains at most 32 exact-schema receipts", async () => {
    const runtime = runtimeCache();
    const store = createRuntimeDailyNewsRunStore(runtime, () => now);

    for (let index = 0; index < 34; index += 1) {
      await store.start({
        runId: `run-${index}`,
        startedAt: new Date(now.getTime() - index * 1_000).toISOString(),
      });
    }

    const recent = await store.listRecent();
    expect(recent).toHaveLength(32);
    expect(recent[0]?.runId).toBe("run-0");
    expect(recent.at(-1)?.runId).toBe("run-31");
    expect(Object.keys(recent[0] ?? {}).sort()).toEqual([
      "runId", "schemaVersion", "startedAt", "state",
    ]);
  });

  it.each([
    { name: "evicted", value: null },
    { name: "malformed", value: [{ schemaVersion: 1, secret: "synthetic-secret" }] },
    {
      name: "expired",
      value: [{
        schemaVersion: 1,
        runId: "run-expired",
        startedAt: "2030-05-06T01:00:00.000Z",
        state: "running",
      }],
    },
  ])("treats an $name Runtime Cache value as an empty list", async ({ value }) => {
    const store = createRuntimeDailyNewsRunStore(runtimeCache(value), () => now);
    await expect(store.listRecent()).resolves.toEqual([]);
  });

  it("rejects completion fields that could leak upstream or Owner data", async () => {
    const store = createRuntimeDailyNewsRunStore(runtimeCache(), () => now);
    await store.start({ runId: "run-synthetic", startedAt });

    await expect(store.finish("run-synthetic", {
      state: "failed",
      finishedAt,
      discoverySource: "none",
      failureStage: "discovery",
      errorCode: "synthetic-secret",
      digestDate: null,
      digestGeneratedAt: null,
    })).rejects.toThrow("run_receipt_invalid");
  });
});
