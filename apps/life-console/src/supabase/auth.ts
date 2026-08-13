interface SupabaseUserLike {
  id: string;
  email?: string | null;
}

interface SupabaseSessionLike {
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

function normalizedEmail(email: string): string {
  return email.trim();
}

export function createSupabaseAuthService(
  auth: SupabaseAuthPort,
): LifeConsoleAuthService {
  return {
    async session() {
      const { data, error } = await auth.getSession();
      if (error) throw error;
      return mapSession(data.session);
    },

    async signIn(email, password) {
      const { data, error } = await auth.signInWithPassword({
        email: normalizedEmail(email),
        password,
      });
      if (error) throw error;
      const session = mapSession(data.session);
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
    },

    subscribe(listener) {
      const { data } = auth.onAuthStateChange((_event, session) => {
        listener(mapSession(session));
      });
      return () => data.subscription.unsubscribe();
    },
  };
}
