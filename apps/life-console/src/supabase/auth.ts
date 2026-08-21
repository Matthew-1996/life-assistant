interface SupabaseUserLike {
  id: string;
  email?: string | null;
}

interface SupabaseSessionLike {
  access_token?: string;
  user: SupabaseUserLike;
  expires_at?: number;
}

interface AuthResult<T> {
  data: T;
  error: Error | null;
}

export interface SupabaseAuthPort {
  getSession(): Promise<AuthResult<{ session: SupabaseSessionLike | null }>>;
  signInWithPassword(options: {
    email: string;
    password: string;
  }): Promise<AuthResult<{ session: SupabaseSessionLike | null }>>;
  resetPasswordForEmail(
    email: string,
    options: { redirectTo: string },
  ): Promise<AuthResult<unknown>>;
  updateUser(attributes: {
    password: string;
  }): Promise<AuthResult<{ user: SupabaseUserLike | null }>>;
  signOut(): Promise<{ error: Error | null }>;
  onAuthStateChange(
    listener: (
      event: string,
      session: SupabaseSessionLike | null,
    ) => void,
  ): {
    data: {
      subscription: {
        unsubscribe(): void;
      };
    };
  };
}

export interface AuthSession {
  userId: string;
  email: string | null;
  expiresAt: string | null;
}

export interface LifeConsoleAuthService {
  session(): Promise<AuthSession | null>;
  getAccessToken(): Promise<string | null>;
  signIn(email: string, password: string): Promise<AuthSession>;
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
  subscribe(listener: (session: AuthSession | null) => void): () => void;
}

function mapSession(
  session: SupabaseSessionLike | null,
): AuthSession | null {
  if (!session) return null;
  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    expiresAt: session.expires_at === undefined
      ? null
      : new Date(session.expires_at * 1_000).toISOString(),
  };
}

function accessToken(session: SupabaseSessionLike | null): string | null {
  const value = session?.access_token;
  return typeof value === "string" && value ? value : null;
}

function normalizedEmail(email: string): string {
  return email.trim();
}

export function createSupabaseAuthService(
  auth: SupabaseAuthPort,
): LifeConsoleAuthService {
  let currentAccessToken: string | null = null;
  let currentSession: AuthSession | null = null;
  let hasAuthState = false;
  let authRevision = 0;
  const tokenWaiters = new Set<(token: string | null) => void>();

  function commitSession(
    session: SupabaseSessionLike | null,
  ): AuthSession | null {
    authRevision += 1;
    hasAuthState = true;
    currentAccessToken = accessToken(session);
    currentSession = mapSession(session);
    for (const resolve of tokenWaiters) resolve(currentAccessToken);
    tokenWaiters.clear();
    return currentSession;
  }

  return {
    async session() {
      const revisionAtStart = authRevision;
      const { data, error } = await auth.getSession();
      if (authRevision !== revisionAtStart) return currentSession;
      if (error) throw error;
      return commitSession(data.session);
    },

    async getAccessToken() {
      if (hasAuthState) {
        if (currentAccessToken || !currentSession) return currentAccessToken;
        const userIdAtStart = currentSession.userId;
        const { data, error } = await auth.getSession();
        if (
          currentAccessToken
          || !currentSession
          || currentSession.userId !== userIdAtStart
        ) {
          return currentAccessToken;
        }
        if (error) throw error;
        const storedSession = mapSession(data.session);
        if (!storedSession || storedSession.userId !== userIdAtStart) {
          return currentAccessToken;
        }
        commitSession(data.session);
        return currentAccessToken;
      }
      const revisionAtStart = authRevision;
      let resolveEvent!: (token: string | null) => void;
      const authEvent = new Promise<string | null>((resolve) => {
        resolveEvent = resolve;
        tokenWaiters.add(resolve);
      });
      const storedSession = auth.getSession().then(({ data, error }) => {
        if (authRevision !== revisionAtStart) return currentAccessToken;
        if (error) throw error;
        commitSession(data.session);
        return currentAccessToken;
      });
      try {
        return await Promise.race([authEvent, storedSession]);
      } finally {
        tokenWaiters.delete(resolveEvent);
      }
    },

    async signIn(email, password) {
      const revisionAtStart = authRevision;
      const { data, error } = await auth.signInWithPassword({
        email: normalizedEmail(email),
        password,
      });
      if (error) throw error;
      const session = authRevision === revisionAtStart
        ? commitSession(data.session)
        : currentSession;
      if (!session) {
        throw new Error("Password sign-in did not create a session");
      }
      return session;
    },

    async requestPasswordReset(email, redirectTo) {
      const { error } = await auth.resetPasswordForEmail(
        normalizedEmail(email),
        { redirectTo },
      );
      if (error) throw error;
    },

    async updatePassword(password) {
      const { error } = await auth.updateUser({ password });
      if (error) throw error;
    },

    async signOut() {
      const { error } = await auth.signOut();
      if (error) throw error;
      commitSession(null);
    },

    subscribe(listener) {
      let active = true;
      const { data } = auth.onAuthStateChange((event, session) => {
        if (!active) return;
        if (event === "INITIAL_SESSION" && !session) return;
        listener(commitSession(session));
      });
      return () => {
        active = false;
        data.subscription.unsubscribe();
      };
    },
  };
}
