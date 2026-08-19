// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  DailyNewsValidationError,
  selectTopFive,
  validateNewsSummaries,
  type PublicNewsCandidate,
} from "../../src/server/daily-news-validator";

function candidate(
  id: string,
  url: string,
  category: PublicNewsCandidate["category"],
  scope: PublicNewsCandidate["scope"],
  title = `Synthetic ${id}`,
): PublicNewsCandidate {
  return {
    id,
    category,
    description: `Public description ${id}`,
    publishedAt: "2030-05-14T01:00:00.000Z",
    scope,
    snippet: `Public snippet ${id}`,
    source: new URL(url).hostname,
    title,
    url,
  };
}

const mixedCandidates = [
  candidate("tech-cn", "https://www.xinhuanet.com/tech/1?utm_source=test", "technology", "domestic"),
  candidate("finance-world", "https://www.reuters.com/markets/2", "finance", "international"),
  candidate("politics-cn", "https://www.gov.cn/policy/3", "politics", "domestic"),
  candidate("tech-world", "https://techcrunch.com/2030/05/14/4", "technology", "international"),
  candidate("finance-cn", "https://www.pbc.gov.cn/5", "finance", "domestic"),
  candidate("duplicate-url", "https://www.xinhuanet.com/tech/1?utm_campaign=duplicate", "technology", "domestic"),
  candidate("duplicate-title", "https://www.bbc.com/news/6", "politics", "international", "Synthetic tech-cn"),
  candidate("lookalike", "https://www.reuters.com.evil.invalid/7", "politics", "international"),
];

describe("daily news candidate validation", () => {
  it("allowlists exact trusted domains, deduplicates, and selects a five-item mixed digest", () => {
    const selected = selectTopFive(mixedCandidates);

    expect(selected).toHaveLength(5);
    expect(new Set(selected.map((item) => item.category))).toEqual(
      new Set(["technology", "finance", "politics"]),
    );
    expect(new Set(selected.map((item) => item.scope))).toEqual(
      new Set(["domestic", "international"]),
    );
    expect(selected.map((item) => item.id)).not.toContain("lookalike");
    expect(selected.map((item) => item.id)).not.toContain("duplicate-url");
    expect(selected.map((item) => item.id)).not.toContain("duplicate-title");
  });

  it("rejects a partial result when the required category or scope mix is unavailable", () => {
    expect(() => selectTopFive(mixedCandidates.slice(0, 2))).toThrowError(
      new DailyNewsValidationError("candidate_mix_unavailable"),
    );
  });

  it("requires exactly one bounded summary for every selected candidate", () => {
    const selected = selectTopFive(mixedCandidates);
    const valid = selected.map((item) => ({
      id: item.id,
      summary: `不超过 160 字的合成摘要：${item.id}`,
    }));

    expect(validateNewsSummaries(valid, selected)).toHaveLength(5);
    expect(() => validateNewsSummaries([
      ...valid.slice(0, 4),
      { ...valid[4], summary: "长".repeat(161) },
    ], selected)).toThrowError(/summary_invalid/);
    expect(() => validateNewsSummaries([
      ...valid,
      { id: "provider-invented", summary: "不应接受" },
    ], selected)).toThrowError(/summary_count_invalid/);
  });
});
