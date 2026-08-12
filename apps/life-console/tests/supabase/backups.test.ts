import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
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
    schema_version: 1,
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
    ["schema_version", 1],
    ["exported_at", "2030-01-02T03:04:05Z"],
    ...BACKUP_RESOURCE_NAMES.map((name) => [name, []]),
  ]) as LifeConsoleSnapshot;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("synthetic backup snapshots", () => {
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
      snapshot: { ...syntheticSnapshot(), schema_version: 2 },
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

describe("life-console-backup/1 packaging", () => {
  const options = {
    exportId: "synthetic-export-0001",
    sourceProductVersion: "2.2.0",
    sourceSchemaVersion: "supabase/1",
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
      source_product_version: "2.2.0",
      source_schema_version: "supabase/1",
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
});
