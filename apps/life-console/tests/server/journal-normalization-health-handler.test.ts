// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import handler from "../../api/journal-normalize-health";

const originalEnvironment = {
  supabaseUrl: process.env.VITE_SUPABASE_URL,
  supabaseKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  deepSeekKey: process.env.DEEPSEEK_API_KEY,
};

afterEach(() => {
  process.env.VITE_SUPABASE_URL = originalEnvironment.supabaseUrl;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = originalEnvironment.supabaseKey;
  process.env.DEEPSEEK_API_KEY = originalEnvironment.deepSeekKey;
  vi.restoreAllMocks();
});

describe("Vercel journal normalization health handler", () => {
  it("returns a redacted configuration reason when server variables are absent", async () => {
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const response = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await handler({
      method: "POST",
      headers: { "x-vercel-id": "iad1::synthetic-config-request" },
    }, response);

    expect(response.statusCode).toBe(503);
    expect(response.end).toHaveBeenCalledWith(JSON.stringify({
      status: "provider_unavailable",
      reason: "configuration_unavailable",
    }));
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      route: "/api/journal-normalize-health",
      reason: "configuration_unavailable",
      http_status: 503,
      duration_ms: expect.any(Number),
      request_id: "iad1::synthetic-config-request",
    });
  });
});
