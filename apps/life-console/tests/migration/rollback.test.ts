// @vitest-environment node

import { randomUUID } from "node:crypto";

import { describe, expect, it, beforeEach } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

type MigrationResourceType =
  | "goals"
  | "journals"
  | "journal_revisions"
  | "daily_checkins"
  | "weekly_reviews"
  | "phase_reviews"
  | "health_days"
  | "health_segments";

interface RollbackStats {
  deletedImports: number;
  deletedRecords: number;
  tables: Array<{ tableName: MigrationResourceType; deletedCount: number }>;
}

type CallEntry = {
  table: string;
  method: "select" | "insert" | "update" | "delete";
};

const rollbackModule = "../../scripts/private-migration/rollback";
const { rollbackMigration } = await import(rollbackModule) as {
  rollbackMigration: (options: {
    migrationRunId: string;
    client: SupabaseClient;
    ownerUserId: string;
  }) => Promise<RollbackStats>;
};

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

interface MockRow {
  [key: string]: unknown;
  id: number;
}

interface StoredImport {
  tableName: MigrationResourceType;
  sourceStableId: string;
  importedId: number;
}

let storedRows = new Map<string, Map<number, MockRow>>();
let storedImports = new Map<string, StoredImport[]>();
let migrationRuns = new Map<string, { id: string; status: string }>();
let nextId = 1;
let callLog: CallEntry[] = [];

function resetMockState(): void {
  storedRows = new Map();
  storedImports = new Map();
  migrationRuns = new Map();
  nextId = 1;
  callLog = [];
}

function seedMigration(
  migrationRunId: string,
  ownerUserId: string,
  recordCounts: Partial<Record<MigrationResourceType, number>>,
): void {
  migrationRuns.set(migrationRunId, { id: migrationRunId, status: "completed" });
  storedImports.set(migrationRunId, []);
  for (const resourceType of APPROVED_RESOURCE_TYPES) {
    const count = recordCounts[resourceType] ?? 0;
    if (!storedRows.has(resourceType)) {
      storedRows.set(resourceType, new Map());
    }
    const tableRows = storedRows.get(resourceType)!;
    for (let i = 0; i < count; i++) {
      const id = nextId++;
      tableRows.set(id, { id, user_id: ownerUserId });
      storedImports.get(migrationRunId)!.push({
        tableName: resourceType,
        sourceStableId: `synthetic-${resourceType}-${i}`,
        importedId: id,
      });
    }
  }
}

function seedOtherData(ownerUserId: string): Array<{ table: string; id: number }> {
  const otherRunId = randomUUID();
  migrationRuns.set(otherRunId, { id: otherRunId, status: "completed" });
  storedImports.set(otherRunId, []);
  const otherData: Array<{ table: string; id: number }> = [];
  if (!storedRows.has("goals")) storedRows.set("goals", new Map());
  const goalsTable = storedRows.get("goals")!;
  const id = nextId++;
  goalsTable.set(id, { id, user_id: ownerUserId, title: "Other goal" });
  storedImports.get(otherRunId)!.push({
    tableName: "goals",
    sourceStableId: "other-goal",
    importedId: id,
  });
  otherData.push({ table: "goals", id });
  return otherData;
}

function createMockClient() {
  return {
    from: (table: string) => {
      let method: "select" | "insert" | "update" | "delete" = "select";
      const filters: Record<string, unknown> = {};
      const filterIns: Record<string, unknown[]> = {};
      const self: Record<string, unknown> = {};

      self.select = (_columns?: string) => self;
      self.delete = () => {
        method = "delete";
        return self;
      };
      self.update = (_values: unknown) => {
        method = "update";
        return self;
      };
      self.eq = (column: string, value: unknown) => {
        filters[column] = value;
        return self;
      };
      self.in = (column: string, values: unknown[]) => {
        filterIns[column] = values;
        return self;
      };
      self.match = (query: Record<string, unknown>) => {
        Object.assign(filters, query);
        return self;
      };

      async function execute(): Promise<{
        data: unknown;
        error: null | { message: string };
        status: number;
      }> {
        callLog.push({ table, method });

        if (method === "select") {
          if (table === "migration_imports") {
            const runId = filters.migration_run_id as string;
            const imports = storedImports.get(runId) ?? [];
            return {
              data: imports.map((imp) => ({
                id: imp.importedId,
                table_name: imp.tableName,
                source_stable_id: imp.sourceStableId,
                imported_id: imp.importedId,
              })),
              error: null,
              status: 200,
            };
          }
          if (table === "migration_runs") {
            const id = filters.id as string;
            const run = migrationRuns.get(id);
            return { data: run ?? null, error: null, status: run ? 200 : 404 };
          }
          return { data: [], error: null, status: 200 };
        }

        if (method === "delete") {
          if (table === "migration_imports") {
            const runId = filters.migration_run_id as string;
            storedImports.delete(runId);
            return { data: null, error: null, status: 204 };
          }
          if (table === "migration_runs") {
            const id = filters.id as string;
            migrationRuns.delete(id);
            return { data: null, error: null, status: 204 };
          }
          if (filterIns.id) {
            const tableRows = storedRows.get(table);
            if (tableRows) {
              for (const idToDelete of filterIns.id as number[]) {
                tableRows.delete(idToDelete as number);
              }
            }
            return { data: null, error: null, status: 204 };
          }
          return { data: null, error: null, status: 204 };
        }

        return { data: null, error: { message: "Unknown action" }, status: 400 };
      }

      self.then = (resolve: (value: unknown) => void) => {
        void execute().then(resolve);
      };

      return self;
    },
  };
}

