// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createJournalNormalizationApiClient } from "../../src/api/journal-normalization-client";

const input = {
  journalId: 31,
  sourceRevision: 2,
  taskKey: "journal:31:revision:2:deepseek",
};

describe("journal normalization browser client", () => {
  it("uses the current Owner token and sends only the normalization identifiers", async () => {
    let requestInput: string | URL | Request | undefined;
    let requestInit: RequestInit | undefined;
    const fetch = vi.fn(async (
      nextInput: string | URL | Request,
      nextInit?: RequestInit,
    ) => {
      requestInput = nextInput;
      requestInit = nextInit;
      return Response.json({ status: "completed" });
    });
    const client = createJournalNormalizationApiClient({
      fetch,
      getAccessToken: vi.fn(async () => "synthetic-owner-jwt"),
    });

    await expect(client(input)).resolves.toBe("completed");
    expect(requestInput).toBe("/api/journal-normalize");
    expect(requestInit?.method).toBe("POST");
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("authorization")).toBe("Bearer synthetic-owner-jwt");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      journal_id: 31,
      source_revision: 2,
      task_key: "journal:31:revision:2:deepseek",
    });
  });

  it("fails closed without a session and never starts a provider request", async () => {
    const fetch = vi.fn(async () => Response.json({ status: "completed" }));
    const client = createJournalNormalizationApiClient({
      fetch,
      getAccessToken: vi.fn(async () => null),
    });

    await expect(client(input)).resolves.toBe("failed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["an HTTP failure", new Response(null, { status: 503 })],
    ["a malformed response", Response.json({ status: "processing" })],
  ])("returns only a stable failure for %s", async (_label, response) => {
    const client = createJournalNormalizationApiClient({
      fetch: vi.fn(async () => response),
      getAccessToken: vi.fn(async () => "synthetic-owner-jwt"),
    });

    await expect(client(input)).resolves.toBe("failed");
  });
});
