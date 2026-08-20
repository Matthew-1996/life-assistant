import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("synthetic preview Vercel config", () => {
  it("fails closed for API paths before the SPA fallback", async () => {
    const config = JSON.parse(
      await readFile("vercel.synthetic.json", "utf8"),
    ) as {
      routes: Array<{
        src?: string;
        status?: number;
        dest?: string;
        headers?: Record<string, string>;
      }>;
    };

    const apiIndex = config.routes.findIndex(
      (route) => route.src === "/api(?:/.*)?" && route.status === 404,
    );
    const fallbackIndex = config.routes.findIndex(
      (route) => route.src === "/(.*)" && route.dest === "/index.html",
    );

    expect(apiIndex).toBeGreaterThanOrEqual(0);
    expect(fallbackIndex).toBeGreaterThan(apiIndex);
    expect(config.routes.some((route) => route.headers?.["Content-Security-Policy"]
      ?.includes("connect-src 'none'"))).toBe(true);
    expect(config.routes.some((route) => route.headers?.["Content-Security-Policy"]
      ?.includes("unsafe-eval"))).toBe(false);
  });
});
