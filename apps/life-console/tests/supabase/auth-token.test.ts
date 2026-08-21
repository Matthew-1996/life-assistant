import { describe, expect, it, vi } from "vitest";

import { createSupabaseAccessTokenProvider } from "../../src/supabase/auth-token";

describe("Supabase access token provider", () => {
  it("uses the authenticated event token without competing for getSession", async () => {
    let listener:
      | ((event: string, session: { access_token?: string } | null) => void)
      | undefined;
    const getSession = vi.fn(async () => await new Promise<never>(() => undefined));
    const provider = createSupabaseAccessTokenProvider({
      getSession,
      onAuthStateChange(nextListener) {
        listener = nextListener;
        return {
          data: {
            subscription: { unsubscribe: vi.fn() },
          },
        };
      },
    });

    listener?.("SIGNED_IN", { access_token: "synthetic-owner-access" });

    await expect(provider.getAccessToken()).resolves.toBe(
      "synthetic-owner-access",
    );
    expect(getSession).not.toHaveBeenCalled();
  });

  it("settles an in-flight session fallback when an auth event arrives", async () => {
    let listener:
      | ((event: string, session: { access_token?: string } | null) => void)
      | undefined;
    const provider = createSupabaseAccessTokenProvider({
      getSession: vi.fn(async () => await new Promise<never>(() => undefined)),
      onAuthStateChange(nextListener) {
        listener = nextListener;
        return {
          data: {
            subscription: { unsubscribe: vi.fn() },
          },
        };
      },
    });
    const token = provider.getAccessToken();
    listener?.("SIGNED_IN", { access_token: "late-auth-event-access" });

    await expect(token).resolves.toBe("late-auth-event-access");
  }, 250);

  it("does not let a late session response overwrite a newer auth event", async () => {
    let listener:
      | ((event: string, session: { access_token?: string } | null) => void)
      | undefined;
    let resolveSession:
      | ((value: {
          data: { session: { access_token?: string } | null };
          error: Error | null;
        }) => void)
      | undefined;
    const getSession = vi.fn(
      async () =>
        await new Promise<{
          data: { session: { access_token?: string } | null };
          error: Error | null;
        }>((resolve) => {
          resolveSession = resolve;
        }),
    );
    const provider = createSupabaseAccessTokenProvider({
      getSession,
      onAuthStateChange(nextListener) {
        listener = nextListener;
        return {
          data: {
            subscription: { unsubscribe: vi.fn() },
          },
        };
      },
    });

    const token = provider.getAccessToken();
    listener?.("SIGNED_IN", { access_token: "new-auth-event-access" });
    resolveSession?.({ data: { session: null }, error: null });

    await expect(token).resolves.toBe("new-auth-event-access");
  });

  it("returns the refreshed token after a token refresh event", async () => {
    let listener:
      | ((event: string, session: { access_token?: string } | null) => void)
      | undefined;
    const provider = createSupabaseAccessTokenProvider({
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange(nextListener) {
        listener = nextListener;
        return {
          data: {
            subscription: { unsubscribe: vi.fn() },
          },
        };
      },
    });

    listener?.("SIGNED_IN", { access_token: "initial-access" });
    await expect(provider.getAccessToken()).resolves.toBe("initial-access");
    listener?.("TOKEN_REFRESHED", { access_token: "refreshed-access" });

    await expect(provider.getAccessToken()).resolves.toBe("refreshed-access");
  });

  it("keeps a sign-out event authoritative over an in-flight session read", async () => {
    let listener:
      | ((event: string, session: { access_token?: string } | null) => void)
      | undefined;
    let resolveSession:
      | ((value: {
          data: { session: { access_token?: string } | null };
          error: Error | null;
        }) => void)
      | undefined;
    const provider = createSupabaseAccessTokenProvider({
      getSession: vi.fn(
        async () =>
          await new Promise<{
            data: { session: { access_token?: string } | null };
            error: Error | null;
          }>((resolve) => {
            resolveSession = resolve;
          }),
      ),
      onAuthStateChange(nextListener) {
        listener = nextListener;
        return {
          data: {
            subscription: { unsubscribe: vi.fn() },
          },
        };
      },
    });

    const token = provider.getAccessToken();
    listener?.("SIGNED_OUT", null);
    resolveSession?.({
      data: { session: { access_token: "stale-session-access" } },
      error: null,
    });

    await expect(token).resolves.toBeNull();
  });
});
