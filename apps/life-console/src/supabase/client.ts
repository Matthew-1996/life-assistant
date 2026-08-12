import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

export interface SupabaseBrowserConfig {
  url: string;
  publishableKey: string;
}

type BrowserEnvironment = Record<string, string | boolean | undefined>;

const forbiddenSecretKeys = [
  "VITE_SUPABASE_SECRET_KEY",
  "VITE_SUPABASE_SERVICE_ROLE_KEY",
] as const;

function environmentValue(
  environment: BrowserEnvironment,
  key: string,
): string | undefined {
  const value = environment[key];
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function normalizeProjectOrigin(value: string): string {
  const url = new URL(value);
  const localHttp = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("Supabase URL must use HTTPS");
  }
  if (
    url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("Supabase URL must be an exact project origin");
  }
  return url.origin;
}

export function resolveSupabaseConfig(
  environment: BrowserEnvironment,
): SupabaseBrowserConfig | null {
  if (forbiddenSecretKeys.some((key) => environmentValue(environment, key))) {
    throw new Error(
      "Supabase secret keys are not allowed in browser configuration",
    );
  }

  const url = environmentValue(environment, "VITE_SUPABASE_URL");
  const publishableKey = environmentValue(
    environment,
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  );
  if (!url && !publishableKey) return null;
  if (!url || !publishableKey) {
    throw new Error("Supabase browser configuration is incomplete");
  }
  if (publishableKey.startsWith("sb_secret_")) {
    throw new Error(
      "Supabase secret keys are not allowed in browser configuration",
    );
  }

  return {
    url: normalizeProjectOrigin(url),
    publishableKey,
  };
}

export function createLifeConsoleSupabaseClient(
  config: SupabaseBrowserConfig,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): SupabaseClient {
  return createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
    db: {
      retry: false,
    },
    global: {
      fetch: fetchImplementation,
    },
  });
}
