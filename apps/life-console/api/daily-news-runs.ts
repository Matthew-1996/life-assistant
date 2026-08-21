import {
  createRuntimeDailyNewsRunStore,
  dailyNewsRunsOwnerRequest,
  type DailyNewsRunStorePort,
} from "../src/server/daily-news-runs.js";

interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  url?: string;
}

interface VercelResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

let runs: DailyNewsRunStorePort | undefined;

function runtimeRuns(): DailyNewsRunStorePort {
  runs ??= createRuntimeDailyNewsRunStore();
  return runs;
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
  const url = new URL(
    request.url ?? "/api/daily-news-runs",
    "https://life-console.invalid",
  );
  return new Request(url, { method: request.method ?? "GET", headers });
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  const result = await dailyNewsRunsOwnerRequest(
    toWebRequest(request),
    {
      supabaseUrl: process.env.VITE_SUPABASE_URL ?? "",
      supabasePublishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
    },
    { runs: runtimeRuns() },
  );
  response.statusCode = result.status;
  result.headers.forEach((value, name) => response.setHeader(name, value));
  response.end(await result.text());
}
