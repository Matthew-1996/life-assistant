// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDailyNewsApiClient } from "../../src/api/daily-news-client";
import type { DailyNewsDigest } from "../../src/domain/daily-news";
import { SupabaseAuthGate } from "../../src/features/auth/SupabaseAuthGate";
import { DailyNewsPanel } from "../../src/features/news/DailyNewsPanel";
import {
  createSupabaseAuthService,
  type SupabaseAuthPort,
} from "../../src/supabase/auth";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const syntheticSession = {
  access_token: "synthetic-owner-access",
  expires_at: 1_800_000_000,
  user: {
    email: "owner@example.invalid",
    id: "synthetic-owner",
  },
};

const digest: DailyNewsDigest = {
  date: "2030-05-14",
  generatedAt: "2030-05-14T01:00:00.000Z",
  items: [
    ["a", "technology", "domestic", "https://www.xinhuanet.com/a"],
    ["b", "finance", "international", "https://www.reuters.com/b"],
    ["c", "politics", "domestic", "https://www.gov.cn/c"],
    ["d", "technology", "international", "https://techcrunch.com/d"],
    ["e", "finance", "domestic", "https://www.pbc.gov.cn/e"],
  ].map(([id, category, scope, url]) => ({
    category: category as "technology" | "finance" | "politics",
    id,
    publishedAt: "2030-05-14T00:00:00.000Z",
    scope: scope as "domestic" | "international",
    source: new URL(url).hostname,
    summary: `摘要 ${id}`,
    title: `Title ${id}`,
    url,
  })),
};

function authPort(): SupabaseAuthPort {
  return {
    getSession: vi.fn(async () => ({
      data: { session: syntheticSession },
      error: null,
    })),
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
    signInWithPassword: vi.fn(async () => ({
      data: { session: syntheticSession },
      error: null,
    })),
    signOut: vi.fn(async () => ({ error: null })),
    updateUser: vi.fn(async () => ({
      data: { user: syntheticSession.user },
      error: null,
    })),
  };
}

describe("Owner news authentication lifecycle", () => {
  it("uses the AuthGate session to issue the authorized news request", async () => {
    const auth = createSupabaseAuthService(authPort());
    let requestedPath: string | URL | Request | undefined;
    let requestedInit: RequestInit | undefined;
    const fetch = vi.fn(async (
      path: string | URL | Request,
      init?: RequestInit,
    ) => {
      requestedPath = path;
      requestedInit = init;
      return Response.json({ digest, state: "success" });
    });
    const news = createDailyNewsApiClient({
      fetch,
      getAccessToken: auth.getAccessToken,
    });

    render(
      <SupabaseAuthGate auth={auth}>
        <DailyNewsPanel client={news} />
      </SupabaseAuthGate>,
    );

    expect(await screen.findByRole("heading", { name: "Title a" })).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(requestedPath).toBe("/api/daily-news?rebuild=1");
    expect(new Headers(requestedInit?.headers).get("authorization"))
      .toBe("Bearer synthetic-owner-access");
  });
});
