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
    resetPasswordForEmail: vi.fn(async () => ({
      data: {},
      error: null,
    })),
    updateUser: vi.fn(async () => ({
      data: { user: syntheticSession.user },
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

  it("signs in with a trimmed email and provider password flow", async () => {
    const port = createAuthPort();
    const auth = createSupabaseAuthService(port);

    await expect(
      auth.signIn(" owner@example.invalid ", "test-pw"),
    ).resolves.toEqual({
      userId: "synthetic-owner",
      email: "owner@example.invalid",
      expiresAt: "2027-01-15T08:00:00.000Z",
    });

    expect(port.signInWithPassword).toHaveBeenCalledWith({
      email: "owner@example.invalid",
      password: "test-pw",
    });
  });

  it("sends a password reset to the supplied redirect", async () => {
    const port = createAuthPort();
    const auth = createSupabaseAuthService(port);

    await auth.requestPasswordReset(
      " owner@example.invalid ",
      "https://preview.example.invalid/auth/recovery",
    );

    expect(port.resetPasswordForEmail).toHaveBeenCalledWith(
      "owner@example.invalid",
      { redirectTo: "https://preview.example.invalid/auth/recovery" },
    );
  });

  it("updates a password through the provider", async () => {
    const port = createAuthPort();
    const auth = createSupabaseAuthService(port);

    await auth.updatePassword("test-pw");

    expect(port.updateUser).toHaveBeenCalledWith({
      password: "test-pw",
    });
  });

  it("rejects a successful sign-in response without a session", async () => {
    const auth = createSupabaseAuthService(
      createAuthPort({
        signInWithPassword: vi.fn(async () => ({
          data: { session: null },
          error: null,
        })),
      }),
    );

    await expect(
      auth.signIn("owner@example.invalid", "test-pw"),
    ).rejects.toThrow("Password sign-in did not create a session");
  });

  it("propagates provider failures for password operations", async () => {
    const authError = new Error("synthetic provider failure");
    const signInAuth = createSupabaseAuthService(
      createAuthPort({
        signInWithPassword: vi.fn(async () => ({
          data: { session: null },
          error: authError,
        })),
      }),
    );
    await expect(
      signInAuth.signIn("owner@example.invalid", "test-pw"),
    ).rejects.toBe(authError);

    const resetAuth = createSupabaseAuthService(
      createAuthPort({
        resetPasswordForEmail: vi.fn(async () => ({
          data: {},
          error: authError,
        })),
      }),
    );
    await expect(
      resetAuth.requestPasswordReset(
        "owner@example.invalid",
        "https://preview.example.invalid/auth/recovery",
      ),
    ).rejects.toBe(authError);

    const updateAuth = createSupabaseAuthService(
      createAuthPort({
        updateUser: vi.fn(async () => ({
          data: { user: null },
          error: authError,
        })),
      }),
    );
    await expect(
      updateAuth.updatePassword("test-pw"),
    ).rejects.toBe(authError);
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
