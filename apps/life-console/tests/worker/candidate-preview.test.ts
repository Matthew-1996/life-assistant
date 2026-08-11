import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// @ts-expect-error The deployed Worker is intentionally framework-free JavaScript.
import worker from "../../worker/candidate-preview.js";

describe("candidate preview worker", () => {
  it("removes stale non-candidate files while preserving the client build", async () => {
    const root = await mkdtemp(join(tmpdir(), "life-console-candidate-"));
    try {
      await mkdir(join(root, "dist/client"), { recursive: true });
      await mkdir(join(root, "dist/assets"), { recursive: true });
      await mkdir(join(root, "worker"), { recursive: true });
      await mkdir(join(root, "scripts"), { recursive: true });
      await writeFile(join(root, "dist/client/index.html"), "candidate");
      await writeFile(join(root, "dist/index.html"), "stale");
      await writeFile(join(root, "dist/assets/stale.js"), "stale");
      await writeFile(join(root, "worker/candidate-preview.js"), "worker");
      await writeFile(
        join(root, "scripts/prepare-candidate-preview-build.mjs"),
        await readFile("scripts/prepare-candidate-preview-build.mjs"),
      );

      const result = spawnSync(
        process.execPath,
        ["scripts/prepare-candidate-preview-build.mjs"],
        { cwd: root, encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      await expect(readFile(join(root, "dist/client/index.html"), "utf8"))
        .resolves.toBe("candidate");
      await expect(readFile(join(root, "dist/server/index.js"), "utf8"))
        .resolves.toBe("worker");
      await expect(readFile(join(root, "dist/index.html"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(join(root, "dist/assets/stale.js"), "utf8"))
        .rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serves the SPA with private security headers", async () => {
    const fetchAsset = vi.fn()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response("<main>Life Console</main>", {
        headers: { "Content-Type": "text/html" },
      }));

    const response = await worker.fetch(
      new Request("https://candidate.example.test/progress"),
      { ASSETS: { fetch: fetchAsset } },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Life Console");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "connect-src 'none'",
    );
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("fails closed for every API request", async () => {
    const fetchAsset = vi.fn();
    const response = await worker.fetch(
      new Request("https://candidate.example.test/api/v1/system/status"),
      { ASSETS: { fetch: fetchAsset } },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "candidate_preview_read_only",
        message: "Candidate preview does not expose an API.",
      },
    });
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it("rejects non-read methods before reaching assets", async () => {
    const fetchAsset = vi.fn();
    const response = await worker.fetch(
      new Request("https://candidate.example.test/records", { method: "POST" }),
      { ASSETS: { fetch: fetchAsset } },
    );

    expect(response.status).toBe(405);
    expect(fetchAsset).not.toHaveBeenCalled();
  });
});
