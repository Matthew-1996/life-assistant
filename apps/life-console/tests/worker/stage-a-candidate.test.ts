import { describe, expect, it, vi } from "vitest";

// @ts-expect-error The candidate Worker is intentionally framework-free JavaScript.
import worker from "../../worker/stage-a-candidate.js";

const origin = "https://candidate.example";
const ownerHeaders = { "oai-authenticated-user-id": "synthetic-owner" };

describe("Life Console 2.1.0 stage A candidate", () => {
  it("rejects an unauthenticated capacity request", async () => {
    const response = await worker.fetch(
      new Request(`${origin}/api/v1/poc/capacity?profile=S`),
      { ASSETS: { fetch: vi.fn() } },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "owner_session_required" },
    });
  });

  it("generates a synthetic S capacity result without storage bindings", async () => {
    const response = await worker.fetch(
      new Request(`${origin}/api/v1/poc/capacity?profile=S`, {
        headers: ownerHeaders,
      }),
      { ASSETS: { fetch: vi.fn() } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      profile: "S",
      synthetic: true,
      input_bytes: expect.any(Number),
      archive_bytes: expect.any(Number),
      elapsed_ms: expect.any(Number),
    }));
  });

  it("returns a no-store synthetic archive", async () => {
    const response = await worker.fetch(
      new Request(`${origin}/api/v1/poc/archive?profile=S`, {
        headers: ownerHeaders,
      }),
      { ASSETS: { fetch: vi.fn() } },
    );
    const archive = new Uint8Array(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect([...archive.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("serves assets with the fixed loopback CSP and no data bindings", async () => {
    const assets = { fetch: vi.fn().mockResolvedValue(new Response("ok")) };
    const response = await worker.fetch(new Request(`${origin}/`), { ASSETS: assets });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "connect-src 'self' http://127.0.0.1:47323",
    );
    expect(assets.fetch).toHaveBeenCalledOnce();
  });
});
