import type { SupabaseClient } from "@supabase/supabase-js";

import {
  LifeConsoleRepository,
  RepositoryError,
  type SupabaseResult,
} from "./repository";

export const BACKUP_RESOURCE_NAMES = [
  "goals",
  "journals",
  "journal_revisions",
  "daily_checkins",
  "weekly_reviews",
  "phase_reviews",
  "health_days",
  "health_segments",
] as const;

export type BackupResourceName = typeof BACKUP_RESOURCE_NAMES[number];
export type BackupRecord = Record<string, unknown>;

export type LifeConsoleSnapshot = {
  schema_version: number;
  exported_at: string;
  profiles?: BackupRecord[];
  backup_runs?: BackupRecord[];
} & Record<BackupResourceName, BackupRecord[]>;

function invalidSnapshot(): RepositoryError {
  return new RepositoryError(
    "validation",
    400,
    "backup_snapshot_invalid",
    "The backup snapshot does not match the supported schema",
  );
}

function isRecord(value: unknown): value is BackupRecord {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
  );
}

function validateSnapshot(value: unknown): LifeConsoleSnapshot {
  if (
    !isRecord(value)
    || value.schema_version !== 1
    || typeof value.exported_at !== "string"
    || value.exported_at.length === 0
  ) {
    throw invalidSnapshot();
  }
  for (const name of BACKUP_RESOURCE_NAMES) {
    const rows = value[name];
    if (!Array.isArray(rows) || rows.some((row) => !isRecord(row))) {
      throw invalidSnapshot();
    }
  }
  return value as LifeConsoleSnapshot;
}

export class BackupRepository {
  private readonly repository: LifeConsoleRepository;

  constructor(
    private readonly client: SupabaseClient,
    repository?: LifeConsoleRepository,
  ) {
    this.repository = repository ?? new LifeConsoleRepository(client);
  }

  async snapshot(): Promise<LifeConsoleSnapshot> {
    const value = await this.repository.executeRead<unknown>(
      async () =>
        await this.client.rpc(
          "export_life_console_snapshot",
        ) as SupabaseResult<unknown>,
    );
    return validateSnapshot(value);
  }
}
