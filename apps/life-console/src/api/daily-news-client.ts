import type { DailyNewsClient, DailyNewsResult } from "../domain/daily-news";
import { validateDailyNewsDigest } from "../server/daily-news-validator";

interface DailyNewsApiClientDependencies {
  fetch: typeof globalThis.fetch;
  getAccessToken(): Promise<string | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseResult(value: unknown): DailyNewsResult {
  if (!isRecord(value) || typeof value.state !== "string") {
    throw new Error("daily_news_invalid_response");
  }
  try {
    if (value.state === "success" && Object.keys(value).length === 2) {
      return { state: "success", digest: validateDailyNewsDigest(value.digest) };
    }
    if (
      value.state === "stale"
      && Object.keys(value).length === 3
      && typeof value.failedAt === "string"
      && Number.isFinite(Date.parse(value.failedAt))
    ) {
      return {
        state: "stale",
        digest: validateDailyNewsDigest(value.digest),
        failedAt: new Date(value.failedAt).toISOString(),
      };
    }
    if (
      value.state === "empty"
      && value.retryable === true
      && Object.keys(value).length === 2
    ) {
      return { state: "empty", retryable: true };
    }
  } catch {
    throw new Error("daily_news_invalid_response");
  }
  throw new Error("daily_news_invalid_response");
}

export function createDailyNewsApiClient(
  dependencies: DailyNewsApiClientDependencies,
): DailyNewsClient {
  return {
    async getDigest({ allowRebuild }) {
      const token = await dependencies.getAccessToken();
      if (!token) throw new Error("daily_news_unauthenticated");
      const query = allowRebuild ? "?rebuild=1" : "";
      const response = await dependencies.fetch(`/api/daily-news${query}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`daily_news_http_${response.status}`);
      return parseResult(await response.json());
    },
  };
}
