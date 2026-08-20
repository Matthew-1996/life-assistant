// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { DailyNewsDigest } from "../../src/domain/daily-news";
import { createDailyNewsApiClient } from "../../src/api/daily-news-client";

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

describe("daily news browser client", () => {
  it("reads the current Supabase access token only for the same-origin request", async () => {
    let input: string | URL | Request | undefined;
    let init: RequestInit | undefined;
    const fetch = vi.fn(async (nextInput: string | URL | Request, nextInit?: RequestInit) => {
      input = nextInput;
      init = nextInit;
      return Response.json({ state: "success", digest });
    });
    const client = createDailyNewsApiClient({
      fetch,
      getAccessToken: vi.fn(async () => "synthetic-owner-jwt"),
    });

    await expect(client.getDigest({ allowRebuild: true })).resolves.toEqual({
      state: "success",
      digest,
    });
    expect(input).toBe("/api/daily-news?rebuild=1");
    expect(new Headers(init?.headers).get("authorization"))
      .toBe("Bearer synthetic-owner-jwt");
    expect(init?.method).toBe("GET");
  });

  it("fails closed without a session or with a malformed server result", async () => {
    const fetch = vi.fn(async () => Response.json({ state: "success", digest: {} }));
    const noSession = createDailyNewsApiClient({
      fetch,
      getAccessToken: vi.fn(async () => null),
    });
    await expect(noSession.getDigest({ allowRebuild: false })).rejects.toThrow(
      /daily_news_unauthenticated/,
    );
    expect(fetch).not.toHaveBeenCalled();

    const malformed = createDailyNewsApiClient({
      fetch,
      getAccessToken: vi.fn(async () => "synthetic-owner-jwt"),
    });
    await expect(malformed.getDigest({ allowRebuild: false })).rejects.toThrow(
      /daily_news_invalid_response/,
    );
  });
});
