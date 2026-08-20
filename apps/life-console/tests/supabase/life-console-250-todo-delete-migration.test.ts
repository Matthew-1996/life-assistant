// @vitest-environment node

import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";
const deleteMigrationUrl = new URL(
  "../../supabase/migrations/20260820180000_todo_soft_delete.sql",
  import.meta.url,
);

let db: PGlite;
let deleteMigrationSql = "";

async function queryAs<T extends Record<string, unknown>>(
  userId: string,
  sql: string,
  params: unknown[] = [],
) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role service_role nologin");
  for (const file of [
    "./fixtures/auth-shim.sql",
    "../../supabase/migrations/0001_life_console.sql",
    "../../supabase/migrations/0002_harden_automatic_rls_helper.sql",
    "../../supabase/migrations/0003_cover_health_segment_foreign_key.sql",
    "../../supabase/migrations/0005_migration_tracking.sql",
    "../../supabase/migrations/20260815165912_life_console_230_online_primary.sql",
    "../../supabase/migrations/20260819161427_life_console_250.sql",
  ]) {
    await db.exec(await readFile(new URL(file, import.meta.url), "utf8"));
  }
  deleteMigrationSql = await readFile(deleteMigrationUrl, "utf8").catch(() => "");
  if (deleteMigrationSql) await db.exec(deleteMigrationSql);
  await db.query("insert into auth.users (id) values ($1), ($2)", [ownerA, ownerB]);
});

afterAll(async () => {
  await db?.close();
});

describe("Life Console 2.5.0 Todo soft-delete migration", () => {
  it("adds a protected soft-delete RPC and can be applied repeatedly", async () => {
    const shape = await db.query<{
      column_count: number;
      function_count: number;
      owner_can_execute: boolean;
      anon_can_execute: boolean;
    }>(
      `select
         (select count(*)::int from information_schema.columns
          where table_schema = 'public' and table_name = 'todo_items'
            and column_name = 'deleted_at') as column_count,
         (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'soft_delete_todo'
            and p.prosecdef and p.proconfig[1] = 'search_path=""') as function_count,
         has_function_privilege('authenticated', 'public.soft_delete_todo(bigint,bigint)', 'execute')
           as owner_can_execute,
         has_function_privilege('anon', 'public.soft_delete_todo(bigint,bigint)', 'execute')
           as anon_can_execute`,
    );

    expect(shape.rows).toEqual([{
      column_count: 1,
      function_count: 1,
      owner_can_execute: true,
      anon_can_execute: false,
    }]);
    await expect(db.exec(deleteMigrationSql)).resolves.toBeDefined();
  });

  it("soft-deletes only the owner's current revision and hides the row from normal reads", async () => {
    const created = await queryAs<{ id: number; revision: number }>(
      ownerA,
      "select id, revision from public.create_todo($1, $2, $3, $4, $5)",
      [
        "synthetic-delete-todo-0001",
        "Mistaken Todo",
        "P2",
        "2030-05-01T01:00:00Z",
        "2030-05-02T01:00:00Z",
      ],
    );
    const target = created.rows[0];

    await expect(queryAs(
      ownerB,
      "select * from public.soft_delete_todo($1, $2)",
      [target.id, target.revision],
    )).rejects.toThrow(/not found/i);
    await expect(queryAs(
      ownerA,
      "select * from public.soft_delete_todo($1, $2)",
      [target.id, target.revision + 1],
    )).rejects.toThrow(/revision/i);

    const deleted = await queryAs<{ revision: number; deleted_at: string }>(
      ownerA,
      "select revision, deleted_at from public.soft_delete_todo($1, $2)",
      [target.id, target.revision],
    );
    expect(deleted.rows[0].revision).toBe(target.revision + 1);
    expect(deleted.rows[0].deleted_at).toBeTruthy();

    const visible = await queryAs<{ count: number }>(
      ownerA,
      "select count(*)::int as count from public.todo_items where id = $1 and deleted_at is null",
      [target.id],
    );
    expect(visible.rows).toEqual([{ count: 0 }]);
  });
});
