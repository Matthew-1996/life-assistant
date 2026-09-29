// @vitest-environment node

import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";

const healthDayMigrationUrl = new URL(
  "../../supabase/migrations/20260826073157_health_day_daily_sync.sql",
  import.meta.url,
);

const summary = {
  steps: 4321,
  active_energy: 210.5,
  exercise_minutes: 18,
  sleep_start: null,
  sleep_end: null,
};

let db: PGlite;

async function queryAs<T extends Record<string, unknown>>(
  role: "anon" | "authenticated",
  userId: string | null,
  sql: string,
  params: unknown[] = [],
) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    userId ?? "",
  ]);
  await db.exec(`set role ${role}`);
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

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
    "../../supabase/migrations/20260819161427_life_console_250.sql",
  ]) {
    await database.exec(await readFile(new URL(file, import.meta.url), "utf8"));
  }
  await database.exec(await readFile(healthDayMigrationUrl, "utf8"));
}

async function today() {
  const result = await db.query<{ health_date: string; generated_at: string }>(`
    select
      (clock_timestamp() at time zone 'Asia/Shanghai')::date::text as health_date,
      ((clock_timestamp() at time zone 'Asia/Shanghai')::date + time '13:30')
        at time zone 'Asia/Shanghai' as generated_at
  `);
  return result.rows[0];
}

async function fractionalToday() {
  const result = await db.query<{
    health_date: string;
    generated_at: string;
    source_revision: string;
  }>(`
    select
      (clock_timestamp() at time zone 'Asia/Shanghai')::date::text as health_date,
      ((clock_timestamp() at time zone 'Asia/Shanghai')::date + time '13:30:00.500')
        at time zone 'Asia/Shanghai' as generated_at,
      pg_catalog.to_char(
        ((clock_timestamp() at time zone 'Asia/Shanghai')::date + time '13:30:00.500')
          at time zone 'Asia/Shanghai' at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) as source_revision
  `);
  return result.rows[0];
}

function returnedDate(healthDate: string) {
  return new Date(`${healthDate}T00:00:00.000Z`);
}

async function upsertAs(
  role: "anon" | "authenticated",
  userId: string | null,
  healthDate: string,
  generatedAt: string,
  value: unknown = summary,
) {
  return queryAs<{
    action: string;
    id: number;
    health_date: string;
    revision: number;
  }>(
    role,
    userId,
    "select * from public.upsert_health_day_v1($1::date, $2::timestamptz, $3::jsonb)",
    [healthDate, generatedAt, value],
  );
}

async function expectSqlError(
  operation: Promise<unknown>,
  code: string,
  message: string,
) {
  await expect(operation).rejects.toMatchObject({ code, message });
}

beforeEach(async () => {
  db = new PGlite();
  await applyCurrentSchema(db);
  await db.query("insert into auth.users (id) values ($1), ($2)", [ownerA, ownerB]);
});

afterEach(async () => {
  await db?.close();
});

