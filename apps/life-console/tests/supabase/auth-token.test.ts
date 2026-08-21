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
});
