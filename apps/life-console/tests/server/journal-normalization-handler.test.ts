// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import handler from "../../api/journal-normalize";

const originalEnvironment = {
  supabaseUrl: process.env.VITE_SUPABASE_URL,
  supabaseKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  deepSeekKey: process.env.DEEPSEEK_API_KEY,
};

afterEach(() => {
  process.env.VITE_SUPABASE_URL = originalEnvironment.supabaseUrl;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = originalEnvironment.supabaseKey;
  process.env.DEEPSEEK_API_KEY = originalEnvironment.deepSeekKey;
});

describe("Vercel journal normalization handler", () => {
  it("adapts the Node request and writes the Web response to Vercel", async () => {
    process.env.VITE_SUPABASE_URL = "https://synthetic-project.supabase.co";
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_synthetic_only";
    process.env.DEEPSEEK_API_KEY = "synthetic-server-key";

    const headers = new Map<string, string>();
    const response = {
      statusCode: 200,
      setHeader: vi.fn((name: string, value: string) => {
        headers.set(name.toLowerCase(), value);
      }),
      end: vi.fn(),
    };

    await handler({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: {
        journal_id: 31,
        source_revision: 2,
        task_key: "task:synthetic-unauthenticated",
      },
    }, response);

    expect(response.statusCode).toBe(401);
    expect(headers.get("cache-control")).toBe("no-store");
    expect(response.end).toHaveBeenCalledWith('{"status":"unauthenticated"}');
  });
});
