import { createClient } from "@supabase/supabase-js";

import type { JournalNormalizationEnvironment } from "./journal-normalization-service.js";
import { requestDeepSeekNormalization } from "./deepseek-normalizer.js";

const SYNTHETIC_JOURNAL =
  "合成日记：今天整理了书桌，感觉轻松，希望明天继续保持。";

interface HealthDependencies {
  verifyBearer(
    bearer: string,
    environment: JournalNormalizationEnvironment,
  ): Promise<boolean>;
  normalize: typeof defaultNormalize;
}

function response(status: number, value: string): Response {
  return Response.json({ status: value }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(
    request.headers.get("authorization") ?? "",
  );
  return match?.[1] ?? null;
}

async function defaultVerifyBearer(
  bearer: string,
  environment: JournalNormalizationEnvironment,
): Promise<boolean> {
  const client = createClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  const { data, error } = await client.auth.getUser(bearer);
  return !error && Boolean(data.user);
}

async function defaultNormalize(
  input: {
    rawText: string;
    contextEntities: [];
    contextRevisions: Record<string, string>;
  },
  environment: JournalNormalizationEnvironment,
) {
  return await requestDeepSeekNormalization(input, {
    credential: environment.deepSeekApiKey,
    fetch: globalThis.fetch,
  });
}

const defaults: HealthDependencies = {
  verifyBearer: defaultVerifyBearer,
  normalize: defaultNormalize,
};

export async function journalNormalizationHealthRequest(
  request: Request,
  environment: JournalNormalizationEnvironment,
  dependencies: HealthDependencies = defaults,
): Promise<Response> {
  if (request.method !== "POST") return response(405, "method_not_allowed");
  const bearer = bearerToken(request);
  if (!bearer) return response(401, "unauthenticated");
  try {
    if (!await dependencies.verifyBearer(bearer, environment)) {
      return response(401, "unauthenticated");
    }
    await dependencies.normalize({
      rawText: SYNTHETIC_JOURNAL,
      contextEntities: [],
      contextRevisions: {},
    }, environment);
    return response(200, "provider_ok");
  } catch {
    return response(503, "provider_unavailable");
  }
}
