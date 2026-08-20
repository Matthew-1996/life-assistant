// @vitest-environment node

import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../supabase/migrations/20260819161427_life_console_250.sql",
  import.meta.url,
);

let db: PGlite;
let migrationSql: string;

async function applyCurrentSchema(database: PGlite) {
  await database.exec("create role service_role nologin");
  for (const file of [
    "./fixtures/auth-shim.sql",
    "../../supabase/migrations/0001_life_console.sql",
    "../../supabase/migrations/0002_harden_automatic_rls_helper.sql",
    "../../supabase/migrations/0003_cover_health_segment_foreign_key.sql",
    "../../supabase/migrations/0005_migration_tracking.sql",
    "../../supabase/migrations/20260815165912_life_console_230_online_primary.sql",
    "../../supabase/migrations/20260816111000_owner_backup_request.sql",
    "../../supabase/migrations/20260816113000_controlled_online_primary_cutover.sql",
    "../../supabase/migrations/20260816170000_unified_journal_normalization.sql",
    "../../supabase/migrations/20260816171759_retry_failed_journal_normalization.sql",
    "../../supabase/migrations/20260816220627_preserve_completed_journal_normalization.sql",
    "../../supabase/migrations/20260817022619_enforce_agent_normalization_priority.sql",
  ]) {
    await database.exec(await readFile(new URL(file, import.meta.url), "utf8"));
  }
}

beforeAll(async () => {
  db = new PGlite();
  await applyCurrentSchema(db);
  migrationSql = await readFile(migrationUrl, "utf8");
  await db.exec(migrationSql);
});

afterAll(async () => {
  await db?.close();
});

describe("Life Console 2.5.0 database migration", () => {
  it("creates the three owner-scoped resources with RLS", async () => {
    const tables = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in (
           'todo_items',
           'todo_status_events',
           'dashboard_messages'
         )
       order by c.relname`,
    );

    expect(tables.rows).toEqual([
      { relname: "dashboard_messages", relrowsecurity: true },
      { relname: "todo_items", relrowsecurity: true },
      { relname: "todo_status_events", relrowsecurity: true },
    ]);
  });

  it("creates exactly the six approved RPCs as protected definer functions", async () => {
    const functions = await db.query<{
      proname: string;
      prosecdef: boolean;
      search_path: string[];
    }>(
      `select p.proname, p.prosecdef, p.proconfig[1:] as search_path
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'create_todo',
           'update_todo',
           'transition_todo',
           'upsert_dashboard_message',
           'soft_delete_journal',
           'restore_journal'
         )
       order by p.proname`,
    );

    expect(functions.rows).toEqual([
      { proname: "create_todo", prosecdef: true, search_path: ['search_path=""'] },
      { proname: "restore_journal", prosecdef: true, search_path: ['search_path=""'] },
      { proname: "soft_delete_journal", prosecdef: true, search_path: ['search_path=""'] },
      { proname: "transition_todo", prosecdef: true, search_path: ['search_path=""'] },
      { proname: "update_todo", prosecdef: true, search_path: ['search_path=""'] },
      { proname: "upsert_dashboard_message", prosecdef: true, search_path: ['search_path=""'] },
    ]);
  });

  it("adds the owner and query-path indexes", async () => {
    const indexes = await db.query<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and indexname in (
           'todo_items_owner_status_due_idx',
           'todo_items_owner_schedule_idx',
           'todo_status_events_owner_todo_idx',
           'dashboard_messages_owner_week_idx'
         )
       order by indexname`,
    );

    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "dashboard_messages_owner_week_idx",
      "todo_items_owner_schedule_idx",
      "todo_items_owner_status_due_idx",
      "todo_status_events_owner_todo_idx",
    ]);
  });

  it("exposes reads but keeps direct writes and anonymous RPC calls closed", async () => {
    const privileges = await db.query<{
      canSelect: boolean;
      canInsert: boolean;
      anonCanExecute: boolean;
      ownerCanExecute: boolean;
    }>(
      `select
         has_table_privilege('authenticated', 'public.todo_items', 'select')
           as "canSelect",
         has_table_privilege('authenticated', 'public.todo_items', 'insert')
           as "canInsert",
         has_function_privilege(
           'anon',
           'public.create_todo(text,text,text,timestamptz,timestamptz)',
           'execute'
         ) as "anonCanExecute",
         has_function_privilege(
           'authenticated',
           'public.create_todo(text,text,text,timestamptz,timestamptz)',
           'execute'
         ) as "ownerCanExecute"`,
    );

    expect(privileges.rows).toEqual([{
      canSelect: true,
      canInsert: false,
      anonCanExecute: false,
      ownerCanExecute: true,
    }]);
  });

  it("can be applied repeatedly without duplicating resources", async () => {
    await expect(db.exec(migrationSql)).resolves.toBeDefined();
    const count = await db.query<{ count: number }>(
      `select count(*)::int as count
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in (
           'todo_items',
           'todo_status_events',
           'dashboard_messages'
         )`,
    );
    expect(count.rows).toEqual([{ count: 3 }]);
  });
});
