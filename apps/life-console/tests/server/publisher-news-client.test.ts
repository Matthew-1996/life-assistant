// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  discoverPublisherNewsCandidates,
  PublisherNewsClientError,
} from "../../src/server/publisher-news-client";

const now = new Date("2030-05-14T02:00:00.000Z");

function rssItem(input: {
  title: string;
  link: string;
  publishedAt: string;
  description: string;
}): string {
  return `
    <item>
      <title><![CDATA[${input.title}]]></title>
      <link>${input.link}</link>
      <pubDate>${input.publishedAt}</pubDate>
      <description><![CDATA[${input.description}]]></description>
    </item>
  `;
}

function rss(items: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel>${items.join("")}</channel></rss>`;
}

function fixtureFetch(fixtures: Readonly<Record<string, string>>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const body = fixtures[url];
    if (body === undefined) throw new Error(`unexpected_url:${url}`);
    return new Response(body, {
      headers: { "content-type": "text/xml; charset=utf-8" },
    });
  }) as typeof fetch;
}

function xinhuaChannel(items: Array<{ title: string; url: string }>): string {
  return `<html><body>${items.map((item) => (
    `<a href="${item.url}"><span>${item.title}</span></a>`
  )).join("")}</body></html>`;
}

function xinhuaArticle(input: {
  title: string;
  publishedAt: string;
  description: string;
}): string {
  const [date, time] = input.publishedAt.split(" ");
  const [year, month, day] = date.split("-");
  return `<html><head>
    <meta name="description" content="${input.description}">
    <meta name="source" content="新华网">
  </head><body>
    <div class="header-time">
      <span class="year"><em>${year}</em></span>
      <span class="day"><em>${month}</em>/<em>${day}</em></span>
      <span class="time">${time}</span>
    </div>
    <div class="mheader"><h1><span class="title">${input.title}</span></h1>
      <div class="info">${input.publishedAt}</div>
    </div>
  </body></html>`;
}

const emptyRss = rss([]);

describe("trusted publisher news fallback", () => {
  it("projects current BBC technology, finance, and politics RSS items as international candidates", async () => {
    const candidates = await discoverPublisherNewsCandidates({
      fetch: fixtureFetch({
        "https://feeds.bbci.co.uk/news/technology/rss.xml": rss([rssItem({
          title: "Synthetic technology headline",
          link: "https://www.bbc.co.uk/news/articles/technology-synthetic",
          publishedAt: "Tue, 14 May 2030 01:15:00 GMT",
          description: "Public technology description",
        })]),
        "https://feeds.bbci.co.uk/news/business/rss.xml": rss([rssItem({
          title: "Synthetic finance headline",
          link: "https://www.bbc.com/news/articles/finance-synthetic",
          publishedAt: "Tue, 14 May 2030 00:45:00 GMT",
          description: "Public finance description",
        })]),
        "https://feeds.bbci.co.uk/news/world/rss.xml": rss([rssItem({
          title: "Synthetic politics headline",
          link: "https://www.bbc.co.uk/news/articles/politics-synthetic",
          publishedAt: "Mon, 13 May 2030 23:30:00 GMT",
          description: "Public politics description",
        })]),
      }),
      now: () => now,
    });

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: "technology",
        description: "Public technology description",
        publishedAt: "2030-05-14T01:15:00.000Z",
        scope: "international",
        source: "bbc.co.uk",
        title: "Synthetic technology headline",
      }),
      expect.objectContaining({
        category: "finance",
        publishedAt: "2030-05-14T00:45:00.000Z",
        scope: "international",
        source: "bbc.com",
      }),
      expect.objectContaining({
        category: "politics",
        publishedAt: "2030-05-13T23:30:00.000Z",
        scope: "international",
        source: "bbc.co.uk",
      }),
    ]));
    expect(candidates).toHaveLength(3);
  });

  it("projects current Xinhua channel articles with precise public metadata as domestic candidates", async () => {
    const urls = {
      technology: "https://www.news.cn/tech/20300514/technology-synthetic/c.html",
      finance: "https://www.news.cn/fortune/20300514/finance-synthetic/c.html",
      politics: "https://www.news.cn/politics/20300514/politics-synthetic/c.html",
    };
    const fetch = fixtureFetch({
      "https://feeds.bbci.co.uk/news/technology/rss.xml": emptyRss,
      "https://feeds.bbci.co.uk/news/business/rss.xml": emptyRss,
      "https://feeds.bbci.co.uk/news/world/rss.xml": emptyRss,
      "https://www.news.cn/tech/index.html": xinhuaChannel([{
        title: "Synthetic Xinhua technology",
        url: urls.technology,
      }]),
      "https://www.news.cn/fortune/index.htm": xinhuaChannel([{
        title: "Synthetic Xinhua finance",
        url: urls.finance,
      }]),
      "https://www.news.cn/politics/index.html": xinhuaChannel([{
        title: "Synthetic Xinhua politics",
        url: urls.politics,
      }]),
      [urls.technology]: xinhuaArticle({
        title: "Synthetic Xinhua technology",
        publishedAt: "2030-05-14 09:15:00",
        description: "Public Xinhua technology description",
      }),
      [urls.finance]: xinhuaArticle({
        title: "Synthetic Xinhua finance",
        publishedAt: "2030-05-14 08:45:00",
        description: "Public Xinhua finance description",
      }),
      [urls.politics]: xinhuaArticle({
        title: "Synthetic Xinhua politics",
        publishedAt: "2030-05-14 08:30:00",
        description: "Public Xinhua politics description",
      }),
    });

    const candidates = await discoverPublisherNewsCandidates({
      fetch,
      now: () => now,
    });

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: "technology",
        description: "Public Xinhua technology description",
        publishedAt: "2030-05-14T01:15:00.000Z",
        scope: "domestic",
        source: "新华网",
        title: "Synthetic Xinhua technology",
        url: urls.technology,
      }),
      expect.objectContaining({
        category: "finance",
        publishedAt: "2030-05-14T00:45:00.000Z",
        scope: "domestic",
      }),
      expect.objectContaining({
        category: "politics",
        publishedAt: "2030-05-14T00:30:00.000Z",
        scope: "domestic",
      }),
    ]));
    expect(candidates).toHaveLength(3);
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("news_tech.xml"),
      expect.anything(),
    );
  });

  it("isolates a failed publisher entry and keeps candidates from healthy entries", async () => {
    const fetch: typeof globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://feeds.bbci.co.uk/news/technology/rss.xml") {
        throw new TypeError("synthetic network failure");
      }
      if (url === "https://feeds.bbci.co.uk/news/business/rss.xml") {
        return new Response(rss([rssItem({
          title: "Healthy finance item",
          link: "https://www.bbc.com/news/articles/healthy-finance",
          publishedAt: "Tue, 14 May 2030 01:00:00 GMT",
          description: "Healthy public description",
        })]));
      }
      if (url === "https://feeds.bbci.co.uk/news/world/rss.xml") return new Response(emptyRss);
      throw new TypeError(`synthetic unavailable:${url}`);
    }) as typeof globalThis.fetch;

    await expect(discoverPublisherNewsCandidates({
      fetch,
      now: () => now,
    })).resolves.toEqual([
      expect.objectContaining({
        category: "finance",
        title: "Healthy finance item",
      }),
    ]);
  });

  it("prefers current Xinhua article links when stale links appear first in a channel", async () => {
    const staleOne = "https://www.news.cn/tech/20300512/stale-one/c.html";
    const staleTwo = "https://www.news.cn/tech/20300512/stale-two/c.html";
    const current = "https://www.news.cn/tech/20300514/current/c.html";
    const fetch = fixtureFetch({
      "https://feeds.bbci.co.uk/news/technology/rss.xml": emptyRss,
      "https://feeds.bbci.co.uk/news/business/rss.xml": emptyRss,
      "https://feeds.bbci.co.uk/news/world/rss.xml": emptyRss,
      "https://www.news.cn/tech/index.html": xinhuaChannel([
        { title: "Stale one", url: staleOne },
        { title: "Stale two", url: staleTwo },
        { title: "Current", url: current },
      ]),
      [staleOne]: xinhuaArticle({
        title: "Stale one",
        publishedAt: "2030-05-12 09:00:00",
        description: "Stale one",
      }),
      [staleTwo]: xinhuaArticle({
        title: "Stale two",
        publishedAt: "2030-05-12 10:00:00",
        description: "Stale two",
      }),
      [current]: xinhuaArticle({
        title: "Current",
        publishedAt: "2030-05-14 09:00:00",
        description: "Current public description",
      }),
    });

    await expect(discoverPublisherNewsCandidates({
      fetch,
      now: () => now,
    })).resolves.toEqual([
      expect.objectContaining({ title: "Current", url: current }),
    ]);
  });

  it("filters untrusted, stale, and future items before returning public candidates", async () => {
    const fetch = fixtureFetch({
      "https://feeds.bbci.co.uk/news/technology/rss.xml": rss([
        rssItem({
          title: "Untrusted link",
          link: "https://attacker.invalid/news",
          publishedAt: "Tue, 14 May 2030 01:00:00 GMT",
          description: "Untrusted",
        }),
        rssItem({
          title: "Stale item",
          link: "https://www.bbc.co.uk/news/articles/stale",
          publishedAt: "Sun, 12 May 2030 01:00:00 GMT",
          description: "Stale",
        }),
        rssItem({
          title: "Future item",
          link: "https://www.bbc.co.uk/news/articles/future",
          publishedAt: "Tue, 14 May 2030 03:00:00 GMT",
          description: "Future",
        }),
      ]),
      "https://feeds.bbci.co.uk/news/business/rss.xml": emptyRss,
      "https://feeds.bbci.co.uk/news/world/rss.xml": emptyRss,
    });

    await expect(discoverPublisherNewsCandidates({
      fetch,
      now: () => now,
    })).resolves.toEqual([]);
  });

  it("fails with a stable code when every publisher entry is unavailable or oversized", async () => {
    const unavailable = vi.fn(async () => {
      throw new TypeError("sensitive upstream detail");
    }) as typeof globalThis.fetch;
    await expect(discoverPublisherNewsCandidates({
      fetch: unavailable,
      now: () => now,
    })).rejects.toThrowError(new PublisherNewsClientError("publisher_sources_unavailable"));

    const oversized = vi.fn(async () => new Response("{}", {
      headers: { "content-length": "2000000" },
    })) as typeof globalThis.fetch;
    await expect(discoverPublisherNewsCandidates({
      fetch: oversized,
      maxResponseBytes: 1_024,
      now: () => now,
    })).rejects.toThrowError(new PublisherNewsClientError("publisher_sources_unavailable"));
  });
});
