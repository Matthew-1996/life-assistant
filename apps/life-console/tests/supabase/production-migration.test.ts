// @vitest-environment node

import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const expectedTables = [
  "audit_events",
  "backup_runs",
  "daily_checkins",
  "goals",
  "health_days",
  "health_segments",
  "idempotency_keys",
  "journal_revisions",
  "journals",
  "phase_reviews",
  "profiles",
  "weekly_reviews",
];

const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
  const authShim = new URL("./fixtures/auth-shim.sql", import.meta.url);
  const migration = new URL(
    "../../supabase/migrations/0001_life_console.sql",
    import.meta.url,
  );
  const seed = new URL("../../supabase/seed.synthetic.sql", import.meta.url);
  await db.exec(await readFile(authShim, "utf8"));
  await db.exec(await readFile(migration, "utf8"));
  await db.exec(await readFile(seed, "utf8"));
});

afterAll(async () => {
  await db?.close();
});

describe("Life Console production Supabase migration", () => {
  it("creates the approved tables with RLS enabled", async () => {
    const tables = await db.query<{
      relname: string;
      relrowsecurity: boolean;
    }>(
      `select c.relname, c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
       order by c.relname`,
    );
    expect(tables.rows.map((row) => row.relname)).toEqual(expectedTables);
    expect(tables.rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it("indexes every ownership predicate and exposed foreign key", async () => {
    const indexes = await db.query<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and indexname in (
           'profiles_user_id_idx',
           'goals_user_status_idx',
           'goals_user_created_idx',
           'journals_user_event_idx',
           'journal_revisions_user_journal_idx',
           'daily_checkins_user_date_idx',
           'weekly_reviews_user_week_idx',
           'phase_reviews_user_period_idx',
           'health_days_user_date_idx',
           'health_segments_user_day_idx',
           'idempotency_keys_user_expiry_idx',
           'backup_runs_user_created_idx',
           'audit_events_user_created_idx'
         )
       order by indexname`,
    );
    expect(indexes.rows).toHaveLength(13);
  });

  it("uses invoker rights and an empty search path for snapshot export", async () => {
    const functions = await db.query<{
      prosecdef: boolean;
      search_path: string[];
    }>(
      `select p.prosecdef, p.proconfig[1:] as search_path
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'export_life_console_snapshot'`,
    );
    expect(functions.rows).toEqual([
      { prosecdef: false, search_path: ['search_path=""'] },
    ]);
  });

  it("protects goal creation RPC with invoker rights and authenticated execute", async () => {
    const functions = await db.query<{
      prosecdef: boolean;
      proretset: boolean;
      search_path: string[];
    }>(
      `select p.prosecdef, p.proretset, p.proconfig[1:] as search_path
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'create_goal'`,
    );
    expect(functions.rows).toEqual([
      {
        prosecdef: false,
        proretset: true,
        search_path: ['search_path=""'],
      },
    ]);

    const grants = await db.query<{
      grantee: string;
      privilege_type: string;
    }>(
      `select grantee, privilege_type
       from information_schema.routine_privileges
       where routine_schema = 'public'
         and routine_name = 'create_goal'
         and grantee <> 'postgres'
       order by grantee, privilege_type`,
    );
    expect(grants.rows).toEqual([
      { grantee: "authenticated", privilege_type: "EXECUTE" },
    ]);

    await expect(
      queryAs(
        "anon",
        null,
        `select id from public.create_goal(
          'synthetic-anon-key-0001',
          'Anonymous goal',
          null,
          'active',
          null,
          null,
          null
        )`,
      ),
    ).rejects.toThrow();
  });

  it("creates a goal once for an idempotent replay and writes one audit event", async () => {
    const before = await queryAs<{ count: number }>(
      "authenticated",
      ownerA,
      "select count(*)::int as count from public.goals",
    );
    const create = () =>
      queryAs<{
        id: number;
        revision: number;
        title: string;
      }>(
        "authenticated",
        ownerA,
        `select id, revision, title
         from public.create_goal($1, $2, $3, $4, $5, $6, $7)`,
        [
          "synthetic-goal-key-0001",
          "Synthetic Goal Created",
          "test",
          "active",
          2,
          "2030-02-01",
          "2030-02-28",
        ],
      );

    const first = await create();
    const replay = await create();

    expect(replay.rows).toEqual(first.rows);
    expect(first.rows).toEqual([
      expect.objectContaining({
        revision: 1,
        title: "Synthetic Goal Created",
      }),
    ]);
    const after = await queryAs<{ count: number }>(
      "authenticated",
      ownerA,
      "select count(*)::int as count from public.goals",
    );
    expect(after.rows[0].count).toBe(before.rows[0].count + 1);

    const audit = await queryAs<{
      action: string;
      entity_type: string;
      result: string;
    }>(
      "authenticated",
      ownerA,
      `select action, entity_type, result
       from public.audit_events
       where entity_type = 'goal'
         and entity_id = $1`,
      [String(first.rows[0].id)],
    );
    expect(audit.rows).toEqual([
      {
        action: "CREATE",
        entity_type: "goal",
        result: "success",
      },
    ]);
  });

  it("rejects an idempotency key reused with a changed body", async () => {
    await queryAs(
      "authenticated",
      ownerA,
      `select id from public.create_goal(
        'synthetic-goal-key-0002',
        'Synthetic Original',
        null,
        'active',
        null,
        null,
        null
      )`,
    );

    await expect(
      queryAs(
        "authenticated",
        ownerA,
        `select id from public.create_goal(
          'synthetic-goal-key-0002',
          'Synthetic Changed',
          null,
          'active',
          null,
          null,
          null
        )`,
      ),
    ).rejects.toThrow(/different request/i);
  });

  it("scopes identical idempotency keys by authenticated owner", async () => {
    const key = "synthetic-shared-key-0001";
    const createFor = (userId: string, title: string) =>
      queryAs<{ id: number; user_id: string; title: string }>(
        "authenticated",
        userId,
        `select id, user_id, title
         from public.create_goal($1, $2, null, 'active', null, null, null)`,
        [key, title],
      );

    const ownerAGoal = await createFor(ownerA, "Synthetic Owner A Goal");
    const ownerBGoal = await createFor(ownerB, "Synthetic Owner B Goal");

    expect(ownerAGoal.rows[0].user_id).toBe(ownerA);
    expect(ownerBGoal.rows[0].user_id).toBe(ownerB);
    expect(ownerAGoal.rows[0].id).not.toBe(ownerBGoal.rows[0].id);
  });

  it("does not grant physical delete on personal tables", async () => {
    const deleteGrants = await db.query<{ table_name: string }>(
      `select table_name
       from information_schema.role_table_grants
       where table_schema = 'public'
         and grantee in ('anon', 'authenticated')
         and privilege_type = 'DELETE'`,
    );
    expect(deleteGrants.rows).toEqual([]);
  });

  it("gives update policies both using and with-check predicates", async () => {
    const policies = await db.query<{
      tablename: string;
      qual: string | null;
      with_check: string | null;
    }>(
      `select tablename, qual, with_check
       from pg_policies
       where schemaname = 'public'
         and cmd = 'UPDATE'
       order by tablename`,
    );
    expect(policies.rows.length).toBeGreaterThan(0);
    expect(
      policies.rows.every((policy) => policy.qual && policy.with_check),
    ).toBe(true);
  });

  it("isolates owner rows and rejects anonymous reads", async () => {
    const ownerRows = await queryAs<{ title: string }>(
      "authenticated",
      ownerA,
      "select title from public.journals order by id",
    );
    expect(ownerRows.rows).toEqual([{ title: "Synthetic Alpha" }]);

    const crossOwnerRows = await queryAs(
      "authenticated",
      ownerB,
      "select id from public.journals where user_id = $1",
      [ownerA],
    );
    expect(crossOwnerRows.rows).toEqual([]);

    await expect(
      queryAs("anon", null, "select id from public.journals"),
    ).rejects.toThrow();
  });

  it("rejects owner reassignment and physical deletion", async () => {
    await expect(
      queryAs(
        "authenticated",
        ownerA,
        "update public.journals set user_id = $1 where user_id = $2",
        [ownerB, ownerA],
      ),
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

  it("preserves nulls and rejects stale revisions", async () => {
    const initial = await queryAs<{
      mood: string | null;
      sleep_quality: string;
    }>(
      "authenticated",
      ownerA,
      `select mood, sleep_quality
       from public.daily_checkins
       where checkin_date = date '2030-01-01'`,
    );
    expect(initial.rows).toEqual([{ mood: null, sleep_quality: "8.2" }]);

    const updated = await queryAs<{ revision: number }>(
      "authenticated",
      ownerA,
      `update public.daily_checkins
       set energy = 7.4, revision = revision + 1, updated_at = now()
       where user_id = $1 and checkin_date = date '2030-01-01'
         and revision = 1
       returning revision`,
      [ownerA],
    );
    expect(updated.rows).toEqual([{ revision: 2 }]);

    const stale = await queryAs(
      "authenticated",
      ownerA,
      `update public.daily_checkins
       set energy = 6.0, revision = revision + 1
       where user_id = $1 and checkin_date = date '2030-01-01'
         and revision = 1
       returning revision`,
      [ownerA],
    );
    expect(stale.rows).toEqual([]);
  });

  it("exports only the caller's rows through the invoker RPC", async () => {
    const result = await queryAs<{ snapshot: Record<string, unknown> }>(
      "authenticated",
      ownerA,
      "select public.export_life_console_snapshot() as snapshot",
    );
    const snapshot = result.rows[0].snapshot as {
      journals: Array<{ title: string }>;
      daily_checkins: Array<{ mood: number | null }>;
    };
    expect(snapshot.journals.map((row) => row.title)).toEqual([
      "Synthetic Alpha",
    ]);
    expect(snapshot.daily_checkins).toHaveLength(1);
    expect(snapshot.daily_checkins[0].mood).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain("Synthetic Beta");
  });
});
