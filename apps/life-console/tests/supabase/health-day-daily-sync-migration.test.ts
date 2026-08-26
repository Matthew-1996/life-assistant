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
      select grantee, privilege_type
      from information_schema.routine_privileges
      where routine_schema = 'public'
        and routine_name = 'upsert_health_day_v1'
        and grantee = 'authenticated'
        and privilege_type = 'EXECUTE'
      order by grantee
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
  });

  it("rejects anonymous and missing authenticated identities", async () => {
    const { health_date, generated_at } = await today();

    await expect(upsertAs("anon", null, health_date, generated_at)).rejects.toThrow(
      /permission denied|health_day_unauthenticated/i,
    );
    await expect(upsertAs("authenticated", null, health_date, generated_at)).rejects.toThrow(
      /health_day_unauthenticated/i,
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

    await expect(upsertAs("authenticated", ownerA, health_date, generated_at, {
      ...summary,
      unexpected: true,
    })).rejects.toThrow(/health_day_invalid_source/i);
    await expect(upsertAs("authenticated", ownerA, health_date, generated_at, {
      steps: summary.steps,
      active_energy: summary.active_energy,
      exercise_minutes: summary.exercise_minutes,
      sleep_start: summary.sleep_start,
    })).rejects.toThrow(/health_day_invalid_source/i);
  });

  it("rejects negative metrics and fractional steps", async () => {
    const { health_date, generated_at } = await today();
    for (const invalidSummary of [
      { ...summary, steps: -1 },
      { ...summary, steps: 1.5 },
      { ...summary, active_energy: -0.1 },
      { ...summary, exercise_minutes: -1 },
    ]) {
      await expect(
        upsertAs("authenticated", ownerA, health_date, generated_at, invalidSummary),
      ).rejects.toThrow(/health_day_invalid_source/i);
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
    await expect(upsertAs("authenticated", ownerB, health_date, generated_at, {
      ...summary,
      sleep_start: "2026-08-26T22:00:00",
      sleep_end: "2026-08-27T06:00:00+08:00",
    })).rejects.toThrow(/health_day_invalid_source/i);
  });

  it("rejects yesterday and tomorrow even when their payloads otherwise match", async () => {
    const { health_date, generated_at } = await today();

    await expect(queryAs(
      "authenticated",
      ownerA,
      "select * from public.upsert_health_day_v1($1::date - 1, $2::timestamptz - interval '1 day', $3::jsonb)",
      [health_date, generated_at, summary],
    )).rejects.toThrow(/health_day_invalid_source/i);
    await expect(queryAs(
      "authenticated",
      ownerA,
      "select * from public.upsert_health_day_v1($1::date + 1, $2::timestamptz + interval '1 day', $3::jsonb)",
      [health_date, generated_at, summary],
    )).rejects.toThrow(/health_day_invalid_source/i);
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

    await expect(upsertAs("authenticated", ownerA, health_date, generated_at)).rejects.toThrow(
      /health_day_stale_source/i,
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

    await expect(upsertAs("authenticated", ownerA, health_date, generated_at, {
      ...summary,
      steps: 5000,
    })).rejects.toThrow(/health_day_conflict/i);
  });

  it("leaves exactly one row after duplicate submissions", async () => {
    const { health_date, generated_at } = await today();
    await upsertAs("authenticated", ownerA, health_date, generated_at);
    await upsertAs("authenticated", ownerA, health_date, generated_at);

    const rows = await queryAs<{ count: number }>(
      "authenticated",
      ownerA,
      "select count(*)::int as count from public.health_days where health_date = $1::date",
      [health_date],
    );
    expect(rows.rows).toEqual([{ count: 1 }]);
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
