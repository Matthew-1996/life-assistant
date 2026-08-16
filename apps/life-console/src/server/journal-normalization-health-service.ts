import { createClient } from "@supabase/supabase-js";

import type { JournalNormalizationEnvironment } from "./journal-normalization-service.js";
import {
  DeepSeekNormalizationError,
  requestDeepSeekNormalization,
} from "./deepseek-normalizer.js";

const SYNTHETIC_JOURNAL =
  "合成日记：今天整理了书桌，感觉轻松，希望明天继续保持。";

export type HealthFailureReason =
  | "auth_unavailable"
  | "provider_auth_or_billing"
  | "provider_rate_limited"
  | "provider_server_error"
  | "provider_request_rejected"
  | "provider_timeout"
  | "provider_invalid_json"
  | "provider_contract_rejected"
  | "provider_unavailable";

interface HealthLogEvent {
  route: "/api/journal-normalize-health";
  reason: HealthFailureReason | null;
  http_status: 200 | 503;
  duration_ms: number;
  request_id: string | null;
}

interface HealthDependencies {
  verifyBearer(
    bearer: string,
    environment: JournalNormalizationEnvironment,
  ): Promise<boolean>;
  normalize: typeof defaultNormalize;
  log?(event: HealthLogEvent): void;
  now?(): number;
}

function response(
  status: number,
  value: string,
  reason?: HealthFailureReason,
): Response {
  return Response.json(reason ? { status: value, reason } : { status: value }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function safeReason(error: unknown): HealthFailureReason {
  if (!(error instanceof DeepSeekNormalizationError)) {
    return "provider_unavailable";
  }
  if (
    error.code === "provider_key_unavailable"
    || /^provider_http_(401|402|403)$/.test(error.code)
  ) {
    return "provider_auth_or_billing";
  }
  if (error.code === "provider_http_429") return "provider_rate_limited";
  if (/^provider_http_5\d\d$/.test(error.code)) return "provider_server_error";
  if (/^provider_http_\d\d\d$/.test(error.code)) {
    return "provider_request_rejected";
  }
  if (error.code === "provider_timeout") return "provider_timeout";
  if (error.code === "provider_invalid_json") return "provider_invalid_json";
  if (error.code === "provider_contract_rejected") {
    return "provider_contract_rejected";
  }
  return "provider_unavailable";
}

function boundedRequestId(request: Request): string | null {
  const value = request.headers.get("x-vercel-id");
  return value ? value.slice(0, 128) : null;
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
  log: (event) => console.log(JSON.stringify(event)),
  now: Date.now,
};

export async function journalNormalizationHealthRequest(
  request: Request,
  environment: JournalNormalizationEnvironment,
  dependencies: HealthDependencies = defaults,
): Promise<Response> {
  if (request.method !== "POST") return response(405, "method_not_allowed");
  const bearer = bearerToken(request);
  if (!bearer) return response(401, "unauthenticated");
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const log = dependencies.log;
  const emit = (
    reason: HealthFailureReason | null,
    httpStatus: HealthLogEvent["http_status"],
  ) => log?.({
    route: "/api/journal-normalize-health",
    reason,
    http_status: httpStatus,
    duration_ms: Math.max(0, now() - startedAt),
    request_id: boundedRequestId(request),
  });
  try {
    if (!await dependencies.verifyBearer(bearer, environment)) {
      return response(401, "unauthenticated");
    }
  } catch {
    emit("auth_unavailable", 503);
    return response(503, "provider_unavailable", "auth_unavailable");
  }
  try {
    await dependencies.normalize({
      rawText: SYNTHETIC_JOURNAL,
      contextEntities: [],
      contextRevisions: {},
    }, environment);
    emit(null, 200);
    return response(200, "provider_ok");
  } catch (error) {
    const reason = safeReason(error);
    emit(reason, 503);
    return response(503, "provider_unavailable", reason);
  }
}
