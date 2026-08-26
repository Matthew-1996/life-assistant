import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";

const temporaryDirectories: string[] = [];

function readTree(directory: string): string {
  return readdirSync(directory)
    .flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? readTree(path) : readFileSync(path, "utf8");
    })
    .join("\n");
}

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true });
  });
});

describe("Supabase Production browser bundle boundary", () => {
  it("excludes candidate-only synthetic news and health content", async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "life-console-production-bundle-"));
    temporaryDirectories.push(outputDirectory);

    await build({
      build: { emptyOutDir: true, outDir: outputDirectory },
      logLevel: "silent",
      mode: "supabase-production",
    });

    const bundle = readTree(outputDirectory);
    expect(bundle).not.toContain("synthetic-technology-domestic");
    expect(bundle).not.toContain("合成示例：人工智能基础设施持续演进");
    expect(bundle).not.toContain("2026-01-03");
    expect(bundle).not.toContain("candidate-health-preview-only");
  }, 15_000);
});
