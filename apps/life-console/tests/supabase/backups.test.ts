import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  BACKUP_RESOURCE_NAMES,
  BackupRepository,
  type LifeConsoleSnapshot,
} from "../../src/supabase/backups";
import { RepositoryError } from "../../src/supabase/repository";

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

    await expect(repository.snapshot()).rejects.toMatchObject<
      Partial<RepositoryError>
    >({
      kind: "validation",
      status: 400,
      code: "backup_snapshot_invalid",
    });
  });
});
