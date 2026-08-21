// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { DailyNewsDigest } from "../../src/domain/daily-news";
import {
  createDailyNewsService,
  DailyNewsServiceError,
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

  it("reports a cache hit without changing the existing digest response", async () => {
    const service = createDailyNewsService({
      cache: memoryCache({ current: digest() }),
      discover: vi.fn(async () => candidates),
      now: () => now,
      summarize: vi.fn(async () => []),
    });

    await expect(service.getDigestWithDiagnostics({ allowRebuild: true })).resolves.toEqual({
      result: { state: "success", digest: digest() },
      diagnostics: {
        discoverySource: "cache",
        errorCode: null,
        failureStage: null,
      },
    });
  });

  it("reports publisher fallback success without changing the digest payload", async () => {
    const service = createDailyNewsService({
      cache: memoryCache(),
      discover: vi.fn(async () => ({
        candidates,
        source: "publisher_fallback" as const,
      })),
      now: () => now,
      summarize: vi.fn(async (items: PublicNewsCandidate[]) => items.map((item) => ({
        id: item.id,
        summary: `摘要 ${item.id}`,
      }))),
    });

    await expect(service.getDigestWithDiagnostics({ allowRebuild: true })).resolves.toEqual({
      result: { state: "success", digest: digest() },
      diagnostics: {
        discoverySource: "publisher_fallback",
        errorCode: null,
        failureStage: null,
      },
    });
  });

  it.each([
    {
      name: "discovery",
      expectedCode: "news_discovery_unavailable",
      expectedSource: "none",
      expectedStage: "discovery",
      discover: vi.fn(async () => { throw new Error("private upstream detail"); }),
      summarize: vi.fn(async () => []),
      cache: memoryCache(),
    },
    {
      name: "selection",
      expectedCode: "candidate_mix_unavailable",
      expectedSource: "gdelt",
      expectedStage: "selection",
      discover: vi.fn(async () => ({
        candidates: candidates.slice(0, 2),
        source: "gdelt" as const,
      })),
      summarize: vi.fn(async () => []),
      cache: memoryCache(),
    },
    {
      name: "summarization",
      expectedCode: "provider_timeout",
      expectedSource: "gdelt",
      expectedStage: "summarization",
      discover: vi.fn(async () => ({ candidates, source: "gdelt" as const })),
      summarize: vi.fn(async () => { throw new DailyNewsServiceError("provider_timeout"); }),
      cache: memoryCache(),
    },
    {
      name: "cache write",
      expectedCode: "cache_write_failed",
      expectedSource: "gdelt",
      expectedStage: "cache_write",
      discover: vi.fn(async () => ({ candidates, source: "gdelt" as const })),
      summarize: vi.fn(async (items: PublicNewsCandidate[]) => items.map((item) => ({
        id: item.id,
        summary: `摘要 ${item.id}`,
      }))),
      cache: {
        ...memoryCache(),
        setSuccessful: vi.fn(async () => { throw new Error("private cache detail"); }),
      },
    },
  ])("reports a sanitized $name failure", async ({
    cache,
    discover,
    expectedCode,
    expectedSource,
    expectedStage,
    summarize,
  }) => {
    const service = createDailyNewsService({
      cache,
      discover,
      now: () => now,
      summarize,
    });

    await expect(service.getDigestWithDiagnostics({ allowRebuild: true })).resolves.toEqual({
      result: { state: "empty", retryable: true },
      diagnostics: {
        discoverySource: expectedSource,
        errorCode: expectedCode,
        failureStage: expectedStage,
      },
    });
  });
});
