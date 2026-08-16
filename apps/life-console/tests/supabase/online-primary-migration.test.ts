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
    "../../supabase/migrations/20260816111000_owner_backup_request.sql",
    "../../supabase/migrations/20260816113000_controlled_online_primary_cutover.sql",
  ];
  for (const file of files) {
    if (file.endsWith("0005_migration_tracking.sql")) {
      await db.exec("create role service_role nologin");
    }
    if (file.endsWith("20260815165912_life_console_230_online_primary.sql")) {
      await db.exec(`
        insert into auth.users (id)
        values ('00000000-0000-4000-8000-000000000230');
        insert into public.journals (user_id, event_date, title, content)
        values (
          '00000000-0000-4000-8000-000000000230',
          date '2030-01-01',
          'Synthetic pre-migration journal',
          'Synthetic content'
        );
      `);
    }
    await db.exec(await readFile(new URL(file, import.meta.url), "utf8"));
  }
});

afterAll(async () => {
  await db?.close();
});

describe("Life Console 2.3.0 online-primary migration", () => {
  it("backfills existing journals without creating a false revision", async () => {
    const journals = await db.query<{ record_key: string; revision: number }>(
      `select record_key, revision
       from public.journals
       where user_id = '00000000-0000-4000-8000-000000000230'`,
    );
    const revisions = await db.query<{ count: number }>(
      `select count(*)::int as count
       from public.journal_revisions
       where user_id = '00000000-0000-4000-8000-000000000230'`,
    );

    expect(journals.rows).toEqual([
      { record_key: "legacy:journal:1", revision: 1 },
    ]);
    expect(revisions.rows).toEqual([{ count: 1 }]);
  });

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

  it("creates an owner-scoped backup request through the shared RPC", async () => {
    await db.exec(
      `select set_config(
        'request.jwt.claim.sub',
        '00000000-0000-4000-8000-000000000230',
        false
      )`,
    );
    const result = await db.query<{ user_id: string; status: string; manifest_version: number }>(
      `select user_id, status, manifest_version
       from public.request_life_console_backup()`,
    );

    expect(result.rows).toEqual([{
      user_id: "00000000-0000-4000-8000-000000000230",
      status: "pending",
      manifest_version: 2,
    }]);
  });

  it("cuts over the exact audited duplicate set and local delta atomically", async () => {
    const owner = "00000000-0000-4000-8000-000000000230";
    const sourceRun = "00000000-0000-4000-8000-000000000231";
    const cutoverRun = "00000000-0000-4000-8000-000000000232";
    await db.exec(`
      insert into public.migration_runs (id, manifest_digest, status)
      values ('${sourceRun}', repeat('a', 64), 'completed');
      do $seed$
      declare
        group_number integer;
        copy_number integer;
        created_id bigint;
      begin
        for group_number in 1..10 loop
          for copy_number in 1..3 loop
            insert into public.journals (
              user_id, event_date, title, content, tags
            ) values (
              '${owner}',
              date '2030-02-01' + group_number,
              'Synthetic duplicate ' || group_number,
              'Synthetic duplicate content ' || group_number,
              array['synthetic']
            ) returning id into created_id;
            if copy_number = 1 then
              insert into public.migration_imports (
                migration_run_id, table_name, source_stable_id, imported_id
              ) values (
                '${sourceRun}', 'journals',
                'synthetic-source-' || group_number, created_id
              );
            end if;
          end loop;
        end loop;
      end
      $seed$;
      insert into public.daily_checkins (user_id, checkin_date)
      select '${owner}', date '2030-03-01' + value
      from generate_series(0, 13) value;
      insert into public.goals (user_id, title, status, deleted_at)
      select '${owner}', 'Synthetic goal ' || value,
             case when value = 6 then 'archived' else 'active' end,
             case when value = 6 then now() else null end
      from generate_series(1, 6) value;
      insert into public.weekly_reviews (user_id, week_start, content)
      values ('${owner}', date '2030-03-04', 'Synthetic weekly');
      insert into public.phase_reviews (
        user_id, period_start, period_end, content
      ) values (
        '${owner}', date '2030-03-01', date '2030-03-31', 'Synthetic phase'
      );
      insert into public.health_days (user_id, health_date)
      select '${owner}', date '2030-03-01' + value
      from generate_series(0, 7) value;
    `);

    const result = await db.query<{ result: Record<string, unknown> }>(
      `select public.cutover_life_console_230(
        $1::uuid,
        repeat('b', 64),
        $2::jsonb,
        $3::jsonb
      ) as result`,
      [
        cutoverRun,
        JSON.stringify(Array.from({ length: 3 }, (_, index) => ({
          record_key: `local-journal:synthetic-${index + 1}`,
          event_date: `2030-04-0${index + 1}`,
          title: `Synthetic local ${index + 1}`,
          content: `Synthetic local content ${index + 1}`,
          tags: ["synthetic"],
          metadata: { source: "synthetic" },
          created_at: "2030-04-01T00:00:00Z",
          updated_at: "2030-04-01T00:00:00Z",
        }))),
        JSON.stringify([{
          source_stable_id: "local-daily:2030-04-01",
          checkin_date: "2030-04-01",
          sleep_quality: 4,
          energy: 4,
          mood: 4,
          life_feeling: 4,
          sleep_time: "00:30",
          wake_time: "08:00",
          out_of_bed_time: "08:15",
          awake_in_bed: "no",
          anchors: {},
          notes: "Synthetic daily",
          created_at: "2030-04-01T00:00:00Z",
          updated_at: "2030-04-01T00:00:00Z",
        }]),
      ],
    );

    expect(result.rows[0].result).toMatchObject({
      status: "completed",
      removed_journals: 20,
      removed_goals: 1,
      inserted_journals: 3,
      inserted_daily_checkins: 1,
      final_counts: {
        journals: 14,
        daily_checkins: 15,
        goals: 5,
      },
    });
    const duplicates = await db.query<{ count: number }>(
      `select count(*)::int as count from (
         select event_date, title, content, tags, deleted_at
         from public.journals where user_id = $1
         group by event_date, title, content, tags, deleted_at
         having count(*) > 1
       ) groups`,
      [owner],
    );
    expect(duplicates.rows).toEqual([{ count: 0 }]);
  });
});
