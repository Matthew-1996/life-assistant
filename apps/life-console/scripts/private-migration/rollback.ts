import type { SupabaseClient } from "@supabase/supabase-js";

import type { MigrationResourceType } from "./source-manifest";

const ROLLBACK_ORDER: readonly MigrationResourceType[] = [
  "health_segments",
  "journal_revisions",
  "health_days",
  "phase_reviews",
  "weekly_reviews",
  "daily_checkins",
  "journals",
  "goals",
];

interface TableDeletion {
  tableName: MigrationResourceType;
  deletedCount: number;
}

export interface RollbackStats {
  deletedImports: number;
  deletedRecords: number;
  tables: TableDeletion[];
}

async function checkError(
  result: { error: unknown },
  message: string,
): Promise<void> {
  if (result.error) {
    throw new Error(message);
  }
}

export async function rollbackMigration(options: {
  migrationRunId: string;
  client: SupabaseClient;
  ownerUserId: string;
}): Promise<RollbackStats> {
  const { migrationRunId, client, ownerUserId: _ownerUserId } = options;
  const tables: TableDeletion[] = [];
  let deletedRecords = 0;

  const { data: imports, error: importsError } = await client
    .from("migration_imports")
    .select("id, table_name, imported_id")
    .eq("migration_run_id", migrationRunId);
  await checkError({ error: importsError }, "Failed to read migration imports");

  const importsByTable = new Map<MigrationResourceType, number[]>();
  for (const imp of imports ?? []) {
    const tableName = imp.table_name as MigrationResourceType;
    if (!importsByTable.has(tableName)) {
      importsByTable.set(tableName, []);
    }
    importsByTable.get(tableName)!.push(imp.imported_id);
  }

  for (const tableName of ROLLBACK_ORDER) {
    const idsToDelete = importsByTable.get(tableName);
    if (!idsToDelete || idsToDelete.length === 0) {
      tables.push({ tableName, deletedCount: 0 });
      continue;
    }

    const batchSize = 500;
    let deletedFromTable = 0;
    for (let i = 0; i < idsToDelete.length; i += batchSize) {
      const batch = idsToDelete.slice(i, i + batchSize);
      const { error: deleteError } = await client
        .from(tableName)
        .delete()
        .in("id", batch);
      if (deleteError) {
        throw new Error(`Failed to delete from ${tableName}`);
      }
      deletedFromTable += batch.length;
    }
    tables.push({ tableName, deletedCount: deletedFromTable });
    deletedRecords += deletedFromTable;
  }

  const { error: deleteImportsError } = await client
    .from("migration_imports")
    .delete()
    .eq("migration_run_id", migrationRunId);
  await checkError(
    { error: deleteImportsError },
    "Failed to delete migration import records",
  );

  const { error: deleteRunError } = await client
    .from("migration_runs")
    .delete()
    .eq("id", migrationRunId);
  await checkError(
    { error: deleteRunError },
    "Failed to delete migration run record",
  );

  return {
    deletedImports: imports?.length ?? 0,
    deletedRecords,
    tables,
  };
}
