import { load } from "cheerio";

import type { DailyNewsCategory } from "../domain/daily-news.js";
import type { PublicNewsCandidate } from "./daily-news-validator.js";
import { readBoundedResponseText } from "./bounded-response.js";

const BBC_FEEDS: ReadonlyArray<{
  category: DailyNewsCategory;
  url: string;
}> = [
  {
    category: "technology",
    url: "https://feeds.bbci.co.uk/news/technology/rss.xml",
  },
  {
    category: "finance",
    url: "https://feeds.bbci.co.uk/news/business/rss.xml",
  },
  {
    category: "politics",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
  },
];

const BBC_HOSTS = new Set(["bbc.co.uk", "bbc.com"]);
const XINHUA_HOSTS = new Set(["news.cn", "xinhuanet.com"]);
const XINHUA_CHANNELS: ReadonlyArray<{
  category: DailyNewsCategory;
  url: string;
}> = [
  {
    category: "technology",
    url: "https://www.news.cn/tech/index.html",
  },
  {
    category: "finance",
    url: "https://www.news.cn/fortune/index.htm",
  },
  {
    category: "politics",
    url: "https://www.news.cn/politics/index.html",
  },
];

export class PublisherNewsClientError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PublisherNewsClientError";
  }
}

export interface PublisherNewsClientDependencies {
  fetch: typeof globalThis.fetch;
  now?: () => Date;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

function bounded(value: string, maximum: number): string {
  return [...value.trim()].slice(0, maximum).join("");
}

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function trustedBbcUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" && BBC_HOSTS.has(normalizedHostname(url))
      ? url
      : null;
  } catch {
    return null;
  }
}

function trustedXinhuaArticleUrl(raw: string, base: string): URL | null {
  try {
    const url = new URL(raw.trim(), base);
    const articlePath = /\/(?:[^/]+\/)*\d{8}\/[A-Za-z0-9-]+\/c\.html$/;
    return url.protocol === "https:"
      && XINHUA_HOSTS.has(normalizedHostname(url))
      && articlePath.test(url.pathname)
      ? url
      : null;
  } catch {
    return null;
  }
}

function candidateId(category: DailyNewsCategory, url: string): string {
  let hash = 14_695_981_039_346_656_037n;
  for (const byte of new TextEncoder().encode(url)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 1_099_511_628_211n);
  }
  return `publisher:${category}:${hash.toString(16).padStart(16, "0")}`;
}

