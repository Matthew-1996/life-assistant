// @vitest-environment node

import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { open as openFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

type MigrationResourceType =
  | "goals"
  | "journals"
  | "journal_revisions"
  | "daily_checkins"
  | "weekly_reviews"
  | "phase_reviews"
  | "health_days"
  | "health_segments";

const APPROVED_RESOURCE_TYPES: readonly MigrationResourceType[] = [
  "goals",
  "journals",
  "journal_revisions",
  "daily_checkins",
  "weekly_reviews",
  "phase_reviews",
  "health_days",
  "health_segments",
];

interface SourceManifest {
  approvedRoot: string;
  resources: Array<{
    resourceType: MigrationResourceType;
    sourcePath: string;
    sourceDigest: string;
    expectedCount: number;
    approvedFields: string[];
  }>;
}

interface DryRunReport {
  resources: Array<{
    resourceType: MigrationResourceType;
    count: number;
    canonicalSha256: string | null;
    errors: string[];
  }>;
  overallDigest: string;
}

interface TestFileHandle {
  stat: () => Promise<{ isFile: () => boolean; size: number }>;
  readFile: () => Promise<Buffer>;
  close: () => Promise<void>;
}

interface TestFileOps {
  open: (path: string, flags: number) => Promise<TestFileHandle>;
}

const canonicalModule = "../../scripts/private-migration/canonical-digest";
const dryRunModule = "../../scripts/private-migration/dry-run";
const { canonicalJson, canonicalNdjson } = await import(canonicalModule) as {
  canonicalJson: (value: unknown) => string;
  canonicalNdjson: (rows: readonly unknown[]) => string;
};
const { createDryRunReport } = await import(dryRunModule) as {
  createDryRunReport: (
    manifest: SourceManifest,
    options?: { fileOps?: TestFileOps },
  ) => Promise<DryRunReport>;
};

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "life-console-dry-run-"));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeSyntheticFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function manifestFor(
  approvedRoot: string,
  sourcePath: string,
  content: string,
  options: {
    resourceType?: MigrationResourceType;
    expectedCount?: number;
    approvedFields?: string[];
  } = {},
): SourceManifest {
  const primaryResourceType = options.resourceType ?? "journals";
  const resources = APPROVED_RESOURCE_TYPES.map((resourceType) => {
    if (resourceType === primaryResourceType) {
      return {
        resourceType,
        sourcePath,
        sourceDigest: sha256(content),
        expectedCount: options.expectedCount ?? 2,
        approvedFields: options.approvedFields ?? [
          "id",
          "title",
          "content",
          "tags",
        ],
      };
    }
    const syntheticPath = join(approvedRoot, `${resourceType}.ndjson`);
    const syntheticContent = `{"id":"synthetic-${resourceType}"}\n`;
    writeSyntheticFile(syntheticPath, syntheticContent);
    return {
      resourceType,
      sourcePath: syntheticPath,
      sourceDigest: sha256(syntheticContent),
      expectedCount: 1,
      approvedFields: ["id"],
    };
  });
  return {
    approvedRoot,
    resources,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("canonical migration digests", () => {
  it("recursively sorts object keys and writes compact UTF-8 NDJSON with LF", () => {
    const rows = [{
      z: 2,
      nested: { second: 2, first: 1 },
      list: [{ beta: 2, alpha: 1 }],
      a: "Synthetic",
    }];

    expect(canonicalJson(rows[0])).toBe(
      '{"a":"Synthetic","list":[{"alpha":1,"beta":2}],'
      + '"nested":{"first":1,"second":2},"z":2}',
    );
    expect(canonicalNdjson(rows)).toBe(
      '{"a":"Synthetic","list":[{"alpha":1,"beta":2}],'
      + '"nested":{"first":1,"second":2},"z":2}\n',
    );
    expect(canonicalNdjson([])).toBe("");
  });

  it("produces stable resource and overall digests across input key order", async () => {
    const leftRoot = temporaryDirectory();
    const rightRoot = temporaryDirectory();
    const leftPath = join(leftRoot, "journals.ndjson");
    const rightPath = join(rightRoot, "journals.ndjson");
    const left = [
      '{"title":"Synthetic","id":1,"tags":["b","a"]}',
      '{"content":"Follow-up","id":2}',
    ].join("\n") + "\n";
    const right = [
      '{"tags":["b","a"],"id":1,"title":"Synthetic"}',
      '{"id":2,"content":"Follow-up"}',
    ].join("\n") + "\n";
    writeSyntheticFile(leftPath, left);
    writeSyntheticFile(rightPath, right);

    const leftReport = await createDryRunReport(
      manifestFor(leftRoot, leftPath, left),
    );
    const rightReport = await createDryRunReport(
      manifestFor(rightRoot, rightPath, right),
    );
    const canonical = [
      '{"id":1,"tags":["b","a"],"title":"Synthetic"}',
      '{"content":"Follow-up","id":2}',
    ].join("\n") + "\n";
      const leftJournals = leftReport.resources.find(
        ({ resourceType }) => resourceType === "journals",
      );

      expect(leftJournals).toEqual({
      resourceType: "journals",
      count: 2,
      canonicalSha256: sha256(canonical),
      errors: [],
      });
    expect(rightReport).toEqual(leftReport);
    expect(leftReport.overallDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the overall digest stable across manifest resource order", async () => {
    const approvedRoot = temporaryDirectory();
    const journalsPath = join(approvedRoot, "journals.ndjson");
    const journals = '{"id":1,"title":"Synthetic journal"}\n';
    writeSyntheticFile(journalsPath, journals);
      const { resources } = manifestFor(
        approvedRoot,
        journalsPath,
        journals,
        {
          expectedCount: 1,
          approvedFields: ["id", "title"],
        },
      );

    const forward = await createDryRunReport({ approvedRoot, resources });
    const reverse = await createDryRunReport({
      approvedRoot,
      resources: [...resources].reverse(),
    });

    expect(reverse.overallDigest).toBe(forward.overallDigest);
  });
});

describe("private migration dry-run report", () => {
    it("succeeds for the complete eight-resource synthetic manifest", async () => {
      const approvedRoot = temporaryDirectory();
      const journalsPath = join(approvedRoot, "journals.ndjson");
      const journals = '{"id":1,"title":"Synthetic journal"}\n';
      writeSyntheticFile(journalsPath, journals);

      const report = await createDryRunReport(
        manifestFor(approvedRoot, journalsPath, journals, {
          expectedCount: 1,
          approvedFields: ["id", "title"],
        }),
      );

      expect(report.resources.map(({ resourceType }) => resourceType)).toEqual(
        APPROVED_RESOURCE_TYPES,
      );
      expect(report.resources).toHaveLength(8);
      expect(report.resources.every(({ errors }) => errors.length === 0)).toBe(
        true,
      );
    });

  it("reads only explicitly listed files and returns no source path or values", async () => {
    const approvedRoot = temporaryDirectory();
    const sourcePath = join(approvedRoot, "journals.ndjson");
    const listedContent =
      '{"title":"SYNTHETIC_PRIVATE_MARKER","id":1}\n';
    writeSyntheticFile(sourcePath, listedContent);
    writeSyntheticFile(
      join(approvedRoot, "unlisted.ndjson"),
      "this is deliberately invalid and must not be scanned\n",
    );

    const report = await createDryRunReport(
      manifestFor(approvedRoot, sourcePath, listedContent, {
        expectedCount: 1,
        approvedFields: ["id", "title"],
      }),
    );
    const serialized = JSON.stringify(report);
      const journals = report.resources.find(
        ({ resourceType }) => resourceType === "journals",
      );

      expect(journals).toMatchObject({ count: 1, errors: [] });
    expect(serialized).not.toContain(approvedRoot);
    expect(serialized).not.toContain(sourcePath);
    expect(serialized).not.toContain("SYNTHETIC_PRIVATE_MARKER");
    expect(serialized).not.toContain(sha256(listedContent));
  });

  it("reports redacted NDJSON, field, and count errors without raw content", async () => {
    const approvedRoot = temporaryDirectory();
    const sourcePath = join(approvedRoot, "journals.ndjson");
    const secretValue = "SYNTHETIC_SECRET_BODY";
    const content = [
      `{"id":1,"title":"Synthetic","content":"${secretValue}"}`,
      `{"id":2,"title":"Synthetic","private_note":"${secretValue}"}`,
      `["${secretValue}"]`,
      `not-json-${secretValue}`,
    ].join("\n") + "\n";
    writeSyntheticFile(sourcePath, content);

    const report = await createDryRunReport(
      manifestFor(approvedRoot, sourcePath, content, {
        expectedCount: 5,
        approvedFields: ["id", "title", "content"],
      }),
    );
      const resource = report.resources.find(
        ({ resourceType }) => resourceType === "journals",
      );
    const serialized = JSON.stringify(report);

      expect(resource?.count).toBe(4);
      expect(resource?.canonicalSha256).toBeNull();
      expect(resource?.errors).toEqual([
      "line 2: contains a field not listed in approvedFields",
      "line 3: must be a JSON object",
      "line 4: must be valid JSON",
      "count: expected 5 records but found 4",
    ]);
    expect(serialized).not.toContain(secretValue);
    expect(serialized).not.toContain(sourcePath);
    expect(report.overallDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects redacted digest drift after manifest validation", async () => {
    const approvedRoot = temporaryDirectory();
    const sourcePath = join(approvedRoot, "journals.ndjson");
    const original = '{"id":1,"title":"SYNTHETIC_ORIGINAL"}\n';
    const replacement = '{"id":1,"title":"SYNTHETIC_REPLACEMENT"}\n';
    writeSyntheticFile(sourcePath, original);
    const manifest = manifestFor(approvedRoot, sourcePath, original, {
      expectedCount: 1,
      approvedFields: ["id", "title"],
    });
    const replacementPath = join(approvedRoot, "replacement.ndjson");
    writeSyntheticFile(replacementPath, replacement);
    let openCount = 0;

    let failure: unknown;
    try {
      await createDryRunReport(manifest, {
        fileOps: {
          open: async (path, flags) => {
            openCount += 1;
            if (openCount === APPROVED_RESOURCE_TYPES.length + 1) {
              renameSync(replacementPath, sourcePath);
            }
            return await openFile(path, flags) as unknown as TestFileHandle;
          },
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    const serialized = String(failure);
    expect(serialized).toMatch(/invalid source manifest/i);
    expect(serialized).not.toContain(sourcePath);
    expect(serialized).not.toContain("SYNTHETIC_ORIGINAL");
    expect(serialized).not.toContain("SYNTHETIC_REPLACEMENT");
  });

  it("fails closed when a source exceeds 100000 records", async () => {
    const approvedRoot = temporaryDirectory();
    const sourcePath = join(approvedRoot, "journals.ndjson");
    const content = `${'{}\n'.repeat(100_001)}`;
    writeSyntheticFile(sourcePath, content);

    await expect(createDryRunReport(
      manifestFor(approvedRoot, sourcePath, content, {
        expectedCount: 100_001,
        approvedFields: [],
      }),
    )).rejects.toThrow(/invalid source manifest/i);
  });
});
