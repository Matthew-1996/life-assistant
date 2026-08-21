// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("exposes an authenticated-session failure as a deidentified closed state", async () => {
    const token = "must-not-appear-in-the-dom";
    const news = {
      getDigest: vi.fn(async () => {
        throw new Error("daily_news_unauthenticated");
      }),
    };

    const { container } = render(<DailyNewsPanel client={news} />);

    const panel = await screen.findByRole("region", { name: "每日新闻" });
    await waitFor(() => {
      expect(panel.getAttribute("data-news-load-state"))
        .toBe("auth-unavailable");
    });
    expect(screen.getByText("登录会话暂不可用，请重新登录后重试。")).toBeTruthy();
    expect(container.textContent).not.toContain(token);
    expect(container.textContent).not.toContain("daily_news_unauthenticated");
  });

  it("uses a distinct deidentified state for non-authentication failures", async () => {
    const providerMessage = "private upstream details";
    const news = {
      getDigest: vi.fn(async () => {
        throw new Error(providerMessage);
      }),
    };

    const { container } = render(<DailyNewsPanel client={news} />);

    const panel = await screen.findByRole("region", { name: "每日新闻" });
    await waitFor(() => {
      expect(panel.getAttribute("data-news-load-state")).toBe("error");
    });
    expect(screen.getByText("新闻摘要读取失败，请稍后重试。")).toBeTruthy();
    expect(container.textContent).not.toContain(providerMessage);
  });

  it("recovers from an unavailable session when the Owner explicitly retries", async () => {
    const news = {
      getDigest: vi.fn()
        .mockRejectedValueOnce(new Error("daily_news_unauthenticated"))
        .mockResolvedValueOnce({ digest, state: "success" as const }),
    };

    render(<DailyNewsPanel client={news} />);

    expect(await screen.findByText(
      "登录会话暂不可用，请重新登录后重试。",
    )).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByRole("heading", { name: "Title a" })).toBeTruthy();
    expect(news.getDigest).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("region", { name: "每日新闻" })
      .getAttribute("data-news-load-state")).toBe("success");
  });

  it("uses the AuthGate session to issue the authorized news request", async () => {
    const port = authPort();
    const auth = createSupabaseAuthService(port);
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
    expect(port.getSession).toHaveBeenCalledTimes(2);
  });

  it("recovers a stored token before news fetch when the UI event omits it", async () => {
    let authStateListener:
      | Parameters<SupabaseAuthPort["onAuthStateChange"]>[0]
      | undefined;
    const getSession = vi.fn(async () => ({
      data: { session: syntheticSession },
      error: null,
    }));
    const port = {
      ...authPort(),
      getSession,
      onAuthStateChange: vi.fn((listener) => {
        authStateListener = listener;
        return {
          data: { subscription: { unsubscribe: vi.fn() } },
        };
      }),
    } satisfies SupabaseAuthPort;
    const auth = createSupabaseAuthService(port);
    const fetch = vi.fn(async () => Response.json({ digest, state: "success" }));
    const news = createDailyNewsApiClient({
      fetch,
      getAccessToken: auth.getAccessToken,
    });

    render(
      <SupabaseAuthGate auth={auth}>
        <DailyNewsPanel client={news} />
      </SupabaseAuthGate>,
    );
    await act(async () => {
      authStateListener?.("SIGNED_IN", {
        ...syntheticSession,
        access_token: undefined,
      });
    });

    expect(await screen.findByRole("heading", { name: "Title a" })).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(getSession).toHaveBeenCalledTimes(2);
  });
});
