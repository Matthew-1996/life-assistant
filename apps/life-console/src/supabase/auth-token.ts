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
  let authRevision = 0;
  const eventWaiters = new Set<(token: string | null) => void>();
  auth.onAuthStateChange((_event, session) => {
    authRevision += 1;
    current = accessToken(session);
    for (const resolve of eventWaiters) resolve(current);
    eventWaiters.clear();
  });

  return {
    async getAccessToken(): Promise<string | null> {
      if (current) return current;
      const revisionAtStart = authRevision;
      let resolveEvent!: (token: string | null) => void;
      const authEvent = new Promise<string | null>((resolve) => {
        resolveEvent = resolve;
        eventWaiters.add(resolve);
      });
      const storedSession = auth.getSession().then(({ data, error }) => {
        if (authRevision !== revisionAtStart) return current;
        if (error) throw error;
        current = accessToken(data.session);
        return current;
      });
      try {
        return await Promise.race([authEvent, storedSession]);
      } finally {
        eventWaiters.delete(resolveEvent);
      }
    },
  };
}
