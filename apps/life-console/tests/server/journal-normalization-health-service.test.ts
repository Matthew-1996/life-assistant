// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { journalNormalizationHealthRequest } from "../../src/server/journal-normalization-health-service";
import { DeepSeekNormalizationError } from "../../src/server/deepseek-normalizer";

const environment = {
  supabaseUrl: "https://synthetic-project.supabase.co",
  supabasePublishableKey: "sb_publishable_synthetic_only",
  deepSeekApiKey: "synthetic-server-key",
};

function request(authorization = "Bearer synthetic-owner-token") {
  return new Request("https://synthetic.example.invalid/api/journal-normalize-health", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "x-vercel-id": "iad1::synthetic-request",
    },
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

  it.each([
    ["provider_key_unavailable", "provider_auth_or_billing"],
    ["provider_http_401", "provider_auth_or_billing"],
    ["provider_http_402", "provider_auth_or_billing"],
    ["provider_http_403", "provider_auth_or_billing"],
    ["provider_http_429", "provider_rate_limited"],
    ["provider_http_500", "provider_server_error"],
    ["provider_http_400", "provider_request_rejected"],
    ["provider_timeout", "provider_timeout"],
    ["provider_invalid_json", "provider_invalid_json"],
    ["provider_contract_rejected", "provider_contract_rejected"],
    ["provider_unavailable", "provider_unavailable"],
  ])("maps %s to the safe health reason %s", async (code, reason) => {
    const response = await journalNormalizationHealthRequest(
      request(), environment, {
        verifyBearer: vi.fn(async () => true),
        normalize: vi.fn(async () => {
          throw new DeepSeekNormalizationError(code);
        }),
      },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "provider_unavailable",
      reason,
    });
  });

  it("separates auth outages from invalid sessions", async () => {
    const response = await journalNormalizationHealthRequest(
      request(), environment, {
        verifyBearer: vi.fn(async () => {
          throw new Error("synthetic auth outage");
        }),
        normalize: vi.fn(),
      },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "provider_unavailable",
      reason: "auth_unavailable",
    });
  });

  it("logs only a bounded redacted event", async () => {
    const log = vi.fn();
    const response = await journalNormalizationHealthRequest(
      request(), environment, {
        verifyBearer: vi.fn(async () => true),
        normalize: vi.fn(async () => {
          throw new DeepSeekNormalizationError("provider_http_429");
        }),
        log,
        now: vi.fn()
          .mockReturnValueOnce(1_000)
          .mockReturnValueOnce(1_025),
      },
    );
    expect(response.status).toBe(503);
    expect(log).toHaveBeenCalledWith({
      route: "/api/journal-normalize-health",
      reason: "provider_rate_limited",
      http_status: 503,
      duration_ms: 25,
      request_id: "iad1::synthetic-request",
    });
    const serialized = JSON.stringify(log.mock.calls);
    expect(serialized).not.toContain("synthetic-owner-token");
    expect(serialized).not.toContain("synthetic-server-key");
    expect(serialized).not.toContain("合成日记");
  });
});
