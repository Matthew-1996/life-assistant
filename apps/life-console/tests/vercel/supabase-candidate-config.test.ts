// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  candidateContentSecurityPolicy,
  createSupabaseCandidateVercelConfig,
} from "../../scripts/supabase-candidate-config.mjs";

const syntheticEnvironment = {
  VERCEL_ENV: "preview",
  VITE_SUPABASE_URL: "https://synthetic-project.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_only",
};

describe("Supabase candidate Vercel configuration", () => {
  it("allows only the exact synthetic HTTPS and WSS origins", () => {
    const csp = candidateContentSecurityPolicy(syntheticEnvironment);
    expect(csp).toContain(
      "connect-src 'self' https://synthetic-project.supabase.co wss://synthetic-project.supabase.co",
    );
    expect(csp).not.toContain("*.supabase.co");
    expect(csp).not.toContain("sb_publishable_");
  });

  it("builds only the isolated Supabase candidate Preview", () => {
    const config = createSupabaseCandidateVercelConfig(syntheticEnvironment);
    expect(config.buildCommand).toBe("npm run build:supabase-candidate");
    expect(config.outputDirectory).toBe("dist/supabase-candidate");
    expect(JSON.stringify(config)).not.toContain("service_role");
    expect(JSON.stringify(config)).not.toContain("sb_secret_");
  });

  it("accepts legacy JWT anon keys (eyJ-prefixed)", () => {
    const legacyEnv = {
      ...syntheticEnvironment,
      VITE_SUPABASE_PUBLISHABLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.synthetic.payload",
    };
    const config = createSupabaseCandidateVercelConfig(legacyEnv);
    expect(config.buildCommand).toBe("npm run build:supabase-candidate");
  });

  it("fails closed for missing, malformed, secret, or Production input", () => {
    expect(() => createSupabaseCandidateVercelConfig({})).toThrow();
    expect(() => createSupabaseCandidateVercelConfig({
      ...syntheticEnvironment,
      VITE_SUPABASE_URL: "https://example.com",
    })).toThrow(/exact HTTPS Supabase project origin/);
    expect(() => createSupabaseCandidateVercelConfig({
      ...syntheticEnvironment,
      VITE_SUPABASE_URL: "https://nested.synthetic-project.supabase.co",
    })).toThrow(/exact HTTPS Supabase project origin/);
    expect(() => createSupabaseCandidateVercelConfig({
      ...syntheticEnvironment,
      VITE_SUPABASE_URL: "https://synthetic-project.supabase.co:8443",
    })).toThrow(/exact HTTPS Supabase project origin/);
    expect(() => createSupabaseCandidateVercelConfig({
      ...syntheticEnvironment,
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_forbidden",
    })).toThrow(/secret key/);
    expect(() => createSupabaseCandidateVercelConfig({
      ...syntheticEnvironment,
      VITE_SUPABASE_PUBLISHABLE_KEY: "invalid_format_key",
    })).toThrow(/publishable key or legacy anon JWT/);
    expect(() => createSupabaseCandidateVercelConfig({
      ...syntheticEnvironment,
      VERCEL_ENV: "production",
    })).toThrow(/Preview/);
  });
});
