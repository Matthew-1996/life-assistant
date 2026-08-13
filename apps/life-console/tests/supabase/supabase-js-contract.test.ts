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
    const url = new URL(input.toString());
    requests.push({ url, init });
    const status = options.responses?.[responseIndex++] ?? 200;
    let responseBody = "{}";
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      responseBody = JSON.stringify({
        access_token: "synthetic-access-token",
        refresh_token: "synthetic-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user: { id: "synthetic-owner-id", email: "owner@example.invalid" },
      });
    } else if (url.pathname === "/auth/v1/user" && init.method === "PUT") {
      responseBody = JSON.stringify({
        id: "synthetic-owner-id",
        email: "owner@example.invalid",
      });
    } else if (url.pathname.startsWith("/auth/v1/")) {
      responseBody = "{}";
    } else {
      responseBody = "[]";
    }
    return new Response(
      status === 200 ? responseBody : '{"message":"synthetic"}',
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
  it("signs in with email and password without creating new users", async () => {
    const requests: CapturedRequest[] = [];
    const client = createSyntheticClient(requests);
    await client.auth.signInWithPassword({
      email: "owner@example.invalid",
      password: "synthetic-password",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe("/auth/v1/token");
    expect(requests[0].url.searchParams.get("grant_type")).toBe("password");
    expect(JSON.parse(requests[0].init.body as string)).toMatchObject({
      email: "owner@example.invalid",
      password: "synthetic-password",
      gotrue_meta_security: {},
    });
  });

  it("sends password reset emails with exact recovery redirect and PKCE flow", async () => {
    const requests: CapturedRequest[] = [];
    const client = createSyntheticClient(requests);
    await client.auth.resetPasswordForEmail("owner@example.invalid", {
      redirectTo: "https://preview.example.invalid/auth/recovery",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe("/auth/v1/recover");
    expect(requests[0].url.searchParams.get("redirect_to")).toBe(
      "https://preview.example.invalid/auth/recovery",
    );
    const body = JSON.parse(requests[0].init.body as string);
    expect(body.email).toBe("owner@example.invalid");
    expect(body).toHaveProperty("code_challenge");
    expect(body).toHaveProperty("code_challenge_method");
  });

  it("updates the password for an authenticated recovery session", async () => {
    const requests: CapturedRequest[] = [];
    const client = createSyntheticClient(requests);
    // Sign in first to establish a valid session (simulates recovery flow auth state)
    const signInResult = await client.auth.signInWithPassword({
      email: "owner@example.invalid",
      password: "temporary-password",
    });
    expect(signInResult.error).toBeNull();
    requests.length = 0;
    await client.auth.updateUser({ password: "new-synthetic-password" });

    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe("/auth/v1/user");
    expect(requests[0].init.method).toBe("PUT");
    expect(JSON.parse(requests[0].init.body as string)).toMatchObject({
      password: "new-synthetic-password",
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
