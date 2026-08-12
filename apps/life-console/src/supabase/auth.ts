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
  signInWithOtp(options: {
    email: string;
    options: { shouldCreateUser: false };
  }): Promise<AuthResult<unknown>>;
  verifyOtp(options: {
    email: string;
    token: string;
    type: "email";
  }): Promise<
    AuthResult<{
      user: SupabaseUserLike | null;
      session: SupabaseSessionLike | null;
    }>
  >;
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
  requestOtp(email: string): Promise<void>;
  verifyOtp(email: string, token: string): Promise<AuthSession>;
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

    async requestOtp(email) {
      const { error } = await auth.signInWithOtp({
        email: normalizedEmail(email),
        options: { shouldCreateUser: false },
      });
      if (error) throw error;
    },

    async verifyOtp(email, token) {
      if (!/^\d{6}$/.test(token)) {
        throw new Error("OTP must contain exactly 6 digits");
      }
      const { data, error } = await auth.verifyOtp({
        email: normalizedEmail(email),
        token,
        type: "email",
      });
      if (error) throw error;
      const session = mapSession(data.session);
      if (!session) {
        throw new Error("OTP verification did not create a session");
      }
      return session;
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
