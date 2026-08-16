// @vitest-environment node

import { createHash } from "node:crypto";
import {
  constants,
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
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

interface TestFileHandle {
  stat: () => Promise<{ isFile: () => boolean; size: number }>;
  read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
  ) => Promise<{ bytesRead: number; buffer: Buffer }>;
  close: () => Promise<void>;
}

interface TestFileOps {
  open: (path: string, flags: number) => Promise<TestFileHandle>;
}

const sourceManifestModule =
  "../../scripts/private-migration/source-manifest";
const {
  APPROVED_MIGRATION_RESOURCE_TYPES,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_RECORDS,
  readSourceFile,
  validateSourceManifest,
} = await import(sourceManifestModule) as {
  APPROVED_MIGRATION_RESOURCE_TYPES: readonly MigrationResourceType[];
  MAX_SOURCE_BYTES: number;
  MAX_SOURCE_RECORDS: number;
  readSourceFile: (
    sourcePath: string,
    options?: { fileOps?: TestFileOps },
  ) => Promise<Uint8Array>;
  validateSourceManifest: (
    candidate: unknown,
    options?: { fileOps?: TestFileOps },
  ) => Promise<SourceManifest>;
};

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "life-console-manifest-"));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Zeros(byteLength: number): string {
  const hash = createHash("sha256");
  const chunk = Buffer.alloc(64 * 1024);
  for (let remaining = byteLength; remaining > 0; remaining -= chunk.length) {
    hash.update(chunk.subarray(0, Math.min(remaining, chunk.length)));
  }
  return hash.digest("hex");
}

function writeSyntheticFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function fullSyntheticManifest(
  approvedRoot: string,
): SourceManifest {
  const resources = APPROVED_MIGRATION_RESOURCE_TYPES.map((resourceType) => {
    const sourcePath = join(approvedRoot, `${resourceType}.ndjson`);
    const content = `{"id":"synthetic-${resourceType}"}\n`;
    writeSyntheticFile(sourcePath, content);
    return {
      resourceType,
      sourcePath,
      sourceDigest: sha256(content),
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

describe("private migration source manifest", () => {
  it("accepts exactly the complete approved synthetic resource set", async () => {
    const approvedRoot = temporaryDirectory();
    const manifest = fullSyntheticManifest(approvedRoot);

    await expect(
      validateSourceManifest(manifest),
    ).resolves.toEqual(manifest);
    expect(APPROVED_MIGRATION_RESOURCE_TYPES).toEqual([
      "goals",
      "journals",
      "journal_revisions",
      "daily_checkins",
      "weekly_reviews",
      "phase_reviews",
      "health_days",
      "health_segments",
    ]);
  });

  it("accepts the 2.3.0 full-fidelity fields without opening arbitrary fields", async () => {
    const approvedRoot = temporaryDirectory();
    const manifest = fullSyntheticManifest(approvedRoot);
    const approvedByResource: Partial<Record<MigrationResourceType, string[]>> = {
      goals: ["id", "record_key"],
      journals: ["id", "record_key", "metadata"],
      daily_checkins: [
        "id", "sleep_time", "wake_time", "out_of_bed_time", "awake_in_bed",
      ],
      weekly_reviews: ["id", "record_key", "structured_data"],
      phase_reviews: ["id", "record_key", "structured_data"],
    };
    for (const resource of manifest.resources) {
      resource.approvedFields = approvedByResource[resource.resourceType] ?? ["id"];
    }

    await expect(validateSourceManifest(manifest)).resolves.toEqual(manifest);
  });

  it.each(APPROVED_MIGRATION_RESOURCE_TYPES)(
    "rejects a manifest missing approved resource type %s",
    async (missingResourceType) => {
      const approvedRoot = temporaryDirectory();
      const manifest = fullSyntheticManifest(approvedRoot);
      manifest.resources = manifest.resources.filter(
        ({ resourceType }) => resourceType !== missingResourceType,
      );

      await expect(validateSourceManifest(manifest)).rejects.toThrow(
        /invalid source manifest/i,
      );
    },
  );

  it.each([
    {
      name: "relative source path",
      mutate: (manifest: SourceManifest) => {
        manifest.resources[0].sourcePath = "goals.ndjson";
      },
    },
    {
      name: "source outside approved root",
      mutate: (manifest: SourceManifest, outsidePath: string) => {
        manifest.resources[0].sourcePath = outsidePath;
      },
    },
    {
      name: "non-canonical source path",
      mutate: (manifest: SourceManifest) => {
        manifest.resources[0].sourcePath = join(
          manifest.approvedRoot,
          "nested",
          "..",
          "goals.ndjson",
        ).replace("/goals.ndjson", "/nested/../goals.ndjson");
      },
    },
    {
      name: "unknown resource type",
      mutate: (manifest: SourceManifest) => {
        manifest.resources[0].resourceType = "profiles" as "goals";
      },
    },
    {
      name: "unknown approved field",
      mutate: (manifest: SourceManifest) => {
        manifest.resources[0].approvedFields = ["id", "secret"];
      },
    },
    {
      name: "negative expected count",
      mutate: (manifest: SourceManifest) => {
        manifest.resources[0].expectedCount = -1;
      },
    },
    {
      name: "non-integer expected count",
      mutate: (manifest: SourceManifest) => {
        manifest.resources[0].expectedCount = 1.5;
      },
    },
    {
      name: "invalid SHA-256",
      mutate: (manifest: SourceManifest) => {
        manifest.resources[0].sourceDigest = "not-a-digest";
      },
    },
    {
      name: "uppercase SHA-256",
      mutate: (manifest: SourceManifest) => {
        manifest.resources[0].sourceDigest =
          manifest.resources[0].sourceDigest.toUpperCase();
      },
    },
    {
      name: "source digest mismatch",
      mutate: (manifest: SourceManifest) => {
        manifest.resources[0].sourceDigest = "0".repeat(64);
      },
    },
  ])("fails closed for $name", async ({ mutate }) => {
    const approvedRoot = temporaryDirectory();
    const outsideRoot = temporaryDirectory();
    const outsidePath = join(outsideRoot, "goals.ndjson");
    writeSyntheticFile(outsidePath, '{"id":1,"title":"Synthetic goal"}\n');
      const manifest = fullSyntheticManifest(approvedRoot);
    mutate(manifest, outsidePath);

    await expect(validateSourceManifest(manifest)).rejects.toThrow(
      /invalid source manifest/i,
    );
  });

  it("rejects duplicate resource types", async () => {
    const approvedRoot = temporaryDirectory();
    const manifest = fullSyntheticManifest(approvedRoot);
    manifest.resources[1] = { ...manifest.resources[0] };

    await expect(validateSourceManifest(manifest)).rejects.toThrow(
      /invalid source manifest/i,
    );
  });

  it("rejects a symlink source even when its target is approved", async () => {
    const approvedRoot = temporaryDirectory();
    const targetPath = join(approvedRoot, "target.ndjson");
    const sourcePath = join(approvedRoot, "goals-link.ndjson");
    const content = '{"id":1,"title":"Synthetic goal"}\n';
    writeSyntheticFile(targetPath, content);
    symlinkSync(targetPath, sourcePath);
    const manifest = fullSyntheticManifest(approvedRoot);
    manifest.resources[0] = {
      ...manifest.resources[0],
      sourcePath,
      sourceDigest: sha256(content),
      approvedFields: ["id", "title"],
    };

    await expect(
      validateSourceManifest(manifest),
    ).rejects.toThrow(/invalid source manifest/i);
  });

  it("rejects a source replaced by a symlink at safe open time", async () => {
    const approvedRoot = temporaryDirectory();
    const manifest = fullSyntheticManifest(approvedRoot);
    const sourcePath = manifest.resources[0].sourcePath;
    const targetPath = join(approvedRoot, "replacement-target.ndjson");
    const originalPath = join(approvedRoot, "original-goals.ndjson");
    writeSyntheticFile(targetPath, '{"id":"synthetic-goals"}\n');
    let replaced = false;

    await expect(validateSourceManifest(manifest, {
      fileOps: {
        open: async (path, flags) => {
          if (path === sourcePath && !replaced) {
            replaced = true;
            renameSync(sourcePath, originalPath);
            symlinkSync(targetPath, sourcePath);
          }
          expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
          return await openFile(path, flags) as unknown as TestFileHandle;
        },
      },
    })).rejects.toThrow(/invalid source manifest/i);
  });

  it("fails closed before reading a source larger than 16 MiB", async () => {
    expect(MAX_SOURCE_BYTES).toBe(16 * 1024 * 1024);
    expect(MAX_SOURCE_RECORDS).toBe(100_000);
    const approvedRoot = temporaryDirectory();
    const manifest = fullSyntheticManifest(approvedRoot);
    const sourcePath = manifest.resources[0].sourcePath;
    const oversizedBytes = MAX_SOURCE_BYTES + 1;
    truncateSync(sourcePath, oversizedBytes);
    manifest.resources[0].sourceDigest = sha256Zeros(oversizedBytes);

    await expect(validateSourceManifest(manifest)).rejects.toThrow(
      /invalid source manifest/i,
    );
  });

  it("stops at the strict byte limit when a source grows after stat", async () => {
    const sourcePath = "/synthetic/private-marker.ndjson";
    const privateMarker = "SYNTHETIC_PRIVATE_BODY";
    const availableBytes = MAX_SOURCE_BYTES + 64 * 1024;
    let bytesReadTotal = 0;
    let closeCount = 0;
    let readCount = 0;
    const fileOps: TestFileOps = {
      open: async (_path, flags) => {
        expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
        return {
          stat: async () => ({ isFile: () => true, size: 1 }),
          read: async (buffer, offset, length, position) => {
            expect(position).toBeNull();
            if (bytesReadTotal >= MAX_SOURCE_BYTES + 1) {
              throw new Error("read continued beyond strict limit");
            }
            readCount += 1;
            const bytesRead = Math.min(
              length,
              availableBytes - bytesReadTotal,
            );
            buffer.fill(0x61, offset, offset + bytesRead);
            if (bytesReadTotal === 0) {
              buffer.write(privateMarker, offset, "utf8");
            }
            bytesReadTotal += bytesRead;
            return { bytesRead, buffer };
          },
          close: async () => {
            closeCount += 1;
          },
        };
      },
    };

    let failure: unknown;
    try {
      await readSourceFile(sourcePath, { fileOps });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toMatch(/invalid source manifest/i);
    expect(String(failure)).not.toContain(sourcePath);
    expect(String(failure)).not.toContain(privateMarker);
    expect(bytesReadTotal).toBe(MAX_SOURCE_BYTES + 1);
    expect(readCount).toBe(257);
    expect(closeCount).toBe(1);
  });
});
