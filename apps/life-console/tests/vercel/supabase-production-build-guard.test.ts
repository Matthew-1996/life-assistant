import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("Supabase Production build guard", () => {
  it("rejects a Vercel sensitive-value placeholder before bundling", () => {
    const result = spawnSync("npm", ["run", "build:supabase-production"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VITE_SUPABASE_PUBLISHABLE_KEY: "[SENSITIVE]",
        VITE_SUPABASE_URL: "https://synthetic-project.supabase.co",
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "VITE_SUPABASE_PUBLISHABLE_KEY must contain a publishable key or legacy anon JWT",
    );
  }, 15_000);
});
