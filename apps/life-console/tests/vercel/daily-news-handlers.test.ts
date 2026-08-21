// @vitest-environment node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ownerHandler from "../../api/daily-news";
import runsHandler from "../../api/daily-news-runs";
import cronHandler from "../../api/cron/daily-news";
import type { DailyNewsResult } from "../../src/domain/daily-news";
import {
  dailyNewsCronRequest,
  dailyNewsOwnerRequest,
} from "../../src/server/daily-news-service";
import {
  dailyNewsRunsOwnerRequest,
  type DailyNewsRunStorePort,
} from "../../src/server/daily-news-runs";
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

function runStore(): DailyNewsRunStorePort {
  return {
    start: vi.fn(async () => ({ indexed: true })),
    finish: vi.fn(async () => ({ indexed: true })),
    get: vi.fn(async () => undefined),
    listRecent: vi.fn(async () => []),
  };
}

const productionEnvironment = {
  VERCEL_ENV: "production",
  VERCEL_PROJECT_NAME: "life-console-production",
  VERCEL_PROJECT_PRODUCTION_URL: "project-wpabq.vercel.app",
  VITE_SUPABASE_URL: "https://synthetic-project.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_only",
  CRON_SECRET: "synthetic-cron-secret-at-least-16",
  DEEPSEEK_API_KEY: "synthetic-deepseek-server-key",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
    const runsResponse = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    };

    await ownerHandler({ method: "GET", headers: {} }, ownerResponse);
    await cronHandler({ method: "GET", headers: {} }, cronResponse);
    await runsHandler({ method: "GET", headers: {} }, runsResponse);

    expect(ownerResponse.statusCode).toBe(401);
    expect(cronResponse.statusCode).toBe(401);
    expect(runsResponse.statusCode).toBe(401);
  });

  it("requires an exact Cron bearer before invoking the service", async () => {
    const serviceFactory = vi.fn(() => service);
    const runs = runStore();
    const unauthorized = await dailyNewsCronRequest(
      new Request("https://life-console.invalid/api/cron/daily-news"),
      { cronSecret: "synthetic-cron-secret-at-least-16" },
      { service: serviceFactory, runs },
    );
    const wrong = await dailyNewsCronRequest(
      new Request("https://life-console.invalid/api/cron/daily-news", {
        headers: { authorization: "Bearer wrong" },
      }),
      { cronSecret: "synthetic-cron-secret-at-least-16" },
      { service: serviceFactory, runs },
    );

    expect(unauthorized.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(serviceFactory).not.toHaveBeenCalled();
    expect(service.getDigest).not.toHaveBeenCalled();
    expect(runs.start).not.toHaveBeenCalled();
    expect(runs.finish).not.toHaveBeenCalled();
  });

  it("records an authorized Cron run before and after generation", async () => {
    const runs = runStore();
    const isolatedService = {
      getDigest: vi.fn(async () => empty),
      getDigestWithDiagnostics: vi.fn(async () => emptyExecution),
    };
    const times = [
      new Date("2030-05-14T01:30:00.000Z"),
      new Date("2030-05-14T01:31:00.000Z"),
    ];
    const response = await dailyNewsCronRequest(
      new Request("https://life-console.invalid/api/cron/daily-news", {
        headers: { authorization: "Bearer synthetic-cron-secret-at-least-16" },
      }),
      { cronSecret: "synthetic-cron-secret-at-least-16" },
      {
        service: isolatedService,
        runs,
        now: () => times.shift() ?? new Date("2030-05-14T01:31:00.000Z"),
        randomId: () => "run-synthetic",
      },
    );

    expect(vi.mocked(runs.start).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runs.finish).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(runs.start).toHaveBeenCalledWith({
      runId: "run-synthetic",
      startedAt: "2030-05-14T01:30:00.000Z",
    });
    expect(runs.finish).toHaveBeenCalledWith("run-synthetic", {
      state: "empty",
      finishedAt: "2030-05-14T01:31:00.000Z",
      discoverySource: "none",
      failureStage: null,
      errorCode: null,
      digestDate: null,
      digestGeneratedAt: null,
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("x-life-console-run-id")).toBe("run-synthetic");
    expect(response.headers.get("x-life-console-run-receipt")).toBe("stored");
    await expect(response.json()).resolves.toEqual(empty);
  });

  it("logs only sanitized completion diagnostics for an empty Cron run", async () => {
    const runs = runStore();
    const isolatedService = {
      getDigest: vi.fn(async () => empty),
      getDigestWithDiagnostics: vi.fn(async () => ({
        result: empty,
        diagnostics: {
          discoverySource: "publisher_fallback" as const,
          failureStage: "summarization" as const,
          errorCode: "provider_http_401",
        },
      })),
    };

    await dailyNewsCronRequest(
      new Request("https://life-console.invalid/api/cron/daily-news", {
        headers: { authorization: "Bearer synthetic-cron-secret-at-least-16" },
      }),
      { cronSecret: "synthetic-cron-secret-at-least-16" },
      {
        service: isolatedService,
        runs,
        now: () => new Date("2030-05-14T01:30:00.000Z"),
        randomId: () => "run-synthetic",
      },
    );

    expect(console.info).toHaveBeenCalledOnce();
    expect(console.info).toHaveBeenCalledWith(JSON.stringify({
      event: "daily_news_cron_completed",
      runId: "run-synthetic",
      state: "empty",
      discoverySource: "publisher_fallback",
      failureStage: "summarization",
      errorCode: "provider_http_401",
      digestDate: null,
      digestGeneratedAt: null,
      receiptAvailable: true,
    }));
    expect(JSON.stringify(vi.mocked(console.info).mock.calls))
      .not.toContain("synthetic-cron-secret-at-least-16");
  });

  it("normalizes unsafe completion diagnostics at the log boundary", async () => {
    const privateDiagnostic = "private raw provider response";
    const unsafeService = {
      getDigest: vi.fn(async () => empty),
      getDigestWithDiagnostics: vi.fn(async () => ({
        result: empty,
        diagnostics: {
          discoverySource: "private source" as never,
          failureStage: "private stage" as never,
          errorCode: privateDiagnostic,
        },
      })),
    };

    await dailyNewsCronRequest(
      new Request("https://life-console.invalid/api/cron/daily-news", {
        headers: { authorization: "Bearer synthetic-cron-secret-at-least-16" },
      }),
      { cronSecret: "synthetic-cron-secret-at-least-16" },
      {
        service: unsafeService,
        runs: runStore(),
        now: () => new Date("2030-05-14T01:30:00.000Z"),
        randomId: () => "run-synthetic",
      },
    );

    expect(console.info).toHaveBeenCalledWith(JSON.stringify({
      event: "daily_news_cron_completed",
      runId: "run-synthetic",
      state: "empty",
      discoverySource: "none",
      failureStage: null,
      errorCode: "invalid_diagnostics",
      digestDate: null,
      digestGeneratedAt: null,
      receiptAvailable: true,
    }));
    expect(JSON.stringify(vi.mocked(console.info).mock.calls))
      .not.toContain(privateDiagnostic);
  });

  it("keeps the news result when receipt persistence is unavailable", async () => {
    const runs = runStore();
    vi.mocked(runs.start).mockRejectedValueOnce(new Error("private cache outage"));
    const response = await dailyNewsCronRequest(
      new Request("https://life-console.invalid/api/cron/daily-news", {
        headers: { authorization: "Bearer synthetic-cron-secret-at-least-16" },
      }),
      { cronSecret: "synthetic-cron-secret-at-least-16" },
      {
        service,
        runs,
        now: () => new Date("2030-05-14T01:30:00.000Z"),
        randomId: () => "run-synthetic",
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("x-life-console-run-receipt")).toBe("unavailable");
    await expect(response.json()).resolves.toEqual(empty);
  });

  it("finishes the exact receipt when only the recent-run index is unavailable", async () => {
    const runs = runStore();
    vi.mocked(runs.start).mockResolvedValueOnce({ indexed: false });
    vi.mocked(runs.finish).mockResolvedValueOnce({ indexed: false });
    const response = await dailyNewsCronRequest(
      new Request("https://life-console.invalid/api/cron/daily-news", {
        headers: { authorization: "Bearer synthetic-cron-secret-at-least-16" },
      }),
      { cronSecret: "synthetic-cron-secret-at-least-16" },
      {
        service,
        runs,
        now: () => new Date("2030-05-14T01:30:00.000Z"),
        randomId: () => "run-synthetic",
      },
    );

    expect(runs.finish).toHaveBeenCalledOnce();
    expect(response.headers.get("x-life-console-run-receipt")).toBe("unavailable");
    await expect(response.json()).resolves.toEqual(empty);
  });

  it("finishes a failed receipt and returns a sanitized 503 on an uncaught service error", async () => {
    const runs = runStore();
    const failingService = {
      getDigest: vi.fn(async () => empty),
      getDigestWithDiagnostics: vi.fn(async () => {
        throw new Error("private service response");
      }),
    };
    const response = await dailyNewsCronRequest(
      new Request("https://life-console.invalid/api/cron/daily-news", {
        headers: { authorization: "Bearer synthetic-cron-secret-at-least-16" },
      }),
      { cronSecret: "synthetic-cron-secret-at-least-16" },
      {
        service: failingService,
        runs,
        now: () => new Date("2030-05-14T01:30:00.000Z"),
        randomId: () => "run-synthetic",
      },
    );

    expect(runs.finish).toHaveBeenCalledWith("run-synthetic", expect.objectContaining({
      state: "failed",
      failureStage: null,
      errorCode: "news_service_unavailable",
    }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private service response");
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

  it("returns recent sanitized Cron receipts only after Owner verification", async () => {
    const runs = runStore();
    vi.mocked(runs.listRecent).mockResolvedValueOnce([{
      schemaVersion: 1,
      runId: "run-synthetic",
      startedAt: "2030-05-14T01:30:00.000Z",
      state: "running",
    }]);
    const response = await dailyNewsRunsOwnerRequest(
      new Request("https://life-console.invalid/api/daily-news-runs", {
        headers: { authorization: "Bearer synthetic-owner-jwt" },
      }),
      {
        supabasePublishableKey: "sb_publishable_synthetic_only",
        supabaseUrl: "https://synthetic-project.supabase.co",
      },
      { runs, verifyBearer: vi.fn(async () => true) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      runs: [{
        schemaVersion: 1,
        runId: "run-synthetic",
        startedAt: "2030-05-14T01:30:00.000Z",
        state: "running",
      }],
    });

    vi.mocked(runs.get).mockResolvedValueOnce({
      schemaVersion: 1,
      runId: "run-synthetic",
      startedAt: "2030-05-14T01:30:00.000Z",
      state: "running",
    });
    const exact = await dailyNewsRunsOwnerRequest(
      new Request("https://life-console.invalid/api/daily-news-runs?runId=run-synthetic", {
        headers: { authorization: "Bearer synthetic-owner-jwt" },
      }),
      {
        supabasePublishableKey: "sb_publishable_synthetic_only",
        supabaseUrl: "https://synthetic-project.supabase.co",
      },
      { runs, verifyBearer: vi.fn(async () => true) },
    );
    await expect(exact.json()).resolves.toEqual({
      run: expect.objectContaining({ runId: "run-synthetic" }),
    });
  });

  it("fails the runs endpoint closed for missing JWT, auth outage, and non-GET", async () => {
    const runs = runStore();
    const environment = {
      supabasePublishableKey: "sb_publishable_synthetic_only",
      supabaseUrl: "https://synthetic-project.supabase.co",
    };
    const missing = await dailyNewsRunsOwnerRequest(
      new Request("https://life-console.invalid/api/daily-news-runs"),
      environment,
      { runs, verifyBearer: vi.fn(async () => true) },
    );
    const unavailable = await dailyNewsRunsOwnerRequest(
      new Request("https://life-console.invalid/api/daily-news-runs", {
        headers: { authorization: "Bearer synthetic-owner-jwt" },
      }),
      environment,
      { runs, verifyBearer: vi.fn(async () => { throw new Error("auth outage"); }) },
    );
    const wrongMethod = await dailyNewsRunsOwnerRequest(
      new Request("https://life-console.invalid/api/daily-news-runs", { method: "POST" }),
      environment,
      { runs, verifyBearer: vi.fn(async () => true) },
    );

    expect(missing.status).toBe(401);
    expect(unavailable.status).toBe(503);
    expect(wrongMethod.status).toBe(405);
    expect(runs.listRecent).not.toHaveBeenCalled();
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
        "api/daily-news-runs.ts",
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
    expect(config.functions["api/daily-news-runs.ts"].regions).toEqual(["hkg1"]);
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
