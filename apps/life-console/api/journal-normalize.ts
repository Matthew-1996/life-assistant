import { normalizeJournalRequest } from "../src/server/journal-normalization-service.js";

interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
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
  const method = request.method ?? "GET";
  const canHaveBody = method !== "GET" && method !== "HEAD";
  const body = !canHaveBody || request.body === undefined
    ? undefined
    : typeof request.body === "string"
      ? request.body
      : JSON.stringify(request.body);
  return new Request("https://life-console.invalid/api/journal-normalize", {
    method,
    headers,
    body,
  });
}

async function sendWebResponse(
  response: VercelResponse,
  webResponse: Response,
): Promise<void> {
  response.statusCode = webResponse.status;
  webResponse.headers.forEach((value, name) => response.setHeader(name, value));
  response.end(await webResponse.text());
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  const environment = {
    supabaseUrl: process.env.VITE_SUPABASE_URL ?? "",
    supabasePublishableKey:
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
    deepSeekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  };
  await sendWebResponse(
    response,
    await normalizeJournalRequest(toWebRequest(request), environment),
  );
}
