import { describe, expect, it, vi } from "vitest";

// @ts-expect-error The deployed Worker is intentionally framework-free JavaScript.
import worker from "../../worker/sites.js";

describe("Sites static worker", () => {
  it("serves the SPA fallback with private security headers", async () => {
    const fetchAsset = vi.fn()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response("<main>Life Console</main>", {
        headers: { "Content-Type": "text/html" },
      }));

    const response = await worker.fetch(
      new Request("https://example.test/progress"),
      { ASSETS: { fetch: fetchAsset } },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Life Console");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(fetchAsset).toHaveBeenCalledTimes(2);
  });

  it("rejects write methods", async () => {
    const response = await worker.fetch(
      new Request("https://example.test/api", { method: "POST" }),
      { ASSETS: { fetch: vi.fn() } },
    );

    expect(response.status).toBe(405);
  });
});
