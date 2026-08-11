import { describe, expect, it, vi } from "vitest";

// @ts-expect-error The deployed Worker is intentionally framework-free JavaScript.
import worker from "../../worker/sites-200.js";

describe("Life Console 2.0.0 Sites worker shell", () => {
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
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("Strict-Transport-Security")).toContain(
      "max-age=31536000",
    );
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(fetchAsset).toHaveBeenCalledTimes(2);
  });

  it("fails closed when owner authentication is not configured", async () => {
    const response = await worker.fetch(
      new Request("https://example.test/api/v1/journals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "https://example.test",
        },
        body: JSON.stringify({ title: "synthetic" }),
      }),
      { ASSETS: { fetch: vi.fn() } },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: "owner_session_required",
      }),
    }));
  });

  it("rejects write methods outside the API namespace", async () => {
    const response = await worker.fetch(
      new Request("https://example.test/progress", { method: "POST" }),
      { ASSETS: { fetch: vi.fn() } },
    );

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      error: {
        code: "method_not_allowed",
        message: "Only GET and HEAD are allowed for static assets.",
      },
    });
  });
});
