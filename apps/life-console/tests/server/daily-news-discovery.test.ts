// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  DailyNewsDiscoveryError,
  discoverDailyNewsCandidates,
} from "../../src/server/daily-news-discovery";
import type { PublicNewsCandidate } from "../../src/server/daily-news-validator";

const publishedAt = "2030-05-14T01:30:00.000Z";

function candidate(
  id: string,
  category: PublicNewsCandidate["category"],
  scope: PublicNewsCandidate["scope"],
  url: string,
): PublicNewsCandidate {
  return {
    id,
    category,
    description: `Description ${id}`,
    publishedAt,
    scope,
    snippet: `Snippet ${id}`,
    source: new URL(url).hostname,
    title: `Title ${id}`,
    url,
  };
}

const completePrimary = [
  candidate("p-tech-cn", "technology", "domestic", "https://www.news.cn/tech/a"),
  candidate("p-finance-world", "finance", "international", "https://www.bbc.com/news/b"),
  candidate("p-politics-cn", "politics", "domestic", "https://www.gov.cn/c"),
  candidate("p-tech-world", "technology", "international", "https://techcrunch.com/d"),
  candidate("p-finance-cn", "finance", "domestic", "https://www.pbc.gov.cn/e"),
];

describe("daily news discovery orchestration", () => {
  it("uses a complete primary result without calling the fallback", async () => {
    const primary = vi.fn(async () => completePrimary);
    const fallback = vi.fn(async () => {
      throw new Error("fallback should not run");
    });

    await expect(discoverDailyNewsCandidates({ primary, fallback })).resolves.toEqual({
      candidates: completePrimary,
      source: "gdelt",
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses the fallback when the primary source throws", async () => {
    const fallbackCandidates = completePrimary.map((item) => ({
      ...item,
      id: `f-${item.id}`,
      title: `Fallback ${item.title}`,
    }));

    await expect(discoverDailyNewsCandidates({
      primary: vi.fn(async () => { throw new Error("synthetic primary outage"); }),
      fallback: vi.fn(async () => fallbackCandidates),
    })).resolves.toEqual({
      candidates: fallbackCandidates,
      source: "publisher_fallback",
    });
  });

  it("merges a valid complement when the primary mix is incomplete", async () => {
    const incompletePrimary = completePrimary.slice(0, 2);
    const complement = completePrimary.slice(2).map((item) => ({
      ...item,
      id: `f-${item.id}`,
      title: `Fallback ${item.title}`,
    }));

    await expect(discoverDailyNewsCandidates({
      primary: vi.fn(async () => incompletePrimary),
      fallback: vi.fn(async () => complement),
    })).resolves.toEqual({
      candidates: [...incompletePrimary, ...complement],
      source: "gdelt_plus_publisher_fallback",
    });
  });

  it("returns a stable code when both source paths are unavailable", async () => {
    const result = discoverDailyNewsCandidates({
      primary: vi.fn(async () => { throw new Error("private primary response"); }),
      fallback: vi.fn(async () => { throw new Error("private fallback response"); }),
    });

    await expect(result).rejects.toEqual(expect.objectContaining({
      code: "news_discovery_unavailable",
      source: "none",
    }));
    await expect(result).rejects.toBeInstanceOf(DailyNewsDiscoveryError);
  });

  it("reports a stable selection failure after combining both paths", async () => {
    const result = discoverDailyNewsCandidates({
      primary: vi.fn(async () => completePrimary.slice(0, 1)),
      fallback: vi.fn(async () => completePrimary.slice(1, 2)),
    });

    await expect(result).rejects.toEqual(expect.objectContaining({
      code: "candidate_mix_unavailable",
      source: "gdelt_plus_publisher_fallback",
    }));
  });
});
