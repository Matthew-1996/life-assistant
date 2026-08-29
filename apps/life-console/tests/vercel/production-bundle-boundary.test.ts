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
  it("includes the synthetic Todo repository only in the Candidate bundle", async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "life-console-candidate-bundle-"));
    temporaryDirectories.push(outputDirectory);

    await build({
      build: { emptyOutDir: true, outDir: outputDirectory },
      logLevel: "silent",
      mode: "candidate-preview",
    });

    const bundle = readTree(outputDirectory);
    expect(bundle).toContain("整理旅行清单");
    expect(bundle).toContain("准备本周采购");
    expect(bundle).toContain("完成房间整理");
  }, 15_000);

  it("excludes candidate-only synthetic news, health, and Todo content", async () => {
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
    expect(bundle).not.toContain("整理旅行清单");
    expect(bundle).not.toContain("准备本周采购");
    expect(bundle).not.toContain("完成房间整理");
  }, 15_000);
});