describe("health day daily sync migration", () => {
  it("creates an invoker function with only authenticated execute rights", async () => {
    const functions = await db.query<{
      prosecdef: boolean;
      proretset: boolean;
      search_path: string[];
    }>(`
      select p.prosecdef, p.proretset, p.proconfig[1:] as search_path
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'upsert_health_day_v1'
    `);
    const grants = await db.query<{ grantee: string; privilege_type: string }>(`
      select coalesce(grantee.rolname, 'PUBLIC') as grantee, acl.privilege_type
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(p.proacl) as acl
      left join pg_roles grantee on grantee.oid = acl.grantee
      where n.nspname = 'public'
        and p.oid = 'public.upsert_health_day_v1(date,timestamptz,jsonb)'::regprocedure
        and acl.privilege_type = 'EXECUTE'
        and acl.grantee <> p.proowner
      order by grantee
    `);
    const privileges = await db.query<{ anon_execute: boolean; public_execute: boolean }>(`
      select
        pg_catalog.has_function_privilege(
          'anon',
          'public.upsert_health_day_v1(date,timestamptz,jsonb)',
          'EXECUTE'
        ) as anon_execute,
        pg_catalog.has_function_privilege(
          0::oid,
          'public.upsert_health_day_v1(date,timestamptz,jsonb)',
          'EXECUTE'
        ) as public_execute
    `);

    expect(functions.rows).toEqual([
      {
        prosecdef: false,
        proretset: true,
        search_path: ['search_path=""'],
      },
    ]);
    expect(grants.rows).toEqual([
      { grantee: "authenticated", privilege_type: "EXECUTE" },
    ]);
    expect(privileges.rows).toEqual([{ anon_execute: false, public_execute: false }]);
  });

  it("rejects anonymous and missing authenticated identities", async () => {
    const { health_date, generated_at } = await today();

    await expectSqlError(
      upsertAs("anon", null, health_date, generated_at),
      "42501",
      "permission denied for function upsert_health_day_v1",
    );
    await expectSqlError(
      upsertAs("authenticated", null, health_date, generated_at),
      "42501",
      "health_day_unauthenticated",
    );
  });

  it("creates revision one for Owner A while Owner B cannot read or modify it", async () => {
    const { health_date, generated_at } = await today();
    const created = await upsertAs("authenticated", ownerA, health_date, generated_at);

    expect(created.rows).toEqual([
      expect.objectContaining({
        action: "created",
        health_date: returnedDate(health_date),
        revision: 1,
      }),
    ]);
    const hiddenFromOwnerB = await queryAs<{ id: number }>(
      "authenticated",
      ownerB,
      "select id from public.health_days where health_date = $1::date",
      [health_date],
    );
    expect(hiddenFromOwnerB.rows).toEqual([]);

    const ownerBWrite = await upsertAs("authenticated", ownerB, health_date, generated_at, {
      ...summary,
      steps: 9,
    });
    expect(ownerBWrite.rows).toEqual([
      expect.objectContaining({ action: "created", revision: 1 }),
    ]);
    const ownerARow = await queryAs<{ summary: { steps: number }; revision: number }>(
      "authenticated",
      ownerA,
      "select summary, revision from public.health_days where health_date = $1::date",
      [health_date],
    );
    expect(ownerARow.rows).toEqual([{ summary, revision: 1 }]);
  });

  it("rejects summaries that do not have exactly the five allowed keys", async () => {
    const { health_date, generated_at } = await today();

    await expectSqlError(upsertAs("authenticated", ownerA, health_date, generated_at, {
      ...summary,
      unexpected: true,
    }), "22023", "health_day_invalid_source");
    await expectSqlError(upsertAs("authenticated", ownerA, health_date, generated_at, {
      steps: summary.steps,
      active_energy: summary.active_energy,
      exercise_minutes: summary.exercise_minutes,
      sleep_start: summary.sleep_start,
    }), "22023", "health_day_invalid_source");
  });

  it("rejects negative metrics and fractional steps", async () => {
    const { health_date, generated_at } = await today();
    for (const invalidSummary of [
      { ...summary, steps: -1 },
      { ...summary, steps: 1.5 },
      { ...summary, active_energy: -0.1 },
      { ...summary, exercise_minutes: -1 },
    ]) {
      await expectSqlError(
        upsertAs("authenticated", ownerA, health_date, generated_at, invalidSummary),
        "22023",
        "health_day_invalid_source",
      );
    }
  });

  it("accepts null or timezone-bearing sleep timestamps and rejects timestamps without a timezone", async () => {
    const { health_date, generated_at } = await today();
    await expect(
      upsertAs("authenticated", ownerA, health_date, generated_at),
    ).resolves.toMatchObject({ rows: [expect.objectContaining({ action: "created" })] });
    await expect(upsertAs("authenticated", ownerB, health_date, generated_at, {
      ...summary,
      sleep_start: "2000-01-01T22:00:00+08:00",
      sleep_end: "2000-01-02T06:00:00Z",
    })).resolves.toMatchObject({ rows: [expect.objectContaining({ action: "created" })] });
    await expectSqlError(upsertAs("authenticated", ownerB, health_date, generated_at, {
      ...summary,
      sleep_start: "2026-08-26T22:00:00",
      sleep_end: "2026-08-27T06:00:00+08:00",
    }), "22023", "health_day_invalid_source");
  });

  it("rejects yesterday and tomorrow even when their payloads otherwise match", async () => {
    const { health_date, generated_at } = await today();

    await expectSqlError(queryAs(
      "authenticated",
      ownerA,
      "select * from public.upsert_health_day_v1($1::date - 1, $2::timestamptz - interval '1 day', $3::jsonb)",
      [health_date, generated_at, summary],
    ), "22023", "health_day_invalid_source");
    await expectSqlError(queryAs(
      "authenticated",
      ownerA,
      "select * from public.upsert_health_day_v1($1::date + 1, $2::timestamptz + interval '1 day', $3::jsonb)",
      [health_date, generated_at, summary],
    ), "22023", "health_day_invalid_source");
  });

  it("keeps revision one for an identical generated timestamp and summary", async () => {
    const { health_date, generated_at } = await today();
    const first = await upsertAs("authenticated", ownerA, health_date, generated_at);
    const second = await upsertAs("authenticated", ownerA, health_date, generated_at);

    expect(second.rows).toEqual([{
      action: "unchanged",
      id: first.rows[0].id,
      health_date: returnedDate(health_date),
      revision: 1,
    }]);
  });

  it("updates the same row to revision two for a later generated timestamp", async () => {
    const { health_date, generated_at } = await today();
    const first = await upsertAs("authenticated", ownerA, health_date, generated_at);
    const updated = await queryAs<{
      action: string;
      id: number;
      health_date: string;
      revision: number;
    }>(
      "authenticated",
      ownerA,
      "select * from public.upsert_health_day_v1($1::date, $2::timestamptz + interval '1 minute', $3::jsonb)",
      [health_date, generated_at, { ...summary, steps: 5000 }],
    );

    expect(updated.rows).toEqual([{
      action: "updated",
      id: first.rows[0].id,
      health_date: returnedDate(health_date),
      revision: 2,
    }]);
  });

  it("rejects stale source data without changing the stored row", async () => {
    const { health_date, generated_at } = await today();
    await queryAs(
      "authenticated",
      ownerA,
      "select * from public.upsert_health_day_v1($1::date, $2::timestamptz + interval '1 minute', $3::jsonb)",
      [health_date, generated_at, { ...summary, steps: 5000 }],
    );

    await expectSqlError(
      upsertAs("authenticated", ownerA, health_date, generated_at),
      "22023",
      "health_day_stale_source",
    );
    const stored = await queryAs<{ summary: { steps: number }; revision: number }>(
      "authenticated",
      ownerA,
      "select summary, revision from public.health_days where health_date = $1::date",
      [health_date],
    );
    expect(stored.rows).toEqual([{ summary: { ...summary, steps: 5000 }, revision: 1 }]);
  });

  it("rejects different summary data at the same generated timestamp", async () => {
    const { health_date, generated_at } = await today();
    await upsertAs("authenticated", ownerA, health_date, generated_at);

    await expectSqlError(upsertAs("authenticated", ownerA, health_date, generated_at, {
      ...summary,
      steps: 5000,
    }), "40001", "health_day_conflict");
  });

  it("keeps a fractional-second source canonical for identical retries", async () => {
    const { health_date, generated_at, source_revision } = await fractionalToday();
    const first = await upsertAs("authenticated", ownerA, health_date, generated_at);
    const second = await upsertAs("authenticated", ownerA, health_date, generated_at);
    const stored = await queryAs<{ source_revision: string; revision: number }>(
      "authenticated",
      ownerA,
      "select source_revision, revision from public.health_days where health_date = $1::date",
      [health_date],
    );

    expect(second.rows).toEqual([{
      action: "unchanged",
      id: first.rows[0].id,
      health_date: returnedDate(health_date),
      revision: 1,
    }]);
    expect(stored.rows).toEqual([{ source_revision, revision: 1 }]);
  });

  it("rejects a conflicting fractional-second retry", async () => {
    const { health_date, generated_at } = await fractionalToday();
    await upsertAs("authenticated", ownerA, health_date, generated_at);

    await expectSqlError(upsertAs("authenticated", ownerA, health_date, generated_at, {
      ...summary,
      steps: 5000,
    }), "40001", "health_day_conflict");
  });

  it("rejects a stale fractional-second source without changing stored data", async () => {
    const { health_date, generated_at, source_revision } = await fractionalToday();
    await upsertAs("authenticated", ownerA, health_date, generated_at);

    await expectSqlError(queryAs(
      "authenticated",
      ownerA,
      "select * from public.upsert_health_day_v1($1::date, $2::timestamptz - interval '0.250 seconds', $3::jsonb)",
      [health_date, generated_at, { ...summary, steps: 5000 }],
    ), "22023", "health_day_stale_source");
    const stored = await queryAs<{ source_revision: string; summary: { steps: number } }>(
      "authenticated",
      ownerA,
      "select source_revision, summary from public.health_days where health_date = $1::date",
      [health_date],
    );
    expect(stored.rows).toEqual([{ source_revision, summary }]);
  });

  it("holds a transaction-level advisory lock across deterministic duplicate submissions", async () => {
    const { health_date, generated_at } = await today();
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerA]);
    await db.exec("begin");
    try {
      await db.exec("set local role authenticated");
      const first = await db.query<{ action: string; revision: number }>(
        "select action, revision from public.upsert_health_day_v1($1::date, $2::timestamptz, $3::jsonb)",
        [health_date, generated_at, summary],
      );
      const second = await db.query<{ action: string; revision: number }>(
        "select action, revision from public.upsert_health_day_v1($1::date, $2::timestamptz, $3::jsonb)",
        [health_date, generated_at, summary],
      );
      const locks = await db.query<{ count: number }>(`
        select count(*)::int as count
        from pg_catalog.pg_locks
        where locktype = 'advisory' and granted
      `);
      const rows = await db.query<{ count: number }>(
        "select count(*)::int as count from public.health_days where health_date = $1::date",
        [health_date],
      );

      expect(first.rows).toEqual([{ action: "created", revision: 1 }]);
      expect(second.rows).toEqual([{ action: "unchanged", revision: 1 }]);
      expect(locks.rows).toEqual([{ count: 1 }]);
      expect(rows.rows).toEqual([{ count: 1 }]);
    } finally {
      await db.exec("rollback");
      await db.exec("reset role");
    }
  });

  it("returns only action, id, health_date and revision", async () => {
    const { health_date, generated_at } = await today();
    const result = await upsertAs("authenticated", ownerA, health_date, generated_at);

    expect(Object.keys(result.rows[0]).sort()).toEqual([
      "action",
      "health_date",
      "id",
      "revision",
    ]);
    expect(result.rows[0]).not.toHaveProperty("summary");
  });
});
