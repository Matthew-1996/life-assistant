import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(suiteDirectory, "../..");
const fixtureDirectory = resolve(appRoot, "contracts/fixtures");
const privateFileNames = new Set([
  "USER.md",
  "MEMORY.md",
  "GOALS.md",
  "PROJECT_CONTEXT.md",
  "PORTABILITY.md",
  "STATUS.md",
  "index.jsonl",
  "apple-health-latest.txt",
  "apple-sleep-details-latest.txt",
  "google-sheets.json",
]);
const forbiddenDashboardKeys = new Set([
  "raw",
  "raw_journal",
  "note_summary",
  "health_details",
  "prompt",
  "credential",
  "token",
]);

function visit(value: unknown, keys: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, keys));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    visit(child, keys);
  }
}

describe("synthetic fixture privacy boundary", () => {
  it("contains only JSON fixtures with non-private names", () => {
    const fixtureNames = readdirSync(fixtureDirectory);

    expect(fixtureNames.length).toBeGreaterThan(0);
    for (const fixtureName of fixtureNames) {
      expect(extname(fixtureName)).toBe(".json");
      expect(privateFileNames.has(fixtureName)).toBe(false);
    }
  });

  it("contains no machine-specific absolute paths", () => {
    for (const fixtureName of readdirSync(fixtureDirectory)) {
      const content = readFileSync(resolve(fixtureDirectory, fixtureName), "utf8");

      const homePrefix = "/" + "Users/";
      expect(content).not.toMatch(
        new RegExp(`${homePrefix}[A-Za-z0-9._-]+/`),
      );
      expect(content).not.toMatch(/\/private\/(?:tmp|var)\//);
    }
  });

  it("keeps dashboard fixtures on the safe read-model projection", () => {
    const dashboardFixtures = readdirSync(fixtureDirectory).filter((name) =>
      name.startsWith("dashboard."),
    );

    for (const fixtureName of dashboardFixtures) {
      const keys: string[] = [];
      const fixture = JSON.parse(
        readFileSync(resolve(fixtureDirectory, fixtureName), "utf8"),
      ) as unknown;
      visit(fixture, keys);

      expect(keys.filter((key) => forbiddenDashboardKeys.has(key))).toEqual([]);
    }
  });
});
