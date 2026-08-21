interface SupabaseAccessTokenSession {
  access_token?: string;
}

interface SupabaseAccessTokenAuthPort {
  getSession(): Promise<{
    data: { session: SupabaseAccessTokenSession | null };
    error: Error | null;
  }>;
  onAuthStateChange(
    listener: (
      event: string,
      session: SupabaseAccessTokenSession | null,
    ) => void,
  ): {
    data: {
      subscription: {
        unsubscribe(): void;
      };
    };
  };
}

function accessToken(session: SupabaseAccessTokenSession | null): string | null {
  const value = session?.access_token;
  return typeof value === "string" && value ? value : null;
}

export function createSupabaseAccessTokenProvider(
  auth: SupabaseAccessTokenAuthPort,
) {
  let current = null as string | null;
  auth.onAuthStateChange((_event, session) => {
    current = accessToken(session);
  });

  return {
    async getAccessToken(): Promise<string | null> {
      if (current) return current;
      const { data: sessionData, error } = await auth.getSession();
      if (error) throw error;
      current = accessToken(sessionData.session);
      return current;
    },
  };
}
