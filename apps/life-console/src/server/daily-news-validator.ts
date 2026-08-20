import type {
  DailyNewsCategory,
  DailyNewsDigest,
  DailyNewsItem,
  DailyNewsScope,
} from "../domain/daily-news.js";

const TRUSTED_DOMAINS = [
  "gov.cn",
  "pbc.gov.cn",
  "xinhuanet.com",
  "news.cn",
  "whitehouse.gov",
  "state.gov",
  "federalreserve.gov",
  "ecb.europa.eu",
  "bankofengland.co.uk",
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "ft.com",
  "techcrunch.com",
  "theverge.com",
] as const;

const CATEGORIES: DailyNewsCategory[] = ["technology", "finance", "politics"];
const SCOPES: DailyNewsScope[] = ["domestic", "international"];

export interface PublicNewsCandidate {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  category: DailyNewsCategory;
  scope: DailyNewsScope;
  snippet: string;
  description: string;
}

export interface DailyNewsSummary {
  id: string;
  summary: string;
}

export class DailyNewsValidationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DailyNewsValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && [...value.trim()].length <= maximum;
}

function optionalBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && [...value].length <= maximum;
}

function trustedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return TRUSTED_DOMAINS.some((domain) => (
    normalized === domain || normalized.endsWith(`.${domain}`)
  ));
}

function canonicalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !trustedHostname(url.hostname)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ["fbclid", "gclid"].includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function titleFingerprint(title: string): string {
  return title.normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function validCandidate(candidate: PublicNewsCandidate): boolean {
  return /^[A-Za-z0-9:_-]{1,128}$/.test(candidate.id)
    && boundedText(candidate.title, 300)
    && boundedText(candidate.source, 120)
    && optionalBoundedText(candidate.snippet, 1_200)
    && optionalBoundedText(candidate.description, 1_200)
    && Number.isFinite(Date.parse(candidate.publishedAt))
    && CATEGORIES.includes(candidate.category)
    && SCOPES.includes(candidate.scope)
    && canonicalUrl(candidate.url) !== null;
}

function uniqueTrustedCandidates(
  candidates: readonly PublicNewsCandidate[],
): PublicNewsCandidate[] {
  const urls = new Set<string>();
  const titles = new Set<string>();
  const ids = new Set<string>();
  const result: PublicNewsCandidate[] = [];
  for (const candidate of candidates) {
    if (!validCandidate(candidate)) continue;
    const url = canonicalUrl(candidate.url);
    const title = titleFingerprint(candidate.title);
    if (!url || !title || ids.has(candidate.id) || urls.has(url) || titles.has(title)) {
      continue;
    }
    ids.add(candidate.id);
    urls.add(url);
    titles.add(title);
    result.push({
      ...candidate,
      description: candidate.description.slice(0, 1_200),
      snippet: candidate.snippet.slice(0, 1_200),
      title: candidate.title.trim(),
      url,
    });
  }
  return result;
}

export function selectTopFive(
  candidates: readonly PublicNewsCandidate[],
): PublicNewsCandidate[] {
  const available = uniqueTrustedCandidates(candidates);
  const selected: PublicNewsCandidate[] = [];
  const selectedIds = new Set<string>();
  const take = (candidate: PublicNewsCandidate | undefined) => {
    if (!candidate || selectedIds.has(candidate.id) || selected.length >= 5) return;
    selected.push(candidate);
    selectedIds.add(candidate.id);
  };

  for (const category of CATEGORIES) {
    take(available.find((candidate) => candidate.category === category));
  }
  for (const scope of SCOPES) {
    take(available.find((candidate) => candidate.scope === scope));
  }
  for (const candidate of available) take(candidate);

  if (
    selected.length !== 5
    || CATEGORIES.some((category) => !selected.some((item) => item.category === category))
    || SCOPES.some((scope) => !selected.some((item) => item.scope === scope))
  ) {
    throw new DailyNewsValidationError("candidate_mix_unavailable");
  }
  return selected;
}

export function validateNewsSummaries(
  value: unknown,
  candidates: readonly PublicNewsCandidate[],
): DailyNewsSummary[] {
  if (!Array.isArray(value) || value.length !== candidates.length) {
    throw new DailyNewsValidationError("summary_count_invalid");
  }
  const byId = new Map<string, string>();
  for (const item of value) {
    if (
      !isRecord(item)
      || !exactKeys(item, ["id", "summary"])
      || typeof item.id !== "string"
      || !boundedText(item.summary, 160)
      || byId.has(item.id)
    ) {
      throw new DailyNewsValidationError("summary_invalid");
    }
    byId.set(item.id, item.summary.trim());
  }
  if (byId.size !== candidates.length) {
    throw new DailyNewsValidationError("summary_count_invalid");
  }
  return candidates.map((candidate) => {
    const summary = byId.get(candidate.id);
    if (!summary) throw new DailyNewsValidationError("summary_id_invalid");
    return { id: candidate.id, summary };
  });
}

function candidateFromDigestItem(value: unknown): PublicNewsCandidate {
  if (!isRecord(value) || !exactKeys(value, [
    "id", "title", "summary", "url", "source", "publishedAt", "category", "scope",
  ])) {
    throw new DailyNewsValidationError("digest_item_invalid");
  }
  const item = value as unknown as DailyNewsItem;
  if (!boundedText(item.summary, 160)) {
    throw new DailyNewsValidationError("summary_invalid");
  }
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    source: item.source,
    publishedAt: item.publishedAt,
    category: item.category,
    scope: item.scope,
    snippet: "",
    description: "",
  };
}

export function validateDailyNewsDigest(value: unknown): DailyNewsDigest {
  if (
    !isRecord(value)
    || !exactKeys(value, ["date", "generatedAt", "items"])
    || typeof value.date !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)
    || typeof value.generatedAt !== "string"
    || !Number.isFinite(Date.parse(value.generatedAt))
    || !Array.isArray(value.items)
    || value.items.length !== 5
  ) {
    throw new DailyNewsValidationError("digest_invalid");
  }
  const candidates = value.items.map(candidateFromDigestItem);
  const selected = selectTopFive(candidates);
  const selectedIds = new Set(selected.map((candidate) => candidate.id));
  if (candidates.some((candidate) => !selectedIds.has(candidate.id))) {
    throw new DailyNewsValidationError("digest_mix_invalid");
  }
  validateNewsSummaries(value.items.map((item) => ({
    id: (item as DailyNewsItem).id,
    summary: (item as DailyNewsItem).summary,
  })), candidates);
  return {
    date: value.date,
    generatedAt: new Date(value.generatedAt).toISOString(),
    items: value.items as DailyNewsItem[],
  };
}
