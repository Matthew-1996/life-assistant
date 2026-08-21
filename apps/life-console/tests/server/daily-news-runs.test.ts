// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { RuntimeCacheLike } from "../../src/server/daily-news-cache";
import { createRuntimeDailyNewsRunStore } from "../../src/server/daily-news-runs";

const now = new Date("2030-05-14T02:00:00.000Z");
const startedAt = "2030-05-14T01:30:00.000Z";
const finishedAt = "2030-05-14T01:31:00.000Z";

function runtimeCache(initial?: unknown) {
  const values = new Map<string, unknown>();
  if (initial !== undefined) values.set("daily-news:v1:cron-runs", initial);
  const runtime: RuntimeCacheLike & { values: Map<string, unknown> } = {
    values,
    get: vi.fn(async (key) => values.get(key) ?? null),
    set: vi.fn(async (key, next) => { values.set(key, next); }),
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

  it("serializes concurrent starts and keeps each receipt under its own key", async () => {
    const runtime = runtimeCache();
    const store = createRuntimeDailyNewsRunStore(runtime, () => now);

    await Promise.all([
      store.start({ runId: "run-concurrent-a", startedAt }),
      store.start({
        runId: "run-concurrent-b",
        startedAt: "2030-05-14T01:30:01.000Z",
      }),
    ]);

    await expect(store.listRecent()).resolves.toEqual([
      expect.objectContaining({ runId: "run-concurrent-b" }),
      expect.objectContaining({ runId: "run-concurrent-a" }),
    ]);
    expect(runtime.values.get("daily-news:v1:cron-run:run-concurrent-a"))
      .toEqual(expect.objectContaining({ state: "running" }));
    expect(runtime.values.get("daily-news:v1:cron-run:run-concurrent-b"))
      .toEqual(expect.objectContaining({ state: "running" }));
  });

  it("finishes the per-run receipt even when the recent-run index was evicted", async () => {
    const runtime = runtimeCache();
    const store = createRuntimeDailyNewsRunStore(runtime, () => now);
    await store.start({ runId: "run-synthetic", startedAt });
    runtime.values.delete("daily-news:v1:cron-runs");

    await expect(store.finish("run-synthetic", {
      state: "failed",
      finishedAt,
      discoverySource: "none",
      failureStage: null,
      errorCode: "news_service_unavailable",
      digestDate: null,
      digestGeneratedAt: null,
    })).resolves.toEqual({ indexed: true });
    expect(runtime.values.get("daily-news:v1:cron-run:run-synthetic"))
      .toEqual(expect.objectContaining({ state: "failed" }));
    await expect(store.listRecent()).resolves.toEqual([
      expect.objectContaining({ runId: "run-synthetic", state: "failed" }),
    ]);
  });

  it("keeps both per-run receipts queryable across competing store instances", async () => {
    const runtime = runtimeCache();
    const first = createRuntimeDailyNewsRunStore(runtime, () => now);
    const second = createRuntimeDailyNewsRunStore(runtime, () => now);

    await Promise.all([
      first.start({ runId: "run-instance-a", startedAt }),
      second.start({
        runId: "run-instance-b",
        startedAt: "2030-05-14T01:30:01.000Z",
      }),
    ]);

    await expect(first.get("run-instance-a")).resolves.toEqual(
      expect.objectContaining({ runId: "run-instance-a", state: "running" }),
    );
    await expect(second.get("run-instance-b")).resolves.toEqual(
      expect.objectContaining({ runId: "run-instance-b", state: "running" }),
    );
  });

  it("completes the per-run receipt when only the recent index is unavailable", async () => {
    const runtime = runtimeCache();
    const originalSet = runtime.set;
    runtime.set = vi.fn(async (key, value, options) => {
      if (key === "daily-news:v1:cron-runs") {
        throw new Error("synthetic index outage");
      }
      await originalSet(key, value, options);
    });
    const store = createRuntimeDailyNewsRunStore(runtime, () => now);

    await expect(store.start({ runId: "run-synthetic", startedAt }))
      .resolves.toEqual({ indexed: false });
    await expect(store.finish("run-synthetic", {
      state: "empty",
      finishedAt,
      discoverySource: "publisher_fallback",
      failureStage: "selection",
      errorCode: "candidate_mix_unavailable",
      digestDate: null,
      digestGeneratedAt: null,
    })).resolves.toEqual({ indexed: false });
    await expect(store.get("run-synthetic")).resolves.toEqual(
      expect.objectContaining({ runId: "run-synthetic", state: "empty" }),
    );
  });
});
