import type { SupabaseClient } from "@supabase/supabase-js";

import {
  APPROVED_MIGRATION_RESOURCE_TYPES,
  type MigrationResourceType,
  type SourceManifest,
} from "./source-manifest";

interface Mismatch {
  resourceType: MigrationResourceType;
  issue: string;
  expected?: unknown;
  actual?: unknown;
}

export interface VerificationResult {
  match: boolean;
  mismatches: Mismatch[];
  errors: string[];
}

async function checkError(
  result: { error: unknown },
  message: string,
): Promise<void> {
  if (result.error) {
    throw new Error(message);
  }
}

export async function verifyMigration(options: {
  manifest: SourceManifest;
  migrationRunId: string;
  client: SupabaseClient;
  ownerUserId: string;
}): Promise<VerificationResult> {
  const { manifest, migrationRunId, client, ownerUserId } = options;
  const mismatches: Mismatch[] = [];
  const errors: string[] = [];

  const { data: run, error: runError } = await client
    .from("migration_runs")
    .select("id, status")
    .eq("id", migrationRunId)
    .single();
  if (runError || !run) {
    errors.push("Migration run not found");
    return { match: false, mismatches, errors };
  }
  if (run.status !== "completed") {
    errors.push(`Migration run status is ${run.status}, expected completed`);
  }

  const { data: allImports, error: importsError } = await client
    .from("migration_imports")
    .select("table_name, source_stable_id, imported_id")
    .eq("migration_run_id", migrationRunId);
  if (importsError) {
    errors.push("Failed to read migration imports");
    return { match: false, mismatches, errors };
  }

  const importsByTable = new Map<MigrationResourceType, Array<{
    source_stable_id: string;
    imported_id: number;
  }>>();
  for (const imp of allImports ?? []) {
    const tableName = imp.table_name as MigrationResourceType;
    if (!importsByTable.has(tableName)) {
      importsByTable.set(tableName, []);
    }
    importsByTable.get(tableName)!.push({
      source_stable_id: imp.source_stable_id,
      imported_id: imp.imported_id,
    });
  }

  const expectedResourceTypes = new Set(manifest.resources.map((r) => r.resourceType));
  for (const resourceType of APPROVED_MIGRATION_RESOURCE_TYPES) {
    if (!expectedResourceTypes.has(resourceType)) {
      errors.push(`Manifest missing resource type ${resourceType}`);
      continue;
    }
    const resource = manifest.resources.find(
      (r) => r.resourceType === resourceType,
    )!;
    const tableImports = importsByTable.get(resourceType) ?? [];

    if (tableImports.length !== resource.expectedCount) {
      mismatches.push({
        resourceType,
        issue: "count_mismatch",
        expected: resource.expectedCount,
        actual: tableImports.length,
      });
      continue;
    }

    if (tableImports.length === 0) continue;

    const importedIds = tableImports.map((imp) => imp.imported_id);
    const batchSize = 500;
    let verifiedCount = 0;
    for (let i = 0; i < importedIds.length; i += batchSize) {
      const batch = importedIds.slice(i, i + batchSize);
      const { data: rows, error: readError } = await client
        .from(resourceType)
        .select("id, user_id")
        .in("id", batch);
      if (readError) {
        errors.push(`Failed to read back ${resourceType}`);
        break;
      }
      const rowsList = rows ?? [];
      verifiedCount += rowsList.length;
      for (const row of rowsList) {
        if (row.user_id !== ownerUserId) {
          mismatches.push({
            resourceType,
            issue: "wrong_owner",
            expected: ownerUserId,
            actual: row.user_id,
          });
        }
      }
    }

    if (verifiedCount !== resource.expectedCount) {
      mismatches.push({
        resourceType,
        issue: "records_missing",
        expected: resource.expectedCount,
        actual: verifiedCount,
      });
    }
  }

  const match = mismatches.length === 0 && errors.length === 0;
  return { match, mismatches, errors };
}
