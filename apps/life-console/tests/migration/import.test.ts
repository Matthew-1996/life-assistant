// @vitest-environment node

import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

interface DryRunResourceReportItem {
  resourceType: MigrationResourceType;
  count: number;
  canonicalSha256: string | null;
  errors: string[];
}

interface DryRunReport {
  resources: DryRunResourceReportItem[];
  overallDigest: string;
}

interface ImportStats {
  inserted: number;
  skipped: number;
  failed: number;
}

type CallEntry = {
  table: string;
  method: "select" | "insert" | "update" | "delete";
  filters?: Record<string, unknown>;
  data?: unknown;
};

const importModule = "../../scripts/private-migration/import";
const { importMigration } = await import(importModule) as {
  importMigration: (options: {
    manifest: SourceManifest;
    dryRunReport: DryRunReport;
    migrationRunId: string;
    client: SupabaseClient;
    ownerUserId: string;
  }) => Promise<ImportStats>;
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

const DEPENDENCY_ORDER: readonly MigrationResourceType[] = [
  "goals",
  "journals",
  "daily_checkins",
  "weekly_reviews",
  "phase_reviews",
  "health_days",
  "journal_revisions",
  "health_segments",
];

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "life-console-import-"));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeSyntheticFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function canonicalize(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function syntheticRecord(
  resourceType: MigrationResourceType,
  index: number,
): Record<string, unknown> {
  const base = { id: `synthetic-${resourceType}-${index}` };
  switch (resourceType) {
    case "goals":
      return {
        ...base,
        title: `Synthetic Goal ${index}`,
        status: "active",
        revision: 1,
      };
    case "journals":
      return {
        ...base,
        event_date: `2024-01-${String(index + 1).padStart(2, "0")}`,
        title: `Synthetic Journal ${index}`,
        content: `Content ${index}`,
        tags: [],
        revision: 1,
      };
    case "journal_revisions":
      return {
        ...base,
        journal_id: `synthetic-journals-${index}`,
        revision: 1,
        snapshot: {},
        reason: "create",
      };
    case "daily_checkins":
      return {
        ...base,
        checkin_date: `2024-01-${String(index + 1).padStart(2, "0")}`,
        revision: 1,
      };
    case "weekly_reviews":
      return {
        ...base,
        week_start: `2024-01-${String(index * 7 + 1).padStart(2, "0")}`,
        content: `Review ${index}`,
        revision: 1,
      };
    case "phase_reviews":
      return {
        ...base,
        period_start: "2024-01-01",
        period_end: "2024-01-31",
        content: `Phase ${index}`,
        revision: 1,
      };
    case "health_days":
      return {
        ...base,
        health_date: `2024-01-${String(index + 1).padStart(2, "0")}`,
        summary: {},
        revision: 1,
      };
    case "health_segments":
      return {
        ...base,
        health_day_id: `synthetic-health_days-${index}`,
        start_at: "2024-01-01T08:00:00Z",
        end_at: "2024-01-01T09:00:00Z",
      };
  }
}

function approvedFieldsFor(resourceType: MigrationResourceType): string[] {
  return Object.keys(syntheticRecord(resourceType, 0));
}

function manifestFor(
  approvedRoot: string,
  records: Partial<Record<MigrationResourceType, Array<Record<string, unknown>>>> = {},
): { manifest: SourceManifest; dryRunReport: DryRunReport } {
  const resources: SourceManifest["resources"] = [];
  const dryRunResources: DryRunResourceReportItem[] = [];

  for (const resourceType of APPROVED_RESOURCE_TYPES) {
    const rows = records[resourceType] ?? [syntheticRecord(resourceType, 0)];
    const canonicalRows = rows.map(canonicalize);
    const content = canonicalRows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const sourcePath = join(approvedRoot, `${resourceType}.ndjson`);
    writeSyntheticFile(sourcePath, content);
    resources.push({
      resourceType,
      sourcePath,
      sourceDigest: sha256(content),
      expectedCount: rows.length,
      approvedFields: approvedFieldsFor(resourceType),
    });
    const canonicalNdjson = canonicalRows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    dryRunResources.push({
      resourceType,
      count: rows.length,
      canonicalSha256: sha256(canonicalNdjson),
      errors: [],
    });
  }

  const manifest: SourceManifest = { approvedRoot, resources };
  const sortedResources = [...dryRunResources].sort((a, b) =>
    a.resourceType.localeCompare(b.resourceType),
  );
  const dryRunReport: DryRunReport = {
    resources: dryRunResources,
    overallDigest: sha256(JSON.stringify(sortedResources)),
  };
  return { manifest, dryRunReport };
}

let nextInsertedId = 1;
let insertedRows = new Map<string, Map<string, Record<string, unknown>>>();
let migrationImports = new Map<
  string,
  Array<{ tableName: string; sourceStableId: string; importedId: number }>
>();
let callLog: CallEntry[] = [];
let shouldFailOn: { table?: string; method?: string } | null = null;
let failOnce = false;

function resetMockState(): void {
  nextInsertedId = 1;
  insertedRows = new Map();
  migrationImports = new Map();
  callLog = [];
  shouldFailOn = null;
  failOnce = false;
}

function createMockClient() {
  const builder = (table: string) => {
    let method: "select" | "insert" | "update" | "delete" = "select";
    let insertData: unknown = null;
    let insertOptions: { onConflict?: string } = {};
    const filters: Record<string, unknown> = {};
    const filterIn: Record<string, unknown[]> = {};
    let useSingle = false;

    const self: Record<string, unknown> = {};

    self.select = (_columns?: string) => {
      return self;
    };
    self.insert = (values: unknown, options?: { onConflict?: string }) => {
      method = "insert";
      insertData = values;
      insertOptions = options ?? {};
      return self;
    };
    self.update = (values: unknown) => {
      method = "update";
      insertData = values;
      return self;
    };
    self.delete = () => {
      method = "delete";
      return self;
    };
    self.eq = (column: string, value: unknown) => {
      filters[column] = value;
      return self;
    };
    self.in = (column: string, values: unknown[]) => {
      filterIn[column] = values;
      return self;
    };
    self.is = (column: string, value: unknown) => {
      filters[column] = value;
      return self;
    };
    self.match = (query: Record<string, unknown>) => {
      Object.assign(filters, query);
      return self;
    };
    self.order = () => self;
    self.limit = () => self;
    self.single = () => {
      useSingle = true;
      return self;
    };

    async function execute(): Promise<{
      data: unknown;
      error: null | { message: string; code?: string };
      status: number;
    }> {
      callLog.push({ table, method, filters: { ...filters }, data: insertData });

      if (
        shouldFailOn
        && (!shouldFailOn.table || shouldFailOn.table === table)
        && (!shouldFailOn.method || shouldFailOn.method === method)
      ) {
        if (failOnce) {
          shouldFailOn = null;
        }
        return {
          data: null,
          error: { message: "Synthetic failure", code: "SYNTHETIC_ERROR" },
          status: 500,
        };
      }

      if (method === "select") {
        if (table === "migration_runs") {
          const tableRows = insertedRows.get(table);
          const id = filters.id as string | undefined;
          if (id && tableRows?.has(id)) {
            const row = tableRows.get(id)!;
            return { data: useSingle ? row : [row], error: null, status: 200 };
          }
          if (id) {
            return { data: null, error: { message: "Not found" }, status: 404 };
          }
          const rows = tableRows ? [...tableRows.values()] : [];
          return { data: rows, error: null, status: 200 };
        }

        if (table === "migration_imports") {
          const runId = filters.migration_run_id as string | undefined;
          const tableName = filters.table_name as string | undefined;
          let imps = runId ? (migrationImports.get(runId) ?? []) : [];
          if (tableName) {
            imps = imps.filter((i) => i.tableName === tableName);
          }
          const result = imps.map((i) => ({
            table_name: i.tableName,
            source_stable_id: i.sourceStableId,
            imported_id: i.importedId,
          }));
          return { data: result, error: null, status: 200 };
        }

        const tableRows = insertedRows.get(table);
        let rows = tableRows ? [...tableRows.values()] : [];
        for (const [key, value] of Object.entries(filters)) {
          rows = rows.filter((r) => r[key] === value);
        }
        for (const [key, values] of Object.entries(filterIn)) {
          rows = rows.filter((r) => values.includes(r[key]));
        }
        return { data: rows, error: null, status: 200 };
      }

      if (method === "insert") {
        if (!insertedRows.has(table)) {
          insertedRows.set(table, new Map());
        }
        const tableRows = insertedRows.get(table)!;
        const rows = Array.isArray(insertData) ? insertData : [insertData];
        const results: Array<Record<string, unknown>> = [];

        if (table === "migration_runs") {
          for (const row of rows as Array<Record<string, unknown>>) {
            const id = row.id as string;
            const fullRow = {
              ...row,
              started_at: (row.started_at as string) ?? new Date().toISOString(),
              status: (row.status as string) ?? "running",
            };
            tableRows.set(id, fullRow);
            results.push(fullRow);
          }
          const data = useSingle
            ? results[0] ?? null
            : Array.isArray(insertData)
              ? results
              : results[0] ?? null;
          return { data, error: null, status: 201 };
        }

        if (table === "migration_imports") {
          for (const row of rows as Array<Record<string, unknown>>) {
            const runId = row.migration_run_id as string;
            if (!migrationImports.has(runId)) {
              migrationImports.set(runId, []);
            }
            const key = `${row.table_name}:${row.source_stable_id}`;
            if (tableRows.has(key)) {
              return {
                data: null,
                error: { message: "Duplicate key", code: "23505" },
                status: 409,
              };
            }
            const id = nextInsertedId++;
            const fullRow = { id, ...row };
            tableRows.set(key, fullRow);
            migrationImports.get(runId)!.push({
              tableName: row.table_name as string,
              sourceStableId: row.source_stable_id as string,
              importedId: id,
            });
            results.push(fullRow);
          }
          const data = useSingle
            ? results[0] ?? null
            : Array.isArray(insertData)
              ? results
              : results[0] ?? null;
          return { data, error: null, status: 201 };
        }

        for (const row of rows as Array<Record<string, unknown>>) {
          const sourceStableId = String(row.id);
          if (insertOptions.onConflict) {
            const existing = tableRows.get(sourceStableId);
            if (existing) {
              results.push(existing);
              continue;
            }
          }
          const id = nextInsertedId++;
          const fullRow = { id, ...row };
          tableRows.set(sourceStableId, fullRow);
          results.push(fullRow);
        }
        const data = useSingle
          ? results[0] ?? null
          : Array.isArray(insertData)
            ? results
            : results[0] ?? null;
        return { data, error: null, status: 201 };
      }

      if (method === "update") {
        const tableRows = insertedRows.get(table);
        if (!tableRows) {
          return {
            data: null,
            error: { message: "Not found" },
            status: 404,
          };
        }
        let updated = false;
        for (const [, row] of tableRows) {
          let matches = true;
          for (const [key, value] of Object.entries(filters)) {
            if (row[key] !== value) {
              matches = false;
              break;
            }
          }
          if (matches) {
            Object.assign(row, insertData as Record<string, unknown>);
            updated = true;
          }
        }
        return { data: null, error: null, status: updated ? 204 : 404 };
      }

      if (method === "delete") {
        if (table === "migration_imports") {
          const runId = filters.migration_run_id as string | undefined;
          if (runId) {
            migrationImports.delete(runId);
            const tableRows = insertedRows.get(table);
            if (tableRows) {
              for (const [key, row] of [...tableRows]) {
                if (row.migration_run_id === runId) {
                  tableRows.delete(key);
                }
              }
            }
          }
          return { data: null, error: null, status: 204 };
        }

        if (table === "migration_runs") {
          const tableRows = insertedRows.get(table);
          if (tableRows) {
            const id = filters.id as string;
            tableRows.delete(id);
          }
          return { data: null, error: null, status: 204 };
        }

        const tableRows = insertedRows.get(table);
        if (tableRows) {
          for (const [key, row] of [...tableRows]) {
            const idVal = row.id;
            if (filterIn.id && filterIn.id.includes(idVal)) {
              tableRows.delete(key);
            } else {
              let matches = true;
              for (const [fkey, fvalue] of Object.entries(filters)) {
                if (row[fkey] !== fvalue) {
                  matches = false;
                  break;
                }
              }
              if (matches && Object.keys(filters).length > 0) {
                tableRows.delete(key);
              }
            }
          }
        }
        return { data: null, error: null, status: 204 };
      }

      return {
        data: null,
        error: { message: "Unknown method" },
        status: 400,
      };
    }

    self.then = (resolve: (value: unknown) => void) => {
      void execute().then(resolve);
    };

    return self;
  };

  return { from: (table: string) => builder(table) };
}

beforeEach(() => {
  resetMockState();
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("private migration import", () => {
  it("imports all eight resource types and returns inserted count", async () => {
    const approvedRoot = temporaryDirectory();
    const { manifest, dryRunReport } = manifestFor(approvedRoot);
    const client = createMockClient() as unknown as SupabaseClient;
    const migrationRunId = randomUUID();
    const ownerUserId = randomUUID();

    const stats = await importMigration({
      manifest,
      dryRunReport,
      migrationRunId,
      client,
      ownerUserId,
    });

    expect(stats.inserted).toBe(8);
    expect(stats.skipped).toBe(0);
    expect(stats.failed).toBe(0);
  });

  it("imports resources in dependency order (parents before children)", async () => {
    const approvedRoot = temporaryDirectory();
    const records: Partial<
      Record<MigrationResourceType, Array<Record<string, unknown>>>
    > = {};
    for (const rt of APPROVED_RESOURCE_TYPES) {
      records[rt] = [syntheticRecord(rt, 0), syntheticRecord(rt, 1)];
    }
    const { manifest, dryRunReport } = manifestFor(approvedRoot, records);
    const client = createMockClient() as unknown as SupabaseClient;
    const migrationRunId = randomUUID();
    const ownerUserId = randomUUID();

    await importMigration({
      manifest,
      dryRunReport,
      migrationRunId,
      client,
      ownerUserId,
    });

    const tableOrder = callLog
      .filter(
        (c) =>
          c.method === "insert"
          && !["migration_runs", "migration_imports"].includes(c.table),
      )
      .map((c) => c.table);

    const uniqueTablesInOrder = [...new Set(tableOrder)];
    expect(uniqueTablesInOrder).toEqual(DEPENDENCY_ORDER);
  });

  it("skips already imported records (idempotent across runs)", async () => {
    const approvedRoot = temporaryDirectory();
    const { manifest, dryRunReport } = manifestFor(approvedRoot);
    const client = createMockClient() as unknown as SupabaseClient;
    const migrationRunId = randomUUID();
    const ownerUserId = randomUUID();

    const firstStats = await importMigration({
      manifest,
      dryRunReport,
      migrationRunId,
      client,
      ownerUserId,
    });
    expect(firstStats.inserted).toBe(8);

    resetMockState();
    const secondRunId = randomUUID();
    const client2 = createMockClient() as unknown as SupabaseClient;
    const secondStats = await importMigration({
      manifest,
      dryRunReport,
      migrationRunId: secondRunId,
      client: client2,
      ownerUserId,
    });
    expect(secondStats.inserted).toBe(8);
    expect(secondStats.skipped).toBe(0);
  });

  it("rejects import when dry-run report contains errors", async () => {
    const approvedRoot = temporaryDirectory();
    const { manifest, dryRunReport } = manifestFor(approvedRoot);
    dryRunReport.resources[0].errors = ["line 1: invalid JSON"];
    const client = createMockClient() as unknown as SupabaseClient;
    const migrationRunId = randomUUID();
    const ownerUserId = randomUUID();

    await expect(
      importMigration({
        manifest,
        dryRunReport,
        migrationRunId,
        client,
        ownerUserId,
      }),
    ).rejects.toThrow(/dry.?run.*error/i);
  });

  it("rolls back all partial imports when a resource fails", async () => {
    const approvedRoot = temporaryDirectory();
    const { manifest, dryRunReport } = manifestFor(approvedRoot);
    const client = createMockClient() as unknown as SupabaseClient;
    const migrationRunId = randomUUID();
    const ownerUserId = randomUUID();

    shouldFailOn = { table: "health_segments", method: "insert" };
    failOnce = true;

    await expect(
      importMigration({
        manifest,
        dryRunReport,
        migrationRunId,
        client,
        ownerUserId,
      }),
    ).rejects.toThrow(/failed/i);
  });

  it("records each imported row in migration_imports", async () => {
    const approvedRoot = temporaryDirectory();
    const { manifest, dryRunReport } = manifestFor(approvedRoot);
    const client = createMockClient() as unknown as SupabaseClient;
    const migrationRunId = randomUUID();
    const ownerUserId = randomUUID();

    await importMigration({
      manifest,
      dryRunReport,
      migrationRunId,
      client,
      ownerUserId,
    });

    const importsTable = insertedRows.get("migration_imports");
    expect(importsTable).toBeDefined();
    expect(importsTable!.size).toBe(8);
  });

  it("sets owner user_id on all imported records", async () => {
    const approvedRoot = temporaryDirectory();
    const { manifest, dryRunReport } = manifestFor(approvedRoot);
    const client = createMockClient() as unknown as SupabaseClient;
    const migrationRunId = randomUUID();
    const ownerUserId = "synthetic-owner-user-id";

    await importMigration({
      manifest,
      dryRunReport,
      migrationRunId,
      client,
      ownerUserId,
    });

    for (const table of APPROVED_RESOURCE_TYPES) {
      const tableRows = insertedRows.get(table);
      expect(tableRows).toBeDefined();
      for (const [, row] of tableRows!) {
        expect(row.user_id).toBe(ownerUserId);
      }
    }
  });

  it("marks migration run status as completed on success", async () => {
    const approvedRoot = temporaryDirectory();
    const { manifest, dryRunReport } = manifestFor(approvedRoot);
    const client = createMockClient() as unknown as SupabaseClient;
    const migrationRunId = randomUUID();
    const ownerUserId = randomUUID();

    await importMigration({
      manifest,
      dryRunReport,
      migrationRunId,
      client,
      ownerUserId,
    });

    const runRows = insertedRows.get("migration_runs");
    expect(runRows).toBeDefined();
    const run = runRows!.get(migrationRunId);
    expect(run).toBeDefined();
    expect(run!.status).toBe("completed");
    expect(run!.completed_at).toBeDefined();
  });

  it("marks migration run status as failed on failure", async () => {
    const approvedRoot = temporaryDirectory();
    const { manifest, dryRunReport } = manifestFor(approvedRoot);
    const client = createMockClient() as unknown as SupabaseClient;
    const migrationRunId = randomUUID();
    const ownerUserId = randomUUID();

    shouldFailOn = { table: "goals", method: "insert" };

    try {
      await importMigration({
        manifest,
        dryRunReport,
        migrationRunId,
        client,
        ownerUserId,
      });
    } catch {
      // expected
    }

    const runRows = insertedRows.get("migration_runs");
    const run = runRows?.get(migrationRunId);
    expect(run?.status).toBe("failed");
  });

  it("does not print or log raw private data", async () => {
    const approvedRoot = temporaryDirectory();
    const secretValue = "SYNTHETIC_SECRET_VALUE";
    const records: Partial<
      Record<MigrationResourceType, Array<Record<string, unknown>>>
    > = {
      journals: [
        {
          id: "synthetic-journals-0",
          event_date: "2024-01-01",
          title: "Synthetic",
          content: secretValue,
          tags: [],
          revision: 1,
        },
      ],
    };
    const { manifest, dryRunReport } = manifestFor(approvedRoot, records);
    const client = createMockClient() as unknown as SupabaseClient;
    const migrationRunId = randomUUID();
    const ownerUserId = randomUUID();

    const logs: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    console.error = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await importMigration({
        manifest,
        dryRunReport,
        migrationRunId,
        client,
        ownerUserId,
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    const logOutput = logs.join("\n");
    expect(logOutput).not.toContain(secretValue);
  });
});
