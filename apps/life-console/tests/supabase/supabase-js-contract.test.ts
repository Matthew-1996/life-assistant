// @vitest-environment node

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { candidateContentSecurityPolicy } from "../../scripts/supabase-candidate-config.mjs";

interface CapturedRequest {
  url: URL;
  init: RequestInit;
}

function createSyntheticClient(
  requests: CapturedRequest[],
  options: { retry?: boolean; responses?: number[] } = {},
) {
  let responseIndex = 0;
  const syntheticFetch: typeof fetch = async (input, init = {}) => {
    requests.push({ url: new URL(input.toString()), init });
    const isAuth = input.toString().includes("/auth/v1/");
    const status = options.responses?.[responseIndex++] ?? 200;
    return new Response(
      status === 200 ? (isAuth ? "{}" : "[]") : '{"message":"synthetic"}',
      {
      status,
      headers: { "content-type": "application/json" },
      },
    );
  };
  return createClient(
    "https://synthetic.supabase.invalid",
    "public-test-key",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      db: { retry: options.retry },
      global: { fetch: syntheticFetch },
    },
  );
}

describe("supabase-js browser contract feasibility", () => {
  it("disables unknown-user creation in the OTP request", async () => {
    const requests: CapturedRequest[] = [];
    const client = createSyntheticClient(requests);
    await client.auth.signInWithOtp({
      email: "owner@example.invalid",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://preview.example.invalid/auth/callback",
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe("/auth/v1/otp");
    expect(requests[0].url.searchParams.get("redirect_to")).toBe(
      "https://preview.example.invalid/auth/callback",
    );
    expect(JSON.parse(requests[0].init.body as string)).toMatchObject({
      email: "owner@example.invalid",
      create_user: false,
    });
  });

  it("uses only the publishable key for an unauthenticated Data API request", async () => {
    const requests: CapturedRequest[] = [];
    const client = createSyntheticClient(requests);
    await client.from("journals").select("id,revision").limit(1);

    const headers = new Headers(requests[0].init.headers);
    expect(requests[0].url.pathname).toBe("/rest/v1/journals");
    expect(headers.get("apikey")).toBe("public-test-key");
    expect(headers.get("authorization")).toBe("Bearer public-test-key");
    expect(JSON.stringify(requests[0])).not.toContain("service_role");
    expect(JSON.stringify(requests[0])).not.toContain("sb_secret_");
  });

  it("allows only the exact Supabase origins in the candidate CSP", () => {
    const csp = candidateContentSecurityPolicy({
      VITE_SUPABASE_URL: "https://synthetic.supabase.co",
    });
    expect(csp).toContain(
      "connect-src 'self' https://synthetic.supabase.co wss://synthetic.supabase.co",
    );
    expect(csp).not.toContain("*.supabase.co");
  });

  it("can disable automatic Data API retries so repository code owns write semantics", async () => {
    const requests: CapturedRequest[] = [];
    const client = createSyntheticClient(requests, {
      retry: false,
      responses: [503, 200],
    });
    await client.from("journals").select("id");
    expect(requests).toHaveLength(1);
  });
});
