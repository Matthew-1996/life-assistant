// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  DeepSeekNormalizationError,
  requestDeepSeekNormalization,
} from "../../src/server/deepseek-normalizer";

const rawText = "Synthetic body";
const normalization = {
  title: "Synthetic title",
  summary: "Synthetic summary",
  facts: [{
    text: "Synthetic fact",
    basis: "explicit_text" as const,
    evidence: rawText,
  }],
  feelings: [], people: [], places: [], themes: ["synthetic"],
  planning_clues: [], inferences: [], tags: ["synthetic"],
};

function response(content: string): Response {
  return Response.json({ choices: [{ message: { content } }] });
}

describe("DeepSeek journal normalizer", () => {
  it("uses only the allowlisted non-thinking JSON endpoint and model", async () => {
    const fetch = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => response(JSON.stringify(normalization)));

    await expect(requestDeepSeekNormalization({
      rawText,
      contextEntities: [],
      contextRevisions: {},
    }, {
      apiKey: "synthetic-server-key",
      fetch,
    })).resolves.toEqual(normalization);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      stream: false,
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
    });
    expect(body).not.toHaveProperty("fallback_model");
    expect(init?.headers).toEqual({
      Authorization: "Bearer synthetic-server-key",
      "Content-Type": "application/json",
    });
  });

  it("retries once for empty or invalid output and then succeeds", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(""))
      .mockResolvedValueOnce(response(JSON.stringify(normalization)));

    await expect(requestDeepSeekNormalization({
      rawText,
      contextEntities: [],
      contextRevisions: {},
    }, { apiKey: "synthetic-server-key", fetch })).resolves.toEqual(
      normalization,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fails closed after one retry and rejects endpoint overrides", async () => {
    const fetch = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => response("not-json"));
    await expect(requestDeepSeekNormalization({
      rawText,
      contextEntities: [],
      contextRevisions: {},
    }, { apiKey: "synthetic-server-key", fetch })).rejects.toBeInstanceOf(
      DeepSeekNormalizationError,
    );
    expect(fetch).toHaveBeenCalledTimes(2);

    await expect(requestDeepSeekNormalization({
      rawText,
      contextEntities: [],
      contextRevisions: {},
    }, {
      apiKey: "synthetic-server-key",
      endpoint: "https://example.invalid/chat/completions",
      fetch,
    })).rejects.toMatchObject({
      code: "provider_endpoint_is_not_allowlisted",
    });
  });

  it("does not retry HTTP failures or expose provider response bodies", async () => {
    const fetch = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(
      "synthetic sensitive provider body",
      { status: 429 },
    ));
    let error: unknown;
    try {
      await requestDeepSeekNormalization({
        rawText,
        contextEntities: [],
        contextRevisions: {},
      }, { apiKey: "synthetic-server-key", fetch });
    } catch (caught) {
      error = caught;
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(DeepSeekNormalizationError);
    expect(String(error)).not.toContain("sensitive provider body");
    expect(String(error)).not.toContain(rawText);
  });
});
