// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createSupabaseAuthService,
  type SupabaseAuthPort,
} from "../../src/supabase/auth";

const syntheticSession = {
  access_token: "synthetic-access-token",
  refresh_token: "synthetic-refresh-token",
  expires_at: 1_800_000_000,
  user: {
    id: "synthetic-owner",
    email: "owner@example.invalid",
  },
};

function createAuthPort(
  overrides: Partial<SupabaseAuthPort> = {},
): SupabaseAuthPort {
  return {
    getSession: vi.fn(async () => ({
      data: { session: syntheticSession },
      error: null,
    })),
    signInWithPassword: vi.fn(async () => ({
      data: { session: syntheticSession },
      error: null,
    })),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
    updateUser: vi.fn(async () => ({
      data: { user: syntheticSession.user },
      error: null,
    })),
    signOut: vi.fn(async () => ({ error: null })),
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
    ...overrides,
  };
}

describe("Supabase Auth service", () => {
  it("maps the provider session without exposing tokens", async () => {
    const auth = createSupabaseAuthService(createAuthPort());

    const session = await auth.session();

    expect(session).toEqual({
      userId: "synthetic-owner",
      email: "owner@example.invalid",
      expiresAt: "2027-01-15T08:00:00.000Z",
    });
    expect(JSON.stringify(session)).not.toContain("synthetic-access-token");
    expect(JSON.stringify(session)).not.toContain("synthetic-refresh-token");
  });

  it("reads the provider's current session for every Owner API request", async () => {
    const refreshedSession = {
      ...syntheticSession,
      access_token: "refreshed-synthetic-access-token",
    };
    const getSession = vi.fn()
      .mockResolvedValueOnce({ data: { session: syntheticSession }, error: null })
      .mockResolvedValueOnce({ data: { session: refreshedSession }, error: null });
    const auth = createSupabaseAuthService(createAuthPort({ getSession }));

    await expect(auth.getAccessToken()).resolves.toBe("synthetic-access-token");
    await expect(auth.getAccessToken()).resolves.toBe(
      "refreshed-synthetic-access-token",
    );
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the provider has no current session or token", async () => {
    const emptyAuth = createSupabaseAuthService(createAuthPort({
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    }));
    const tokenlessAuth = createSupabaseAuthService(createAuthPort({
      getSession: vi.fn(async () => ({
        data: { session: { ...syntheticSession, access_token: undefined } },
        error: null,
      })),
    }));

    await expect(emptyAuth.session()).resolves.toBeNull();
    await expect(emptyAuth.getAccessToken()).resolves.toBeNull();
    await expect(tokenlessAuth.getAccessToken()).resolves.toBeNull();
  });

  it("propagates provider session errors without caching a fallback", async () => {
    const providerError = new Error("synthetic provider failure");
    const getSession = vi.fn()
      .mockResolvedValueOnce({ data: { session: null }, error: providerError })
      .mockResolvedValueOnce({ data: { session: syntheticSession }, error: null });
    const auth = createSupabaseAuthService(createAuthPort({ getSession }));

    await expect(auth.getAccessToken()).rejects.toBe(providerError);
    await expect(auth.getAccessToken()).resolves.toBe("synthetic-access-token");
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("uses provider session truth instead of an auth event token", async () => {
    let authStateListener:
      | Parameters<SupabaseAuthPort["onAuthStateChange"]>[0]
      | undefined;
    const getSession = vi.fn(async () => ({
      data: {
        session: {
          ...syntheticSession,
          access_token: "current-provider-access-token",
        },
      },
      error: null,
    }));
    const auth = createSupabaseAuthService(createAuthPort({
      getSession,
      onAuthStateChange: vi.fn((listener) => {
        authStateListener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    }));

    auth.subscribe(vi.fn());
    authStateListener?.("TOKEN_REFRESHED", {
      ...syntheticSession,
      access_token: "event-only-access-token",
    });

    await expect(auth.getAccessToken()).resolves.toBe(
      "current-provider-access-token",
    );
    expect(getSession).toHaveBeenCalledOnce();
  });

  it("signs in with a trimmed email and returns only the session projection", async () => {
    const port = createAuthPort();
    const auth = createSupabaseAuthService(port);

    await expect(auth.signIn(" owner@example.invalid ", "test-pw"))
      .resolves.toEqual({
        userId: "synthetic-owner",
        email: "owner@example.invalid",
        expiresAt: "2027-01-15T08:00:00.000Z",
      });

    expect(port.signInWithPassword).toHaveBeenCalledWith({
      email: "owner@example.invalid",
      password: "test-pw",
    });
    await expect(auth.getAccessToken()).resolves.toBe("synthetic-access-token");
    expect(port.getSession).toHaveBeenCalledOnce();
  });

  it("rejects a successful sign-in response without a session", async () => {
    const auth = createSupabaseAuthService(createAuthPort({
      signInWithPassword: vi.fn(async () => ({
        data: { session: null },
        error: null,
      })),
    }));

    await expect(auth.signIn("owner@example.invalid", "test-pw"))
      .rejects.toThrow("Password sign-in did not create a session");
  });

  it("sends password operations to the provider", async () => {
    const port = createAuthPort();
    const auth = createSupabaseAuthService(port);

    await auth.requestPasswordReset(
      " owner@example.invalid ",
      "https://preview.example.invalid/auth/recovery",
    );
    await auth.updatePassword("test-pw");

    expect(port.resetPasswordForEmail).toHaveBeenCalledWith(
      "owner@example.invalid",
      { redirectTo: "https://preview.example.invalid/auth/recovery" },
    );
    expect(port.updateUser).toHaveBeenCalledWith({ password: "test-pw" });
  });

  it("propagates provider failures for password operations", async () => {
    const providerError = new Error("synthetic provider failure");
    const auth = createSupabaseAuthService(createAuthPort({
      signInWithPassword: vi.fn(async () => ({
        data: { session: null },
        error: providerError,
      })),
      resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: providerError })),
      updateUser: vi.fn(async () => ({ data: { user: null }, error: providerError })),
    }));

    await expect(auth.signIn("owner@example.invalid", "test-pw"))
      .rejects.toBe(providerError);
    await expect(auth.requestPasswordReset(
      "owner@example.invalid",
      "https://preview.example.invalid/auth/recovery",
    )).rejects.toBe(providerError);
    await expect(auth.updatePassword("test-pw")).rejects.toBe(providerError);
  });

  it("maps auth events to deidentified sessions and releases the subscription", () => {
    const unsubscribe = vi.fn();
    let authStateListener:
      | Parameters<SupabaseAuthPort["onAuthStateChange"]>[0]
      | undefined;
    const auth = createSupabaseAuthService(createAuthPort({
      onAuthStateChange: vi.fn((listener) => {
        authStateListener = listener;
        return { data: { subscription: { unsubscribe } } };
      }),
    }));
    const listener = vi.fn();

    const stop = auth.subscribe(listener);
    authStateListener?.("INITIAL_SESSION", null);
    authStateListener?.("SIGNED_IN", syntheticSession);
    authStateListener?.("SIGNED_OUT", null);
    stop();
    authStateListener?.("SIGNED_IN", syntheticSession);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, {
      userId: "synthetic-owner",
      email: "owner@example.invalid",
      expiresAt: "2027-01-15T08:00:00.000Z",
    });
    expect(listener).toHaveBeenNthCalledWith(2, null);
    expect(JSON.stringify(listener.mock.calls)).not.toContain(
      "synthetic-access-token",
    );
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("delegates sign-out and then reads the provider's empty session", async () => {
    const getSession = vi.fn(async () => ({ data: { session: null }, error: null }));
    const port = createAuthPort({ getSession });
    const auth = createSupabaseAuthService(port);

    await auth.signOut();

    expect(port.signOut).toHaveBeenCalledOnce();
    await expect(auth.getAccessToken()).resolves.toBeNull();
    expect(getSession).toHaveBeenCalledOnce();
  });

  it("propagates sign-out failures", async () => {
    const providerError = new Error("synthetic sign-out failure");
    const auth = createSupabaseAuthService(createAuthPort({
      signOut: vi.fn(async () => ({ error: providerError })),
    }));

    await expect(auth.signOut()).rejects.toBe(providerError);
  });
});
