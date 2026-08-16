import type { SupabaseClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import {
  BACKUP_FORMAT_VERSION,
  BACKUP_RESOURCE_NAMES,
  BackupRepository,
  createBackupArchive,
  type BackupManifest,
  type LifeConsoleSnapshot,
} from "../../src/supabase/backups";

function syntheticSnapshot(): LifeConsoleSnapshot {
  return {
    schema_version: 2,
    exported_at: "2030-01-02T03:04:05Z",
    profiles: [{ user_id: "synthetic-owner" }],
    goals: [{ id: 1, title: "Synthetic goal" }],
    journals: [{ id: 2, content: "Synthetic journal" }],
    journal_revisions: [{ id: 3, journal_id: 2, revision: 1 }],
    daily_checkins: [{ id: 4, mood: null }],
    weekly_reviews: [{ id: 5, content: "Synthetic week" }],
    phase_reviews: [{ id: 6, content: "Synthetic phase" }],
    health_days: [{ id: 7, steps: 1234 }],
    health_segments: [{ id: 8, kind: "sleep" }],
    backup_runs: [{ id: 9, status: "completed" }],
  };
}

function clientWithRpc(
  rpc: ReturnType<typeof vi.fn>,
): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

function emptySnapshot(): LifeConsoleSnapshot {
  return Object.fromEntries([
    ["schema_version", 2],
    ["exported_at", "2030-01-02T03:04:05Z"],
    ...BACKUP_RESOURCE_NAMES.map((name) => [name, []]),
  ]) as LifeConsoleSnapshot;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("synthetic backup snapshots", () => {
  it("creates a pending manual backup request and reads only redacted status", async () => {
    const rpc = vi.fn(async () => ({
      data: [{
        id: 12,
        status: "pending",
        created_at: "2030-01-02T03:04:05Z",
        completed_at: null,
        record_counts: {},
      }],
      error: null,
      status: 201,
    }));
    const limit = vi.fn(async () => ({
      data: [{
        id: 11,
        status: "success",
        created_at: "2030-01-01T03:04:05Z",
        completed_at: "2030-01-01T03:05:05Z",
        record_counts: { journals: 4 },
      }],
      error: null,
      status: 200,
    }));
    const client = {
      rpc,
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          order: vi.fn(() => ({ limit })),
        })),
      })),
    } as unknown as SupabaseClient;
    const repository = new BackupRepository(client);

    await expect(repository.start()).resolves.toMatchObject({
      status: "pending",
    });
    expect(rpc).toHaveBeenCalledWith("request_life_console_backup");
    await expect(repository.latest()).resolves.toEqual({
      status: "success",
      requestedAt: "2030-01-01T03:04:05Z",
      completedAt: "2030-01-01T03:05:05Z",
      counts: { journals: 4 },
    });
  });

  it("reads the owner snapshot through the single invoker RPC", async () => {
    const snapshot = syntheticSnapshot();
    const rpc = vi.fn(async () => ({
      data: snapshot,
      error: null,
      status: 200,
    }));
    const repository = new BackupRepository(clientWithRpc(rpc));

    await expect(repository.snapshot()).resolves.toEqual(snapshot);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("export_life_console_snapshot");
    expect(BACKUP_RESOURCE_NAMES).toEqual([
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

  it("retries one transient snapshot read", async () => {
    const snapshot = syntheticSnapshot();
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST000", message: "synthetic timeout" },
        status: 503,
      })
      .mockResolvedValueOnce({
        data: snapshot,
        error: null,
        status: 200,
      });
    const repository = new BackupRepository(clientWithRpc(rpc));

    await expect(repository.snapshot()).resolves.toEqual(snapshot);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: "unsupported schema",
      snapshot: { ...syntheticSnapshot(), schema_version: 1 },
    },
    {
      name: "missing resource",
      snapshot: (() => {
        const value = { ...syntheticSnapshot() };
        delete (value as Partial<LifeConsoleSnapshot>).health_segments;
        return value;
      })(),
    },
    {
      name: "non-object resource row",
      snapshot: {
        ...syntheticSnapshot(),
        goals: ["not-an-object"],
      },
    },
  ])("rejects an invalid snapshot: $name", async ({ snapshot }) => {
    const rpc = vi.fn(async () => ({
      data: snapshot,
      error: null,
      status: 200,
    }));
    const repository = new BackupRepository(clientWithRpc(rpc));

    await expect(repository.snapshot()).rejects.toMatchObject({
      kind: "validation",
      status: 400,
      code: "backup_snapshot_invalid",
    });
  });
});

