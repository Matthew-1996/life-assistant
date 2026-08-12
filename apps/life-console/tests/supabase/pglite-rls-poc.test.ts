// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";

let db: PGlite;

async function queryAs<T extends Record<string, unknown>>(
  role: "anon" | "authenticated",
  userId: string | null,
  sql: string,
  params: unknown[] = [],
) {
  await db.exec("reset role");
  await db.query(
    "select set_config('request.jwt.claim.sub', $1, false)",
    [userId ?? ""],
  );
  await db.exec(`set role ${role}`);
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

beforeAll(async () => {
  db = new PGlite();
  const fixtureUrl = new URL("./fixtures/life-console-poc.sql", import.meta.url);
  await db.exec(await readFile(fixtureUrl, "utf8"));
  await db.query(
    "insert into auth.users (id) values ($1), ($2)",
    [ownerA, ownerB],
  );
  await db.query(
    `insert into public.journals (user_id, event_date, title, content)
     values ($1, '2026-08-12', 'Synthetic A', 'alpha'),
            ($2, '2026-08-12', 'Synthetic B', 'beta')`,
    [ownerA, ownerB],
  );
});

afterAll(async () => {
  await db.close();
});

describe("Life Console Supabase RLS feasibility", () => {
  it("enables RLS and indexes every ownership predicate", async () => {
    const tables = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity
       from pg_class
       where relname in ('journals', 'daily_checkins')
       order by relname`,
    );
    expect(tables.rows).toEqual([
      { relname: "daily_checkins", relrowsecurity: true },
      { relname: "journals", relrowsecurity: true },
    ]);

    const indexes = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes
       where indexname in (
         'journals_user_date_idx',
         'daily_checkins_user_date_idx'
       ) order by indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "daily_checkins_user_date_idx",
      "journals_user_date_idx",
    ]);
  });

  it("shows owners only their rows, including through a security-invoker view", async () => {
    const direct = await queryAs<{ title: string }>(
      "authenticated",
      ownerA,
      "select title from public.journals order by id",
    );
    const view = await queryAs<{ title: string }>(
      "authenticated",
      ownerB,
      "select title from public.journal_feed order by id",
    );
    expect(direct.rows).toEqual([{ title: "Synthetic A" }]);
    expect(view.rows).toEqual([{ title: "Synthetic B" }]);
  });

  it("returns no owner rows to a different authenticated user", async () => {
    const result = await queryAs(
      "authenticated",
      ownerB,
      "select id from public.journals where user_id = $1",
      [ownerA],
    );
    expect(result.rows).toEqual([]);
  });

  it("rejects anonymous reads and physical deletes", async () => {
    await expect(
      queryAs("anon", null, "select id from public.journals"),
    ).rejects.toThrow();
    await expect(
      queryAs(
        "authenticated",
        ownerA,
        "delete from public.journals where user_id = $1",
        [ownerA],
      ),
    ).rejects.toThrow();
  });

  it("allows owner updates but rejects row reassignment", async () => {
    const updated = await queryAs<{ revision: number }>(
      "authenticated",
      ownerA,
      `update public.journals
       set title = 'Synthetic A2', revision = revision + 1
       where user_id = $1 and revision = 1
       returning revision`,
      [ownerA],
    );
    expect(updated.rows).toEqual([{ revision: 2 }]);

    await expect(
      queryAs(
        "authenticated",
        ownerA,
        "update public.journals set user_id = $1 where user_id = $2",
        [ownerB, ownerA],
      ),
    ).rejects.toThrow();
  });

  it("atomically upserts one check-in per owner and date", async () => {
    await queryAs(
      "authenticated",
      ownerA,
      `insert into public.daily_checkins
         (user_id, checkin_date, sleep_quality)
       values ($1, '2026-08-12', 8.2)
       on conflict (user_id, checkin_date)
       do update set
         sleep_quality = excluded.sleep_quality,
         revision = daily_checkins.revision + 1,
         updated_at = now()`,
      [ownerA],
    );
    await queryAs(
      "authenticated",
      ownerA,
      `insert into public.daily_checkins
         (user_id, checkin_date, sleep_quality)
       values ($1, '2026-08-12', 8.4)
       on conflict (user_id, checkin_date)
       do update set
         sleep_quality = excluded.sleep_quality,
         revision = daily_checkins.revision + 1,
         updated_at = now()`,
      [ownerA],
    );
    const result = await queryAs<{ sleep_quality: string; revision: number }>(
      "authenticated",
      ownerA,
      `select sleep_quality, revision
       from public.daily_checkins
       where checkin_date = '2026-08-12'`,
    );
    expect(result.rows).toEqual([{ sleep_quality: "8.4", revision: 2 }]);
  });

  it("exports one transaction-consistent owner snapshot through an invoker RPC", async () => {
    const functionSecurity = await db.query<{
      prosecdef: boolean;
      search_path: string[];
    }>(
      `select p.prosecdef, p.proconfig[1:] as search_path
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'export_life_console_snapshot'`,
    );
    expect(functionSecurity.rows).toEqual([
      { prosecdef: false, search_path: ['search_path=""'] },
    ]);

    const result = await queryAs<{ snapshot: Record<string, unknown> }>(
      "authenticated",
      ownerA,
      "select public.export_life_console_snapshot() as snapshot",
    );
    const snapshot = result.rows[0].snapshot as {
      schema_version: number;
      journals: Array<{ title: string }>;
      daily_checkins: Array<{ sleep_quality: number }>;
    };
    const projection = JSON.stringify(snapshot);
    const digest = createHash("sha256").update(projection).digest("hex");
    expect(snapshot.schema_version).toBe(1);
    expect(snapshot.journals.map((row) => row.title)).toEqual([
      "Synthetic A2",
    ]);
    expect(snapshot.daily_checkins).toHaveLength(1);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
