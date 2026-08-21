// @vitest-environment node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import ownerHandler from "../../api/daily-news";
import cronHandler from "../../api/cron/daily-news";
import type { DailyNewsResult } from "../../src/domain/daily-news";
import {
  dailyNewsCronRequest,
  dailyNewsOwnerRequest,
} from "../../src/server/daily-news-service";
import {
  createSupabaseProductionVercelConfig,
} from "../../scripts/supabase-candidate-config.mjs";

const empty: DailyNewsResult = { state: "empty", retryable: true };
const emptyExecution = {
  result: empty,
  diagnostics: {
    discoverySource: "none" as const,
    errorCode: null,
    failureStage: null,
  },
};
const service = {
  getDigest: vi.fn(async () => empty),
  getDigestWithDiagnostics: vi.fn(async () => emptyExecution),
};

const productionEnvironment = {
  VERCEL_ENV: "production",
  VERCEL_PROJECT_NAME: "life-console-production",
  VERCEL_PROJECT_PRODUCTION_URL: "project-wpabq.vercel.app",
  VITE_SUPABASE_URL: "https://synthetic-project.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_only",
  CRON_SECRET: "synthetic-cron-secret-at-least-16",
  DEEPSEEK_API_KEY: "synthetic-deepseek-server-key",
};

describe("daily news Vercel requests", () => {
  it("keeps both deployed wrappers fail-closed before any external work", async () => {
    const ownerResponse = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    const cronResponse = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    };

    await ownerHandler({ method: "GET", headers: {} }, ownerResponse);
    await cronHandler({ method: "GET", headers: {} }, cronResponse);

    expect(ownerResponse.statusCode).toBe(401);
    expect(cronResponse.statusCode).toBe(401);
  });

  it("requires an exact Cron bearer before invoking the service", async () => {
    const serviceFactory = vi.fn(() => service);
    const unauthorized = await dailyNewsCronRequest(
      new Request("https://life-console.invalid/api/cron/daily-news"),
      { cronSecret: "synthetic-cron-secret-at-least-16" },
      { service: serviceFactory },
    );
    const wrong = await dailyNewsCronRequest(
      new Request("https://life-console.invalid/api/cron/daily-news", {
        headers: { authorization: "Bearer wrong" },
      }),
      { cronSecret: "synthetic-cron-secret-at-least-16" },
      { service: serviceFactory },
    );

    expect(unauthorized.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(serviceFactory).not.toHaveBeenCalled();
    expect(service.getDigest).not.toHaveBeenCalled();
  });

  it("requires a verified Owner JWT before reading or rebuilding", async () => {
    const verifyBearer = vi.fn(async () => false);
    const serviceFactory = vi.fn(() => service);
    const response = await dailyNewsOwnerRequest(
      new Request("https://life-console.invalid/api/daily-news?rebuild=1", {
        headers: { authorization: "Bearer synthetic-owner-jwt" },
      }),
      {
        supabasePublishableKey: "sb_publishable_synthetic_only",
        supabaseUrl: "https://synthetic-project.supabase.co",
      },
      { service: serviceFactory, verifyBearer },
    );

    expect(response.status).toBe(401);
    expect(verifyBearer).toHaveBeenCalledWith("synthetic-owner-jwt", expect.anything());
    expect(serviceFactory).not.toHaveBeenCalled();
    expect(service.getDigest).not.toHaveBeenCalled();
  });

  it("passes only the requested rebuild flag after Owner verification", async () => {
    const isolatedService = {
      getDigest: vi.fn(async () => empty),
      getDigestWithDiagnostics: vi.fn(async () => emptyExecution),
    };
    const response = await dailyNewsOwnerRequest(
      new Request("https://life-console.invalid/api/daily-news?rebuild=1", {
        headers: { authorization: "Bearer synthetic-owner-jwt" },
      }),
      {
        supabasePublishableKey: "sb_publishable_synthetic_only",
        supabaseUrl: "https://synthetic-project.supabase.co",
      },
      { service: isolatedService, verifyBearer: vi.fn(async () => true) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(isolatedService.getDigest).toHaveBeenCalledWith({ allowRebuild: true });
    await expect(response.json()).resolves.toEqual(empty);
  });
});

describe("daily news Vercel configuration", () => {
  it("type-checks both nested Vercel function entrypoints with NodeNext resolution", () => {
    const result = spawnSync(
      resolve(process.cwd(), "node_modules/.bin/tsc"),
      [
        "--noEmit",
        "--module", "NodeNext",
        "--moduleResolution", "NodeNext",
        "--target", "ES2022",
        "--lib", "ES2022,DOM,DOM.Iterable",
        "--esModuleInterop",
        "--allowSyntheticDefaultImports",
        "--resolveJsonModule",
        "--strict",
        "--skipLibCheck",
        "--types", "node",
        "api/daily-news.ts",
        "api/cron/daily-news.ts",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("keeps both cache endpoints in one region and runs at 07:00 Shanghai time", () => {
    const config = createSupabaseProductionVercelConfig(productionEnvironment);

    expect(config.crons).toEqual([
      { path: "/api/cron/daily-news", schedule: "0 23 * * *" },
    ]);
    expect(config.functions["api/daily-news.ts"].regions).toEqual(["hkg1"]);
    expect(config.functions["api/cron/daily-news.ts"].regions).toEqual(["hkg1"]);
    expect(config.functions["api/daily-news.ts"].maxDuration).toBe(60);
    expect(config.functions["api/cron/daily-news.ts"].maxDuration).toBe(60);
    expect(JSON.stringify(config)).not.toContain(productionEnvironment.CRON_SECRET);
    expect(JSON.stringify(config)).not.toContain(productionEnvironment.DEEPSEEK_API_KEY);
  });

  it("adds only the approved Unsplash host to the strict image policy", () => {
    const config = createSupabaseProductionVercelConfig(productionEnvironment);
    const csp = config.headers[0].headers.find((header) => (
      header.key === "Content-Security-Policy"
    ))?.value;

    expect(csp).toContain("img-src 'self' data: https://images.unsplash.com");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("*.unsplash.com");
  });

  it("rejects browser-exposed or undersized Cron secrets", () => {
    expect(() => createSupabaseProductionVercelConfig({
      ...productionEnvironment,
      CRON_SECRET: "too-short",
    })).toThrow(/at least 16/);
    expect(() => createSupabaseProductionVercelConfig({
      ...productionEnvironment,
      VITE_CRON_SECRET: "synthetic-browser-secret",
    })).toThrow(/server-only/);
  });
});
