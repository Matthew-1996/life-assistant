// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  createLifeConsoleSupabaseClient,
  resolveSupabaseConfig,
} from "../../src/supabase/client";

describe("Life Console Supabase browser client", () => {
  it("loads only the URL and publishable key", () => {
    expect(
      resolveSupabaseConfig({
        VITE_SUPABASE_URL: "https://synthetic.supabase.invalid/",
        VITE_SUPABASE_PUBLISHABLE_KEY: "public-test-key",
      }),
    ).toEqual({
      url: "https://synthetic.supabase.invalid",
      publishableKey: "public-test-key",
    });
  });

  it("returns null when Supabase is intentionally unconfigured", () => {
    expect(resolveSupabaseConfig({})).toBeNull();
  });

  it("fails closed for partial or secret-bearing configuration", () => {
    expect(() =>
      resolveSupabaseConfig({
        VITE_SUPABASE_URL: "https://synthetic.supabase.invalid",
      }),
    ).toThrow("Supabase browser configuration is incomplete");

    expect(() =>
      resolveSupabaseConfig({
        VITE_SUPABASE_URL: "https://synthetic.supabase.invalid",
        VITE_SUPABASE_PUBLISHABLE_KEY: "public-test-key",
        VITE_SUPABASE_SECRET_KEY: "must-not-enter-the-browser",
      }),
    ).toThrow("Supabase secret keys are not allowed in browser configuration");
  });

  it("uses the publishable key and leaves database retry disabled", async () => {
    const requests: Request[] = [];
    const syntheticFetch: typeof fetch = async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(
        JSON.stringify({
          code: "synthetic_transient",
          message: "synthetic transient",
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const client = createLifeConsoleSupabaseClient(
      {
        url: "https://synthetic.supabase.invalid",
        publishableKey: "public-test-key",
      },
      syntheticFetch,
    );

    await client.from("profiles").select("*");

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(
      "https://synthetic.supabase.invalid/rest/v1/profiles?select=*",
    );
    expect(requests[0].headers.get("apikey")).toBe("public-test-key");
    expect(requests[0].headers.get("authorization")).toBe(
      "Bearer public-test-key",
    );
  });
});
