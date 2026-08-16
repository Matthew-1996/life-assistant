import { journalNormalizationHealthRequest } from "../src/server/journal-normalization-health-service.js";

interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface VercelResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

function toWebRequest(request: VercelRequest): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return new Request(
    "https://life-console.invalid/api/journal-normalize-health",
    { method: request.method ?? "GET", headers },
  );
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  const startedAt = Date.now();
  const environment = {
    supabaseUrl: process.env.VITE_SUPABASE_URL ?? "",
    supabasePublishableKey:
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
    deepSeekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  };
  const result = !environment.supabaseUrl
      || !environment.supabasePublishableKey
      || !environment.deepSeekApiKey
    ? Response.json({
      status: "provider_unavailable",
      reason: "configuration_unavailable",
    }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    })
    : await journalNormalizationHealthRequest(
      toWebRequest(request),
      environment,
    );
  if (
    result.status === 503
    && (!environment.supabaseUrl
      || !environment.supabasePublishableKey
      || !environment.deepSeekApiKey)
  ) {
    const requestId = request.headers["x-vercel-id"];
    console.log(JSON.stringify({
      route: "/api/journal-normalize-health",
      reason: "configuration_unavailable",
      http_status: 503,
      duration_ms: Math.max(0, Date.now() - startedAt),
      request_id: Array.isArray(requestId)
        ? requestId[0]?.slice(0, 128) ?? null
        : requestId?.slice(0, 128) ?? null,
    }));
  }
  response.statusCode = result.status;
  result.headers.forEach((value, name) => response.setHeader(name, value));
  response.end(await result.text());
}
