// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { DailyNewsDigest } from "../../src/domain/daily-news";
import {
  createRuntimeDailyNewsCache,
  type RuntimeCacheLike,
} from "../../src/server/daily-news-cache";

const digest: DailyNewsDigest = {
  date: "2030-05-14",
  generatedAt: "2030-05-14T01:00:00.000Z",
  items: [
    ["a", "technology", "domestic", "https://www.xinhuanet.com/a"],
    ["b", "finance", "international", "https://www.reuters.com/b"],
    ["c", "politics", "domestic", "https://www.gov.cn/c"],
    ["d", "technology", "international", "https://techcrunch.com/d"],
    ["e", "finance", "domestic", "https://www.pbc.gov.cn/e"],
  ].map(([id, category, scope, url]) => ({
    id,
    category: category as "technology" | "finance" | "politics",
    publishedAt: "2030-05-14T00:00:00.000Z",
    scope: scope as "domestic" | "international",
    source: new URL(url).hostname,
    summary: `摘要 ${id}`,
    title: `Title ${id}`,
    url,
  })),
};

describe("Vercel Runtime Cache daily news adapter", () => {
  it("stores the dated digest and last-success pointer for exactly seven days", async () => {
    const values = new Map<string, unknown>();
    const runtime: RuntimeCacheLike = {
      get: vi.fn(async (key) => values.get(key) ?? null),
      set: vi.fn(async (key, value) => { values.set(key, value); }),
    };
    const cache = createRuntimeDailyNewsCache(runtime);

    await cache.setSuccessful(digest);

    expect(runtime.set).toHaveBeenNthCalledWith(
      1,
      "daily-news:v1:2030-05-14",
      digest,
      expect.objectContaining({ ttl: 7 * 24 * 60 * 60, tags: ["daily-news"] }),
    );
    expect(runtime.set).toHaveBeenNthCalledWith(
      2,
      "daily-news:v1:last-success",
      digest,
      expect.objectContaining({ ttl: 7 * 24 * 60 * 60, tags: ["daily-news"] }),
    );
    await expect(cache.get("2030-05-14")).resolves.toEqual(digest);
    await expect(cache.getLastSuccess()).resolves.toEqual(digest);
  });

  it("treats an invalid or evicted value as a cache miss", async () => {
    const runtime: RuntimeCacheLike = {
      get: vi.fn(async () => ({ items: "malformed" })),
      set: vi.fn(async () => undefined),
    };
    const cache = createRuntimeDailyNewsCache(runtime);

    await expect(cache.get("2030-05-14")).resolves.toBeUndefined();
    await expect(cache.getLastSuccess()).resolves.toBeUndefined();
  });
});
