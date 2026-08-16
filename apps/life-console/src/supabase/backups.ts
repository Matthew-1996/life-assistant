import type { SupabaseClient } from "@supabase/supabase-js";
import { strToU8, zipSync } from "fflate";

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

export const BACKUP_FORMAT_VERSION = "life-console-backup/2";

export type LifeConsoleSnapshot = {
  schema_version: number;
  exported_at: string;
  profiles?: BackupRecord[];
  backup_runs?: BackupRecord[];
} & Record<BackupResourceName, BackupRecord[]>;

export interface BackupResourceMetadata {
  count: number;
  path: string;
  sha256: string;
}

export interface BackupManifest {
  format_version: typeof BACKUP_FORMAT_VERSION;
  source_product_version: string;
  source_schema_version: string;
  export_id: string;
  exported_at: string;
  resources: Record<BackupResourceName, BackupResourceMetadata>;
  archive_content_sha256: string;
}

export interface CreateBackupArchiveOptions {
  exportId: string;
  sourceProductVersion: string;
  sourceSchemaVersion: string;
}

export interface BackupArchiveResult {
  bytes: Uint8Array;
  archiveSha256: string;
  manifest: BackupManifest;
}

export interface BackupStatus {
  status: "pending" | "success" | "failed";
  requestedAt: string;
  completedAt: string | null;
  counts: Record<string, number>;
}

interface BackupRunRow {
  id: number;
  status: "pending" | "success" | "failed";
  created_at: string;
  completed_at: string | null;
  record_counts: Record<string, number>;
}

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
    || value.schema_version !== 2
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

function canonicalValue(value: unknown): unknown {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidSnapshot();
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  throw invalidSnapshot();
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

async function sha256Hex(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === "string" ? strToU8(value) : value;
  const input = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function validateOption(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidSnapshot();
  }
  return value;
}

export async function createBackupArchive(
  candidate: LifeConsoleSnapshot,
  options: CreateBackupArchiveOptions,
): Promise<BackupArchiveResult> {
  const snapshot = validateSnapshot(candidate);
  const files: Record<string, Uint8Array> = {};
  const metadataEntries: Array<
    readonly [BackupResourceName, BackupResourceMetadata]
  > = [];

  for (const name of BACKUP_RESOURCE_NAMES) {
    const rows = snapshot[name];
    const ndjson = rows.length === 0
      ? ""
      : `${rows.map(canonicalJson).join("\n")}\n`;
    const payload = strToU8(ndjson);
    const path = `data/${name}.ndjson`;
    files[path] = payload;
    metadataEntries.push([
      name,
      {
        count: rows.length,
        path,
        sha256: await sha256Hex(payload),
      },
    ]);
  }

  const resources = Object.fromEntries(
    metadataEntries,
  ) as Record<BackupResourceName, BackupResourceMetadata>;
  const canonicalResources = Object.fromEntries(
    [...metadataEntries]
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
  const manifest: BackupManifest = {
    format_version: BACKUP_FORMAT_VERSION,
    source_product_version: validateOption(options.sourceProductVersion),
    source_schema_version: validateOption(options.sourceSchemaVersion),
    export_id: validateOption(options.exportId),
    exported_at: snapshot.exported_at,
    resources,
    archive_content_sha256: await sha256Hex(
      canonicalJson(canonicalResources),
    ),
  };
  files["manifest.json"] = strToU8(canonicalJson(manifest));
  const bytes = zipSync(files, { level: 0 });
  return {
    bytes,
    archiveSha256: await sha256Hex(bytes),
    manifest,
  };
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

  async start(): Promise<BackupStatus> {
    const result = await this.client.rpc(
      "request_life_console_backup",
    ) as SupabaseResult<BackupRunRow[]>;
    if (result.error) {
      const status = result.status === 401 || result.status === 403
        ? result.status
        : 503;
      throw new RepositoryError(
        status === 503 ? "transient" : "unauthorized",
        status,
        status === 503 ? "backup_request_unavailable" : "unauthenticated",
        "The backup request was not saved",
      );
    }
    const rows = result.data;
    return this.publicStatus(rows?.[0]);
  }

  async latest(): Promise<BackupStatus | null> {
    const rows = await this.repository.executeRead<BackupRunRow[]>(
      async () =>
        await this.client
          .from("backup_runs")
          .select("id,status,created_at,completed_at,record_counts")
          .order("created_at", { ascending: false })
          .limit(1) as SupabaseResult<BackupRunRow[]>,
    );
    return rows?.[0] ? this.publicStatus(rows[0]) : null;
  }

  private publicStatus(row: BackupRunRow | undefined): BackupStatus {
    if (!row) throw invalidSnapshot();
    return {
      status: row.status,
      requestedAt: row.created_at,
      completedAt: row.completed_at,
      counts: row.record_counts,
    };
  }
}
