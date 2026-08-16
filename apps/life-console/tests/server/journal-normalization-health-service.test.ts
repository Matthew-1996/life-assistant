// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { journalNormalizationHealthRequest } from "../../src/server/journal-normalization-health-service";

const environment = {
  supabaseUrl: "https://synthetic-project.supabase.co",
  supabasePublishableKey: "sb_publishable_synthetic_only",
  deepSeekApiKey: "synthetic-server-key",
};

function request(authorization = "Bearer synthetic-owner-token") {
  return new Request("https://synthetic.example.invalid/api/journal-normalize-health", {
    method: "POST",
    headers: { Authorization: authorization },
  });
}

describe("journal normalization provider health", () => {
  it("requires a verified user before contacting the provider", async () => {
    const verifyBearer = vi.fn(async () => false);
    const normalize = vi.fn();
    const response = await journalNormalizationHealthRequest(
      request(), environment, { verifyBearer, normalize },
    );
    expect(response.status).toBe(401);
    expect(normalize).not.toHaveBeenCalled();
  });

  it("uses only a built-in synthetic journal and returns a redacted result", async () => {
    const normalize = vi.fn(async () => ({
      title: "合成标题", summary: "合成摘要", facts: [], feelings: [],
      people: [], places: [], themes: [], planning_clues: [],
      inferences: [], tags: [],
    }));
    const response = await journalNormalizationHealthRequest(
      request(), environment, {
        verifyBearer: vi.fn(async () => true),
        normalize,
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "provider_ok" });
    expect(normalize).toHaveBeenCalledWith(expect.objectContaining({
      rawText: expect.stringContaining("合成"),
      contextEntities: [],
      contextRevisions: {},
    }), environment);
  });
});