describe("life-console-backup/2 packaging", () => {
  const options = {
    exportId: "synthetic-export-0001",
    sourceProductVersion: "2.3.0",
    sourceSchemaVersion: "supabase/2",
  };

  it("packages exactly eight empty NDJSON resources and one manifest", async () => {
    const result = await createBackupArchive(emptySnapshot(), options);
    const files = unzipSync(result.bytes);
    const expectedPaths = [
      "manifest.json",
      ...BACKUP_RESOURCE_NAMES.map((name) => `data/${name}.ndjson`),
    ].sort();

    expect(Object.keys(files).sort()).toEqual(expectedPaths);
    for (const name of BACKUP_RESOURCE_NAMES) {
      expect(files[`data/${name}.ndjson`]).toHaveLength(0);
      expect(result.manifest.resources[name]).toEqual({
        count: 0,
        path: `data/${name}.ndjson`,
        sha256: sha256(""),
      });
    }
    expect(result.manifest).toMatchObject({
      format_version: BACKUP_FORMAT_VERSION,
      source_product_version: "2.3.0",
      source_schema_version: "supabase/2",
      export_id: "synthetic-export-0001",
      exported_at: "2030-01-02T03:04:05Z",
    });
    expect(result.archiveSha256).toBe(sha256(result.bytes));
  });

  it("writes canonical UTF-8 NDJSON and independently verifiable digests", async () => {
    const snapshot = emptySnapshot();
    snapshot.journals = [
      {
        z: 9,
        title: "合成日记",
        nested: { second: 2, first: 1 },
        tags: ["beta", "alpha"],
        id: 2,
      },
      { id: 3, title: "Synthetic follow-up" },
    ];
    snapshot.profiles = [{ user_id: "excluded-owner" }];
    snapshot.backup_runs = [{ id: 99, status: "excluded" }];

    const result = await createBackupArchive(snapshot, options);
    const files = unzipSync(result.bytes);
    const journals = strFromU8(files["data/journals.ndjson"]);
    const manifest = JSON.parse(
      strFromU8(files["manifest.json"]),
    ) as BackupManifest;

    expect(journals).toBe(
      '{"id":2,"nested":{"first":1,"second":2},"tags":["beta","alpha"],'
      + '"title":"合成日记","z":9}\n'
      + '{"id":3,"title":"Synthetic follow-up"}\n',
    );
    expect(manifest.resources.journals).toEqual({
      count: 2,
      path: "data/journals.ndjson",
      sha256: sha256(journals),
    });
    const canonicalResources = Object.fromEntries(
      Object.entries(manifest.resources)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, metadata]) => [
          name,
          {
            count: metadata.count,
            path: metadata.path,
            sha256: metadata.sha256,
          },
        ]),
    );
    expect(manifest.archive_content_sha256).toBe(
      sha256(JSON.stringify(canonicalResources)),
    );
    expect(strFromU8(files["manifest.json"])).not.toContain("profiles");
    expect(strFromU8(files["manifest.json"])).not.toContain("backup_runs");
    expect(result.manifest).toEqual(manifest);
  });

  it("packages a synthetic 2000-record resource within Agent limits", async () => {
    const snapshot = emptySnapshot();
    snapshot.daily_checkins = Array.from({ length: 2_000 }, (_, index) => ({
      id: index + 1,
      checkin_date: `2030-01-${String((index % 28) + 1).padStart(2, "0")}`,
      mood: (index % 5) + 1,
      note: `Synthetic check-in ${index + 1}`,
    }));

    const result = await createBackupArchive(snapshot, options);
    const files = unzipSync(result.bytes);

    expect(result.manifest.resources.daily_checkins.count).toBe(2_000);
    expect(
      strFromU8(files["data/daily_checkins.ndjson"]).split("\n"),
    ).toHaveLength(2_001);
    expect(result.bytes.byteLength).toBeLessThan(64 * 1024 * 1024);
  });

  it("rejects unsupported snapshot rows before creating an archive", async () => {
    const snapshot = emptySnapshot();
    snapshot.goals = [null as unknown as Record<string, unknown>];

    await expect(
      createBackupArchive(snapshot, options),
    ).rejects.toMatchObject({
      kind: "validation",
      status: 400,
      code: "backup_snapshot_invalid",
    });
  });

  it("round-trips through the existing local Agent without leaking payloads", async () => {
    const snapshot = syntheticSnapshot();
    snapshot.journals = [{
      id: 2,
      content: "x".repeat(100_000),
    }];
    const result = await createBackupArchive(snapshot, options);
    const root = mkdtempSync(join(tmpdir(), "life-console-synthetic-"));
    const archivePath = join(root, "candidate.zip");
    const targetPath = join(root, "backup", "latest.zip");
    const receiptPath = join(root, "state", "receipts.json");
    writeFileSync(archivePath, result.bytes);
    const script = `
import json
import sys
from pathlib import Path
from local_agent.backup_store import BackupStore

archive_path, target_path, receipt_path, digest = sys.argv[1:]
store = BackupStore(
    target_path=Path(target_path),
    receipt_path=Path(receipt_path),
)
with open(archive_path, "rb") as source:
    receipt = store.install(
        source,
        run_id="run_synthetic_220",
        expected_archive_sha256=digest,
    )
print(json.dumps(receipt.to_public_dict(), sort_keys=True))
`;

    try {
      const completed = spawnSync(
        "python3",
        [
          "-c",
          script,
          archivePath,
          targetPath,
          receiptPath,
          result.archiveSha256,
        ],
        {
          cwd: join(process.cwd()),
          encoding: "utf-8",
        },
      );

      expect(completed.stderr).toBe("");
      expect(completed.status).toBe(0);
      const receipt = JSON.parse(completed.stdout) as {
        archive_sha256: string;
        counts: Record<string, number>;
        format_version: string;
      };
      expect(receipt).toMatchObject({
        archive_sha256: result.archiveSha256,
        format_version: BACKUP_FORMAT_VERSION,
      });
      expect(receipt.counts).toEqual(
        Object.fromEntries(
          BACKUP_RESOURCE_NAMES.map((name) => [
            name,
            result.manifest.resources[name].count,
          ]),
        ),
      );
      expect(readFileSync(targetPath)).toEqual(Buffer.from(result.bytes));
      expect(completed.stdout).not.toContain("Synthetic journal");
      expect(completed.stdout).not.toContain(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
