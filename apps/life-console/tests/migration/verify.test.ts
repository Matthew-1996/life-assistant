// @vitest-environment node

import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

interface Mismatch {
  resourceType: MigrationResourceType;
  issue: string;
  expected?: unknown;
  actual?: unknown;
}

interface VerificationResult {
  match: boolean;
  mismatches: Mismatch[];
  errors: string[];
}

const verifyModule = "../../scripts/private-migration/verify";
const { verifyMigration } = await import(verifyModule) as {
  verifyMigration: (options: {
    manifest: SourceManifest;
    migrationRunId: string;
    client: SupabaseClient;
    ownerUserId: string;
  }) => Promise<VerificationResult>;
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

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "life-console-verify-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeSyntheticFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function syntheticRecord(
  resourceType: MigrationResourceType,
  index: number,
): Record<string, unknown> {
  const base = { id: `synthetic-${resourceType}-${index}` };
  switch (resourceType) {
    case "goals":
      return { ...base, title: `Goal ${index}`, status: "active", revision: 1 };
    case "journals":
      return {
        ...base,
        event_date: `2024-01-${String(index + 1).padStart(2, "0")}`,
        title: `Journal ${index}`,
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

interface MockRow {
  [key: string]: unknown;
  id: number;
}

let storedRows = new Map<string, Map<number, MockRow>>();
let storedImports = new Map<
  string,
  Array<{
    tableName: MigrationResourceType;
    sourceStableId: string;
    importedId: number;
  }>
>();
let migrationRuns = new Map<string, { id: string; status: string }>();
let nextId = 1;

function resetMockState(): void {
  storedRows = new Map();
  storedImports = new Map();
  migrationRuns = new Map();
  nextId = 1;
}

function seedMigration(
  migrationRunId: string,
  ownerUserId: string,
  records: Partial<Record<MigrationResourceType, Array<Record<string, unknown>>>>,
): void {
  migrationRuns.set(migrationRunId, { id: migrationRunId, status: "completed" });
  storedImports.set(migrationRunId, []);
  for (const [resourceType, rowList] of Object.entries(records)) {
    if (!storedRows.has(resourceType)) {
      storedRows.set(resourceType, new Map());
    }
    const tableRows = storedRows.get(resourceType)!;
    for (const record of rowList) {
      const id = nextId++;
      const { id: _sourceId, ...rest } = record;
      const row = { id, user_id: ownerUserId, ...rest };
      tableRows.set(id, row);
      storedImports.get(migrationRunId)!.push({
        tableName: resourceType as MigrationResourceType,
        sourceStableId: String(_sourceId),
        importedId: id,
      });
    }
  }
}

function createMockClient() {
  const builder = (table: string) => {
    const filters: Record<string, unknown> = {};
    const filterIn: Record<string, unknown[]> = {};
    let useSingle = false;
    const self: Record<string, unknown> = {};

    self.select = () => self;
    self.eq = (column: string, value: unknown) => {
      filters[column] = value;
      return self;
    };
    self.in = (column: string, values: unknown[]) => {
      filterIn[column] = values;
      return self;
    };
    self.single = () => {
      useSingle = true;
      return self;
    };

    async function execute(): Promise<{
      data: unknown;
      error: null | { message: string };
      status: number;
    }> {
      if (table === "migration_runs") {
        const id = filters.id as string | undefined;
        if (id && migrationRuns.has(id)) {
          const run = migrationRuns.get(id)!;
          return { data: useSingle ? run : [run], error: null, status: 200 };
        }
        if (id) {
          return { data: null, error: { message: "Not found" }, status: 404 };
        }
        return { data: [...migrationRuns.values()], error: null, status: 200 };
      }

      if (table === "migration_imports") {
        const runId = filters.migration_run_id as string | undefined;
        const imps = runId ? (storedImports.get(runId) ?? []) : [];
        let filtered = imps.map((imp) => ({
          table_name: imp.tableName,
          source_stable_id: imp.sourceStableId,
          imported_id: imp.importedId,
        }));
        if (filterIn.table_name) {
          filtered = filtered.filter((r) =>
            filterIn.table_name!.includes(r.table_name),
          );
        }
        return { data: filtered, error: null, status: 200 };
      }

      const tableRows = storedRows.get(table);
      if (!tableRows) {
        return { data: [], error: null, status: 200 };
      }
      let rows = [...tableRows.values()];
      for (const [key, value] of Object.entries(filters)) {
        rows = rows.filter((r) => r[key] === value);
      }
      for (const [key, values] of Object.entries(filterIn)) {
        rows = rows.filter((r) => values.includes(r[key]));
      }
      if (useSingle && rows.length > 0) {
        return { data: rows[0], error: null, status: 200 };
      }
      return { data: rows, error: null, status: 200 };
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

function manifestFor(
  approvedRoot: string,
  records: Partial<Record<MigrationResourceType, Array<Record<string, unknown>>>>,
): SourceManifest {
  const resources: SourceManifest["resources"] = [];
  for (const resourceType of APPROVED_RESOURCE_TYPES) {
    const rows = records[resourceType] ?? [];
    const content = rows.map((r) => JSON.stringify(r)).join("\n")
      + (rows.length > 0 ? "\n" : "");
    const sourcePath = join(approvedRoot, `${resourceType}.ndjson`);
    writeSyntheticFile(sourcePath, content);
    resources.push({
      resourceType,
      sourcePath,
      sourceDigest: "0".repeat(64),
      expectedCount: rows.length,
      approvedFields: rows.length > 0 ? Object.keys(rows[0]) : ["id"],
    });
  }
  return { approvedRoot, resources };
}

describe("private migration verification", () => {
  it("passes verification when all counts match and records exist", async () => {
    const approvedRoot = temporaryDirectory();
    const ownerUserId = randomUUID();
    const migrationRunId = randomUUID();
    const records: Partial<
      Record<MigrationResourceType, Array<Record<string, unknown>>>
    > = {};
    for (const rt of APPROVED_RESOURCE_TYPES) {
      records[rt] = [syntheticRecord(rt, 0)];
    }
    seedMigration(migrationRunId, ownerUserId, records);
    const manifest = manifestFor(approvedRoot, records);
    const client = createMockClient() as unknown as SupabaseClient;

    const result = await verifyMigration({
      manifest,
      migrationRunId,
      client,
      ownerUserId,
    });

    expect(result.errors).toEqual([]);
    expect(result.match).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("reports count mismatch when expected count does not match imported count", async () => {
    const approvedRoot = temporaryDirectory();
    const ownerUserId = randomUUID();
    const migrationRunId = randomUUID();
    const records: Partial<
      Record<MigrationResourceType, Array<Record<string, unknown>>>
    > = {
      goals: [syntheticRecord("goals", 0)],
      journals: [syntheticRecord("journals", 0)],
    };
    for (const rt of APPROVED_RESOURCE_TYPES) {
      if (!records[rt]) records[rt] = [];
    }
    seedMigration(migrationRunId, ownerUserId, records);
    records.goals = [syntheticRecord("goals", 0), syntheticRecord("goals", 1)];
    const manifest = manifestFor(approvedRoot, records);
    const client = createMockClient() as unknown as SupabaseClient;

    const result = await verifyMigration({
      manifest,
      migrationRunId,
      client,
      ownerUserId,
    });

    expect(result.match).toBe(false);
    expect(result.mismatches.some((m) => m.issue.includes("count"))).toBe(true);
  });

  it("reports error when migration run does not exist", async () => {
    const approvedRoot = temporaryDirectory();
    const ownerUserId = randomUUID();
    const migrationRunId = randomUUID();
    const records: Partial<
      Record<MigrationResourceType, Array<Record<string, unknown>>>
    > = {};
    for (const rt of APPROVED_RESOURCE_TYPES) {
      records[rt] = [];
    }
    const manifest = manifestFor(approvedRoot, records);
    const client = createMockClient() as unknown as SupabaseClient;

    const result = await verifyMigration({
      manifest,
      migrationRunId,
      client,
      ownerUserId,
    });

    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("verifies records belong to the specified owner user", async () => {
    const approvedRoot = temporaryDirectory();
    const ownerUserId = randomUUID();
    const otherUserId = randomUUID();
    const migrationRunId = randomUUID();
    const records: Partial<
      Record<MigrationResourceType, Array<Record<string, unknown>>>
    > = {};
    for (const rt of APPROVED_RESOURCE_TYPES) {
      records[rt] = [syntheticRecord(rt, 0)];
    }
    seedMigration(migrationRunId, otherUserId, records);
    const manifest = manifestFor(approvedRoot, records);
    const client = createMockClient() as unknown as SupabaseClient;

    const result = await verifyMigration({
      manifest,
      migrationRunId,
      client,
      ownerUserId,
    });

    expect(result.match).toBe(false);
  });
});