beforeEach(() => {
  resetMockState();
});

describe("private migration rollback", () => {
  it("deletes all records imported in this migration run", async () => {
    const ownerUserId = randomUUID();
    const migrationRunId = randomUUID();
    seedMigration(migrationRunId, ownerUserId, {
      goals: 2,
      journals: 3,
      health_days: 1,
      health_segments: 2,
    });

    const client = createMockClient() as unknown as SupabaseClient;
    const stats = await rollbackMigration({
      migrationRunId,
      client,
      ownerUserId,
    });

    expect(stats.deletedImports).toBe(8);
    expect(stats.deletedRecords).toBe(8);
  });

  it("deletes child tables before parent tables (reverse dependency order)", async () => {
    const ownerUserId = randomUUID();
    const migrationRunId = randomUUID();
    seedMigration(migrationRunId, ownerUserId, {
      goals: 1,
      journals: 1,
      journal_revisions: 1,
      health_days: 1,
      health_segments: 1,
      daily_checkins: 1,
      weekly_reviews: 1,
      phase_reviews: 1,
    });

    callLog = [];
    const client = createMockClient() as unknown as SupabaseClient;
    await rollbackMigration({
      migrationRunId,
      client,
      ownerUserId,
    });

    const deleteOrder = callLog
      .filter((c) => c.method === "delete" && APPROVED_RESOURCE_TYPES.includes(c.table as MigrationResourceType))
      .map((c) => c.table as MigrationResourceType);

    expect(deleteOrder).toEqual(ROLLBACK_ORDER);
  });

  it("does not delete records from other migration runs", async () => {
    const ownerUserId = randomUUID();
    const migrationRunId = randomUUID();
    seedMigration(migrationRunId, ownerUserId, { goals: 2 });
    const otherData = seedOtherData(ownerUserId);

    const client = createMockClient() as unknown as SupabaseClient;
    await rollbackMigration({
      migrationRunId,
      client,
      ownerUserId,
    });

    const goalsTable = storedRows.get("goals")!;
    expect(goalsTable.has(otherData[0].id)).toBe(true);
  });

  it("deletes migration_imports tracking records", async () => {
    const ownerUserId = randomUUID();
    const migrationRunId = randomUUID();
    seedMigration(migrationRunId, ownerUserId, { goals: 1 });

    const client = createMockClient() as unknown as SupabaseClient;
    await rollbackMigration({
      migrationRunId,
      client,
      ownerUserId,
    });

    expect(storedImports.has(migrationRunId)).toBe(false);
  });

  it("deletes migration run record", async () => {
    const ownerUserId = randomUUID();
    const migrationRunId = randomUUID();
    seedMigration(migrationRunId, ownerUserId, { goals: 1 });

    const client = createMockClient() as unknown as SupabaseClient;
    await rollbackMigration({
      migrationRunId,
      client,
      ownerUserId,
    });

    expect(migrationRuns.has(migrationRunId)).toBe(false);
  });

  it("returns zero stats when migration run has no imports", async () => {
    const ownerUserId = randomUUID();
    const migrationRunId = randomUUID();
    migrationRuns.set(migrationRunId, { id: migrationRunId, status: "completed" });
    storedImports.set(migrationRunId, []);

    const client = createMockClient() as unknown as SupabaseClient;
    const stats = await rollbackMigration({
      migrationRunId,
      client,
      ownerUserId,
    });

    expect(stats.deletedRecords).toBe(0);
    expect(stats.deletedImports).toBe(0);
  });
});
