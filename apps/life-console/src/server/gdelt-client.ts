import type { DailyNewsCategory, DailyNewsScope } from "../domain/daily-news.js";
import type { PublicNewsCandidate } from "./daily-news-validator.js";

const GDELT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
const CATEGORY_QUERIES: Record<DailyNewsCategory, string> = {
  technology: "(technology OR artificial intelligence OR semiconductor)",
  finance: "(finance OR economy OR central bank OR markets)",
  politics: "(politics OR government OR election OR policy)",
};
const DOMESTIC_DOMAINS = ["gov.cn", "pbc.gov.cn", "xinhuanet.com", "news.cn"];

export class GdeltClientError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "GdeltClientError";
  }
}

export interface GdeltClientDependencies {
  fetch: typeof globalThis.fetch;
  endpoint?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bounded(value: unknown, maximum: number): string {
  return typeof value === "string" ? [...value.trim()].slice(0, maximum).join("") : "";
}

function normalizePublishedAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const gdelt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  const candidate = gdelt
    ? `${gdelt[1]}-${gdelt[2]}-${gdelt[3]}T${gdelt[4]}:${gdelt[5]}:${gdelt[6]}Z`
    : value;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function domainFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function domesticScope(hostname: string, country: unknown): DailyNewsScope {
  const domesticHost = DOMESTIC_DOMAINS.some((domain) => (
    hostname === domain || hostname.endsWith(`.${domain}`)
  ));
  const normalizedCountry = typeof country === "string" ? country.trim().toLowerCase() : "";
  return domesticHost || ["china", "people's republic of china", "中国"].includes(normalizedCountry)
    ? "domestic"
    : "international";
}

function candidateId(category: DailyNewsCategory, url: string): string {
  let hash = 14_695_981_039_346_656_037n;
  for (const byte of new TextEncoder().encode(url)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 1_099_511_628_211n);
  }
  return `${category}:${hash.toString(16).padStart(16, "0")}`;
}

async function responseText(
  response: Response,
  maximum: number,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    throw new GdeltClientError("gdelt_response_too_large");
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maximum) {
    throw new GdeltClientError("gdelt_response_too_large");
  }
  return new TextDecoder().decode(buffer);
}

async function discoverCategory(
  category: DailyNewsCategory,
  dependencies: GdeltClientDependencies,
): Promise<PublicNewsCandidate[]> {
  const endpoint = dependencies.endpoint ?? GDELT_ENDPOINT;
  if (endpoint !== GDELT_ENDPOINT) {
    throw new GdeltClientError("gdelt_endpoint_not_allowlisted");
  }
  const url = new URL(endpoint);
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", "75");
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("query", CATEGORY_QUERIES[category]);
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("timespan", "24h");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 8_000);
  let response: Response;
  try {
    response = await dependencies.fetch(url, { signal: controller.signal });
  } catch (error) {
    if ((error as { name?: unknown })?.name === "AbortError") {
      throw new GdeltClientError("gdelt_timeout");
    }
    throw new GdeltClientError("gdelt_unavailable");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new GdeltClientError(`gdelt_http_${response.status}`);

  let payload: unknown;
  try {
    payload = JSON.parse(await responseText(
      response,
      dependencies.maxResponseBytes ?? 1_000_000,
    )) as unknown;
  } catch (error) {
    if (error instanceof GdeltClientError) throw error;
    throw new GdeltClientError("gdelt_invalid_json");
  }
  if (!isRecord(payload) || !Array.isArray(payload.articles)) {
    throw new GdeltClientError("gdelt_invalid_response");
  }

  const candidates: PublicNewsCandidate[] = [];
  const requestedAt = (dependencies.now ?? (() => new Date()))().getTime();
  const earliest = requestedAt - 24 * 60 * 60 * 1_000;
  const latest = requestedAt + 5 * 60 * 1_000;
  for (const article of payload.articles.slice(0, 75)) {
    if (!isRecord(article)) continue;
    const title = bounded(article.title, 300);
    const urlValue = bounded(article.url, 2_048);
    const hostname = domainFromUrl(urlValue);
    const publishedAt = normalizePublishedAt(article.seendate ?? article.publishedAt);
    const publishedTimestamp = publishedAt ? Date.parse(publishedAt) : Number.NaN;
    if (
      !title
      || !hostname
      || !publishedAt
      || publishedTimestamp < earliest
      || publishedTimestamp > latest
    ) continue;
    candidates.push({
      id: candidateId(category, urlValue),
      category,
      description: bounded(article.description, 1_200),
      publishedAt,
      scope: domesticScope(hostname, article.sourcecountry),
      snippet: bounded(article.snippet, 1_200),
      source: bounded(article.domain, 120) || hostname,
      title,
      url: urlValue,
    });
  }
  return candidates;
}

export async function discoverGdeltCandidates(
  dependencies: GdeltClientDependencies,
): Promise<PublicNewsCandidate[]> {
  const categories: DailyNewsCategory[] = ["technology", "finance", "politics"];
  const results = await Promise.all(categories.map((category) => (
    discoverCategory(category, dependencies)
  )));
  return results.flat();
}
