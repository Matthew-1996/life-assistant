import type { SupabaseClient } from "@supabase/supabase-js";

import { sha256Hex } from "./canonical-digest";
import {
  APPROVED_MIGRATION_RESOURCE_TYPES,
  type MigrationResourceType,
  readSourceFile,
  type SourceManifest,
} from "./source-manifest";
import type { DryRunReport } from "./dry-run";

const IMPORT_ORDER: readonly MigrationResourceType[] = [
  "goals",
  "journals",
  "daily_checkins",
  "weekly_reviews",
  "phase_reviews",
  "health_days",
  "journal_revisions",
  "health_segments",
];

const FOREIGN_KEY_MAP: Partial<Record<MigrationResourceType, {
  field: string;
  references: MigrationResourceType;
}>> = {
  journal_revisions: { field: "journal_id", references: "journals" },
  health_segments: { field: "health_day_id", references: "health_days" },
};

interface ImportedRecord {
  tableName: MigrationResourceType;
  sourceStableId: string;
  importedId: number;
}

export interface ImportStats {
  inserted: number;
  skipped: number;
  failed: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function* parseLines(content: string): Generator<[number, string]> {
  let start = 0;
  let lineNumber = 0;
  while (start < content.length) {
    lineNumber += 1;
    const newline = content.indexOf("\n", start);
    if (newline === -1) {
      const line = content.slice(start);
      if (line.length > 0) {
        yield [lineNumber, line];
      }
      return;
    }
    const line = content.slice(start, newline);
    if (line.length > 0) {
      yield [lineNumber, line];
    }
    start = newline + 1;
  }
}

function sourceStableIdFor(
  _tableName: MigrationResourceType,
  record: Record<string, unknown>,
): string {
  const rawId = record.id;
  if (typeof rawId === "string" && rawId.length > 0) {
    return rawId;
  }
  if (typeof rawId === "number" && Number.isFinite(rawId)) {
    return String(rawId);
  }
  return sha256Hex(JSON.stringify(record, Object.keys(record).sort()));
}

function recordWithoutId(record: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, ...rest } = record;
  return rest;
}

async function checkError(
  result: { error: unknown },
  message: string,
): Promise<void> {
  if (result.error) {
    throw new Error(message);
  }
}

export async function importMigration(options: {
  manifest: SourceManifest;
  dryRunReport: DryRunReport;
  migrationRunId: string;
  client: SupabaseClient;
  ownerUserId: string;
}): Promise<ImportStats> {
  const { manifest, dryRunReport, migrationRunId, client, ownerUserId } = options;

  if (dryRunReport.resources.some((r) => r.errors.length > 0)) {
    throw new Error("Dry run contains errors; refusing to import");
  }

  const stats: ImportStats = { inserted: 0, skipped: 0, failed: 0 };
  const imported: ImportedRecord[] = [];
  const idMap = new Map<string, number>();

  const { error: runInsertError } = await client
    .from("migration_runs")
    .insert({
      id: migrationRunId,
      manifest_digest: dryRunReport.overallDigest,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select()
    .single();
  await checkError({ error: runInsertError }, "Failed to create migration run");

  try {
    const resourceMap = new Map(
      manifest.resources.map((r) => [r.resourceType, r]),
    );
    const dryRunMap = new Map(
      dryRunReport.resources.map((r) => [r.resourceType, r]),
    );

    for (const resourceType of IMPORT_ORDER) {
      const resource = resourceMap.get(resourceType);
      const dryRun = dryRunMap.get(resourceType);
      if (!resource || !dryRun) continue;

      const bytes = await readSourceFile(resource.sourcePath);
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const approvedFields = new Set(resource.approvedFields);
      const fkMapping = FOREIGN_KEY_MAP[resourceType];

      const { data: existingImports, error: existingError } = await client
        .from("migration_imports")
        .select("source_stable_id, imported_id")
        .eq("migration_run_id", migrationRunId)
        .eq("table_name", resourceType);
      await checkError({ error: existingError }, "Failed to check existing imports");

      const existingStableIds = new Set(
        (existingImports ?? []).map((row) => row.source_stable_id),
      );
      for (const row of existingImports ?? []) {
        idMap.set(`${resourceType}:${row.source_stable_id}`, row.imported_id);
      }

      const recordsToInsert: Array<Record<string, unknown>> = [];
      for (const [, line] of parseLines(content)) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          stats.failed += 1;
          continue;
        }
        if (!isObject(parsed)) {
          stats.failed += 1;
          continue;
        }
        if (Object.keys(parsed).some((field) => !approvedFields.has(field))) {
          stats.failed += 1;
          continue;
        }

        const stableId = sourceStableIdFor(resourceType, parsed);
        if (existingStableIds.has(stableId)) {
          stats.skipped += 1;
          continue;
        }

        const record = {
          ...recordWithoutId(parsed),
          user_id: ownerUserId,
        };

        if (fkMapping) {
          const fkValue = record[fkMapping.field];
          if (typeof fkValue === "string" || typeof fkValue === "number") {
            const newId = idMap.get(`${fkMapping.references}:${fkValue}`);
            if (newId !== undefined) {
              record[fkMapping.field] = newId;
            }
          }
        }

        recordsToInsert.push({ _stableId: stableId, record });
      }

      const batchSize = 100;
      for (let i = 0; i < recordsToInsert.length; i += batchSize) {
        const batch = recordsToInsert.slice(i, i + batchSize);
        const records = batch.map((b) => b.record);
        const stableIds = batch.map((b) => b._stableId as string);

        const { data: inserted, error: insertError } = await client
          .from(resourceType)
          .insert(records)
          .select("id");
        if (insertError) {
          throw new Error(`Failed to import ${resourceType}`);
        }

        const importRecords = (inserted ?? []).map((row, index) => ({
          migration_run_id: migrationRunId,
          table_name: resourceType,
          source_stable_id: stableIds[index],
          imported_id: row.id as number,
        }));

        const { error: trackError } = await client
          .from("migration_imports")
          .insert(importRecords);
        if (trackError) {
          throw new Error(`Failed to track imports for ${resourceType}`);
        }

        for (let j = 0; j < importRecords.length; j += 1) {
          const imp = importRecords[j];
          idMap.set(`${resourceType}:${imp.source_stable_id}`, imp.imported_id);
          imported.push({
            tableName: resourceType,
            sourceStableId: imp.source_stable_id,
            importedId: imp.imported_id,
          });
          stats.inserted += 1;
        }
      }
    }

    const { error: completeError } = await client
      .from("migration_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", migrationRunId);
    await checkError({ error: completeError }, "Failed to mark migration completed");

    return stats;
  } catch (error) {
    const { error: failUpdateError } = await client
      .from("migration_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", migrationRunId);
    if (failUpdateError) {
      // ignore secondary failure
    }

    for (let i = imported.length - 1; i >= 0; i -= 1) {
      const imp = imported[i];
      try {
        await client.from(imp.tableName).delete().eq("id", imp.importedId);
      } catch {
        // ignore rollback errors
      }
    }
    try {
      await client
        .from("migration_imports")
        .delete()
        .eq("migration_run_id", migrationRunId);
    } catch {
      // ignore rollback errors
    }

    throw error instanceof Error ? error : new Error("Import failed");
  }
}