async function fetchText(
  url: string,
  dependencies: PublisherNewsClientDependencies,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    dependencies.timeoutMs ?? 8_000,
  );
  try {
    const response = await dependencies.fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new PublisherNewsClientError(`publisher_http_${response.status}`);
    }
    return await readBoundedResponseText(
      response,
      dependencies.maxResponseBytes ?? 1_000_000,
      () => new PublisherNewsClientError("publisher_response_too_large"),
    );
  } catch (error) {
    if (error instanceof PublisherNewsClientError) throw error;
    if ((error as { name?: unknown })?.name === "AbortError") {
      throw new PublisherNewsClientError("publisher_timeout");
    }
    throw new PublisherNewsClientError("publisher_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverBbcFeed(
  feed: (typeof BBC_FEEDS)[number],
  dependencies: PublisherNewsClientDependencies,
): Promise<PublicNewsCandidate[]> {
  const xml = await fetchText(feed.url, dependencies);
  const $ = load(xml, { xml: true });
  const requestedAt = (dependencies.now ?? (() => new Date()))().getTime();
  const earliest = requestedAt - 24 * 60 * 60 * 1_000;
  const latest = requestedAt + 5 * 60 * 1_000;
  const candidates: PublicNewsCandidate[] = [];

  $("item").slice(0, 30).each((_index, element) => {
    const item = $(element);
    const title = bounded(item.find("title").first().text(), 300);
    const rawUrl = item.find("link").first().text();
    const url = trustedBbcUrl(rawUrl);
    const publishedTimestamp = Date.parse(item.find("pubDate").first().text());
    const description = bounded(item.find("description").first().text(), 1_200);
    if (
      !title
      || !url
      || !Number.isFinite(publishedTimestamp)
      || publishedTimestamp < earliest
      || publishedTimestamp > latest
    ) return;
    const publishedAt = new Date(publishedTimestamp).toISOString();
    const source = normalizedHostname(url);
    candidates.push({
      id: candidateId(feed.category, url.toString()),
      category: feed.category,
      description,
      publishedAt,
      scope: "international",
      snippet: description,
      source,
      title,
      url: url.toString(),
    });
  });
  return candidates;
}

function xinhuaPublishedAt($: ReturnType<typeof load>): string | null {
  const mobile = $(".mheader .info").first().text();
  const mobileMatch = /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/.exec(mobile);
  const desktop = $(".header-time").first().text();
  const desktopMatch = /(\d{4})\s*(\d{2})\s*\/\s*(\d{2})\s*(\d{2}:\d{2}:\d{2})/.exec(
    desktop,
  );
  const candidate = mobileMatch
    ? `${mobileMatch[1]}T${mobileMatch[2]}+08:00`
    : desktopMatch
      ? `${desktopMatch[1]}-${desktopMatch[2]}-${desktopMatch[3]}T${desktopMatch[4]}+08:00`
      : null;
  if (!candidate) return null;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

async function discoverXinhuaArticle(
  category: DailyNewsCategory,
  url: URL,
  dependencies: PublisherNewsClientDependencies,
): Promise<PublicNewsCandidate | null> {
  const html = await fetchText(url.toString(), dependencies);
  const $ = load(html);
  const title = bounded(
    $(".mheader .title").first().text() || $("title").first().text().replace(/[_-]新华网.*$/u, ""),
    300,
  );
  const description = bounded($("meta[name='description']").attr("content") ?? "", 1_200);
  const source = bounded(
    $("meta[name='source']").attr("content") ?? "新华网",
    120,
  );
  const publishedAt = xinhuaPublishedAt($);
  if (!title || !publishedAt) return null;
  const timestamp = Date.parse(publishedAt);
  const requestedAt = (dependencies.now ?? (() => new Date()))().getTime();
  if (
    timestamp < requestedAt - 24 * 60 * 60 * 1_000
    || timestamp > requestedAt + 5 * 60 * 1_000
  ) return null;
  return {
    id: candidateId(category, url.toString()),
    category,
    description,
    publishedAt,
    scope: "domestic",
    snippet: description,
    source,
    title,
    url: url.toString(),
  };
}

async function discoverXinhuaChannel(
  channel: (typeof XINHUA_CHANNELS)[number],
  dependencies: PublisherNewsClientDependencies,
): Promise<PublicNewsCandidate[]> {
  const html = await fetchText(channel.url, dependencies);
  const $ = load(html);
  const urls: URL[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_index, element) => {
    const url = trustedXinhuaArticleUrl($(element).attr("href") ?? "", channel.url);
    if (!url || seen.has(url.toString())) return;
    seen.add(url.toString());
    urls.push(url);
  });
  urls.sort((left, right) => {
    const leftDate = /\/(\d{8})\//.exec(left.pathname)?.[1] ?? "";
    const rightDate = /\/(\d{8})\//.exec(right.pathname)?.[1] ?? "";
    return rightDate.localeCompare(leftDate);
  });
  const settled = await Promise.allSettled(
    urls.slice(0, 2).map(async (url) => (
      await discoverXinhuaArticle(channel.category, url, dependencies)
    )),
  );
  return settled.flatMap((result) => (
    result.status === "fulfilled" && result.value ? [result.value] : []
  ));
}

export async function discoverPublisherNewsCandidates(
  dependencies: PublisherNewsClientDependencies,
): Promise<PublicNewsCandidate[]> {
  const settled = await Promise.allSettled([
    ...BBC_FEEDS.map(async (feed) => await discoverBbcFeed(feed, dependencies)),
    ...XINHUA_CHANNELS.map(async (channel) => (
      await discoverXinhuaChannel(channel, dependencies)
    )),
  ]);
  const fulfilled = settled.filter((result) => result.status === "fulfilled");
  if (fulfilled.length === 0) {
    throw new PublisherNewsClientError("publisher_sources_unavailable");
  }
  return fulfilled.flatMap((result) => result.value);
}
