// @vitest-environment node

import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  const files = [
    "./fixtures/auth-shim.sql",
    "../../supabase/migrations/0001_life_console.sql",
    "../../supabase/migrations/0002_harden_automatic_rls_helper.sql",
    "../../supabase/migrations/0003_cover_health_segment_foreign_key.sql",
    "../../supabase/migrations/0005_migration_tracking.sql",
    "../../supabase/migrations/20260815165912_life_console_230_online_primary.sql",
  ];
  for (const file of files) {
    if (file.endsWith("0005_migration_tracking.sql")) {
      await db.exec("create role service_role nologin");
    }
    await db.exec(await readFile(new URL(file, import.meta.url), "utf8"));
  }
});

afterAll(async () => {
  await db?.close();
});

describe("Life Console 2.3.0 online-primary migration", () => {
  it("preserves full-fidelity journal, review, and sleep fields", async () => {
    const columns = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
       from information_schema.columns
       where table_schema = 'public'
         and (table_name, column_name) in (
           ('journals', 'record_key'),
           ('journals', 'metadata'),
           ('goals', 'record_key'),
           ('weekly_reviews', 'record_key'),
           ('weekly_reviews', 'structured_data'),
           ('phase_reviews', 'record_key'),
           ('phase_reviews', 'structured_data'),
           ('daily_checkins', 'sleep_time'),
           ('daily_checkins', 'wake_time'),
           ('daily_checkins', 'out_of_bed_time'),
           ('daily_checkins', 'awake_in_bed')
         )
       order by table_name, column_name`,
    );

    expect(columns.rows).toEqual([
      { table_name: "daily_checkins", column_name: "awake_in_bed" },
      { table_name: "daily_checkins", column_name: "out_of_bed_time" },
      { table_name: "daily_checkins", column_name: "sleep_time" },
      { table_name: "daily_checkins", column_name: "wake_time" },
      { table_name: "goals", column_name: "record_key" },
      { table_name: "journals", column_name: "metadata" },
      { table_name: "journals", column_name: "record_key" },
      { table_name: "phase_reviews", column_name: "record_key" },
      { table_name: "phase_reviews", column_name: "structured_data" },
      { table_name: "weekly_reviews", column_name: "record_key" },
      { table_name: "weekly_reviews", column_name: "structured_data" },
    ]);
  });

  it("enforces stable record keys and globally unique migration sources", async () => {
    const indexes = await db.query<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and indexname in (
           'goals_user_record_key_uidx',
           'journals_user_record_key_uidx',
           'weekly_reviews_user_record_key_uidx',
           'phase_reviews_user_record_key_uidx',
           'migration_imports_source_uidx'
         )
       order by indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "goals_user_record_key_uidx",
      "journals_user_record_key_uidx",
      "migration_imports_source_uidx",
      "phase_reviews_user_record_key_uidx",
      "weekly_reviews_user_record_key_uidx",
    ]);
  });

  it("exports the version 2 snapshot through invoker rights", async () => {
    const functions = await db.query<{ prosecdef: boolean; search_path: string[] }>(
      `select p.prosecdef, p.proconfig[1:] as search_path
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'export_life_console_snapshot'`,
    );
    expect(functions.rows).toEqual([
      { prosecdef: false, search_path: ['search_path=""'] },
    ]);

    const snapshot = await db.query<{ schema_version: number }>(
      `select (public.export_life_console_snapshot() ->> 'schema_version')::int
        as schema_version`,
    );
    expect(snapshot.rows).toEqual([{ schema_version: 2 }]);
  });
});
