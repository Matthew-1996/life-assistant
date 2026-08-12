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
    signInWithOtp: vi.fn(async () => ({
      data: { user: null, session: null },
      error: null,
    })),
    verifyOtp: vi.fn(async () => ({
      data: { user: syntheticSession.user, session: syntheticSession },
      error: null,
    })),
    signOut: vi.fn(async () => ({ error: null })),
    onAuthStateChange: vi.fn(() => ({
      data: {
        subscription: {
          unsubscribe: vi.fn(),
        },
      },
    })),
    ...overrides,
  };
}

describe("Supabase Auth service", () => {
  it("maps the current session without exposing tokens", async () => {
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

  it("requests an email OTP without allowing user creation", async () => {
    const port = createAuthPort();
    const auth = createSupabaseAuthService(port);

    await auth.requestOtp(" owner@example.invalid ");

    expect(port.signInWithOtp).toHaveBeenCalledWith({
      email: "owner@example.invalid",
      options: { shouldCreateUser: false },
    });
  });

  it("verifies exactly six numeric OTP digits and returns a safe session", async () => {
    const port = createAuthPort();
    const auth = createSupabaseAuthService(port);

    await expect(
      auth.verifyOtp("owner@example.invalid", "12345"),
    ).rejects.toThrow("OTP must contain exactly 6 digits");
    expect(port.verifyOtp).not.toHaveBeenCalled();

    const session = await auth.verifyOtp(
      " owner@example.invalid ",
      "123456",
    );

    expect(port.verifyOtp).toHaveBeenCalledWith({
      email: "owner@example.invalid",
      token: "123456",
      type: "email",
    });
    expect(session).toEqual({
      userId: "synthetic-owner",
      email: "owner@example.invalid",
      expiresAt: "2027-01-15T08:00:00.000Z",
    });
  });

  it("propagates Auth failures and rejects verification without a session", async () => {
    const authError = new Error("synthetic auth failure");
    const requestAuth = createSupabaseAuthService(
      createAuthPort({
        signInWithOtp: vi.fn(async () => ({
          data: { user: null, session: null },
          error: authError,
        })),
      }),
    );
    await expect(
      requestAuth.requestOtp("owner@example.invalid"),
    ).rejects.toBe(authError);

    const verifyAuth = createSupabaseAuthService(
      createAuthPort({
        verifyOtp: vi.fn(async () => ({
          data: { user: null, session: null },
          error: null,
        })),
      }),
    );
    await expect(
      verifyAuth.verifyOtp("owner@example.invalid", "123456"),
    ).rejects.toThrow("OTP verification did not create a session");
  });

  it("signs out and releases the Supabase subscription", async () => {
    const unsubscribe = vi.fn();
    let authStateListener:
      | ((event: string, session: typeof syntheticSession | null) => void)
      | undefined;
    const port = createAuthPort({
      onAuthStateChange: vi.fn((listener) => {
        authStateListener = listener;
        return {
          data: {
            subscription: { unsubscribe },
          },
        };
      }),
    });
    const auth = createSupabaseAuthService(port);
    const listener = vi.fn();

    const stop = auth.subscribe(listener);
    authStateListener?.("SIGNED_IN", syntheticSession);
    authStateListener?.("SIGNED_OUT", null);
    stop();
    await auth.signOut();

    expect(listener).toHaveBeenNthCalledWith(1, {
      userId: "synthetic-owner",
      email: "owner@example.invalid",
      expiresAt: "2027-01-15T08:00:00.000Z",
    });
    expect(listener).toHaveBeenNthCalledWith(2, null);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(port.signOut).toHaveBeenCalledOnce();
  });
});
