// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { DailyNewsDigest } from "../../src/domain/daily-news";
import {
  createDailyNewsService,
  type DailyNewsCachePort,
} from "../../src/server/daily-news-service";
import type { PublicNewsCandidate } from "../../src/server/daily-news-validator";

const today = "2030-05-14";
const now = new Date("2030-05-14T01:30:00.000Z");

const candidates: PublicNewsCandidate[] = [
  ["a", "technology", "domestic", "https://www.xinhuanet.com/a"],
  ["b", "finance", "international", "https://www.reuters.com/b"],
  ["c", "politics", "domestic", "https://www.gov.cn/c"],
  ["d", "technology", "international", "https://techcrunch.com/d"],
  ["e", "finance", "domestic", "https://www.pbc.gov.cn/e"],
].map(([id, category, scope, url]) => ({
  id,
  category: category as PublicNewsCandidate["category"],
  description: `Description ${id}`,
  publishedAt: now.toISOString(),
  scope: scope as PublicNewsCandidate["scope"],
  snippet: `Snippet ${id}`,
  source: new URL(url).hostname,
  title: `Title ${id}`,
  url,
}));

function digest(date = today): DailyNewsDigest {
  return {
    date,
    generatedAt: now.toISOString(),
    items: candidates.map((item) => ({
      id: item.id,
      category: item.category,
      publishedAt: item.publishedAt,
      scope: item.scope,
      source: item.source,
      summary: `摘要 ${item.id}`,
      title: item.title,
      url: item.url,
    })),
  };
}

function memoryCache(initial?: { current?: DailyNewsDigest; last?: DailyNewsDigest }) {
  let current = initial?.current;
  let last = initial?.last;
  const cache: DailyNewsCachePort = {
    get: vi.fn(async (date) => current?.date === date ? current : undefined),
    getLastSuccess: vi.fn(async () => last),
    setSuccessful: vi.fn(async (value) => {
      current = value;
      last = value;
    }),
  };
  return cache;
}

describe("daily news service", () => {
  it("returns a valid current cache without calling external services", async () => {
    const cache = memoryCache({ current: digest() });
    const discover = vi.fn(async () => candidates);
    const summarize = vi.fn(async () => []);
    const service = createDailyNewsService({ cache, discover, now: () => now, summarize });

    await expect(service.getDigest({ allowRebuild: true })).resolves.toEqual({
      state: "success",
      digest: digest(),
    });
    expect(discover).not.toHaveBeenCalled();
  });

  it("builds once for concurrent cache misses and writes only a complete digest", async () => {
    const cache = memoryCache();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const discover = vi.fn(async () => {
      await gate;
      return candidates;
    });
    const summarize = vi.fn(async (items: PublicNewsCandidate[]) => items.map((item) => ({
      id: item.id,
      summary: `摘要 ${item.id}`,
    })));
    const service = createDailyNewsService({ cache, discover, now: () => now, summarize });

    const first = service.getDigest({ allowRebuild: true });
    const second = service.getDigest({ allowRebuild: true });
    release?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { state: "success", digest: digest() },
      { state: "success", digest: digest() },
    ]);
    expect(discover).toHaveBeenCalledOnce();
    expect(cache.setSuccessful).toHaveBeenCalledOnce();
  });

  it("returns the latest valid digest as stale after a rebuild failure", async () => {
    const previous = digest("2030-05-13");
    const cache = memoryCache({ last: previous });
    const service = createDailyNewsService({
      cache,
      discover: vi.fn(async () => { throw new Error("synthetic outage"); }),
      now: () => now,
      summarize: vi.fn(async () => []),
    });

    await expect(service.getDigest({ allowRebuild: true })).resolves.toEqual({
      state: "stale",
      digest: previous,
      failedAt: now.toISOString(),
    });
    expect(cache.setSuccessful).not.toHaveBeenCalled();
  });

  it("returns a retryable empty state and does not rebuild when rebuilding is disabled", async () => {
    const cache = memoryCache();
    const discover = vi.fn(async () => candidates);
    const service = createDailyNewsService({
      cache,
      discover,
      now: () => now,
      summarize: vi.fn(async () => []),
    });

    await expect(service.getDigest({ allowRebuild: false })).resolves.toEqual({
      state: "empty",
      retryable: true,
    });
    expect(discover).not.toHaveBeenCalled();
  });
});
