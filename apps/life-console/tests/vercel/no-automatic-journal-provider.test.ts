// @vitest-environment node

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Production journal provider authorization boundary", () => {
  it("does not wire automatic DeepSeek normalization into the browser entry", async () => {
    const entry = await readFile(
      new URL("../../src/main.tsx", import.meta.url),
      "utf8",
    );
    expect(entry).not.toContain("/api/journal-normalize");
  });
});
