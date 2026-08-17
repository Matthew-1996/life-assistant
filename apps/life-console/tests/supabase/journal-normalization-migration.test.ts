// @vitest-environment node

import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let db: PGlite;

async function queryAs<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
) {
  await db.exec("reset role");
  await db.query(
    "select set_config('request.jwt.claim.sub', $1, false)",
    [owner],
  );
  await db.exec("set role authenticated");
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

beforeAll(async () => {
  db = new PGlite();
  const migrations = [
    "./fixtures/auth-shim.sql",
    "../../supabase/migrations/0001_life_console.sql",
    "../../supabase/migrations/0002_harden_automatic_rls_helper.sql",
    "../../supabase/migrations/0003_cover_health_segment_foreign_key.sql",
    "../../supabase/migrations/0005_migration_tracking.sql",
    "../../supabase/migrations/20260815165912_life_console_230_online_primary.sql",
    "../../supabase/migrations/20260816170000_unified_journal_normalization.sql",
    "../../supabase/migrations/20260816171759_retry_failed_journal_normalization.sql",
    "../../supabase/migrations/20260816220627_preserve_completed_journal_normalization.sql",
    "../../supabase/migrations/20260817021112_enforce_agent_normalization_priority.sql",
  ];
  for (const migration of migrations) {
    if (migration.endsWith("0005_migration_tracking.sql")) {
      await db.exec("create role service_role nologin");
    }
    if (migration.endsWith("20260815165912_life_console_230_online_primary.sql")) {
      await db.exec(`
        insert into auth.users (id) values ('${owner}');
        insert into public.journals (user_id, event_date, title, content)
        values ('${owner}', date '2030-01-01', 'Legacy synthetic', 'Legacy raw');
      `);
    }
    await db.exec(await readFile(new URL(migration, import.meta.url), "utf8"));
  }
});

afterAll(async () => {
  await db?.close();
});

describe("Life Console 2.4.0 journal normalization migration", () => {
  it("marks existing journals as legacy without changing their raw content", async () => {
    const result = await db.query<{
      content: string;
      normalization_status: string;
      raw_revision: number;
    }>(`
      select content, normalization_status, raw_revision
      from public.journals where title = 'Legacy synthetic'
    `);
    expect(result.rows).toEqual([{
      content: "Legacy raw",
      normalization_status: "legacy",
      raw_revision: 1,
    }]);
  });

  it("creates a raw-first pending journal through the v2 RPC", async () => {
    const result = await queryAs<{
      id: number;
      content: string;
      normalization_status: string;
      raw_revision: number;
      source: string;
      time_precision: string;
    }>(`
      select id, content, normalization_status, raw_revision, source, time_precision
      from public.create_journal_v2(
        'journal:synthetic-normalization-1',
        'idem:synthetic-normalization-1',
        date '2030-02-01',
        null,
        'unknown',
        'life_console',
        'owner-only',
        'Synthetic raw journal'
      )
    `);
    expect(result.rows).toEqual([expect.objectContaining({
      content: "Synthetic raw journal",
      normalization_status: "pending",
      raw_revision: 1,
      source: "life_console",
      time_precision: "unknown",
    })]);
  });

  it("completes one owner-scoped job without changing raw text", async () => {
    const journal = await queryAs<{ id: number; revision: number; raw_revision: number }>(`
      select id, revision, raw_revision from public.journals
      where record_key = 'journal:synthetic-normalization-1'
    `);
    const source = journal.rows[0];
    const job = await queryAs<{ id: string }>(`
      select id from public.begin_journal_normalization(
        ${source.id}, ${source.raw_revision},
        'journal-normalization/1.0.0',
        'journal-normalization-prompt/1.0.0',
        'agent', 'task:synthetic-normalization-1'
      )
    `);
    const metadata = {
      title: "Synthetic organized title",
      summary: "Synthetic summary",
      facts: [], feelings: [], people: [], places: [], themes: [],
      planning_clues: [], inferences: [], tags: [],
    };
    const completed = await queryAs<{
      content: string;
      title: string;
      normalization_status: string;
      raw_revision: number;
      normalized_source_revision: number;
    }>(`
      select content, title, normalization_status, raw_revision,
             normalized_source_revision
      from public.complete_journal_normalization(
        '${job.rows[0].id}'::uuid,
        ${source.raw_revision},
        '${JSON.stringify(metadata)}'::jsonb,
        'Synthetic organized title',
        array[]::text[]
      )
    `);
    expect(completed.rows).toEqual([{
      content: "Synthetic raw journal",
      title: "Synthetic organized title",
      normalization_status: "completed",
      raw_revision: 1,
      normalized_source_revision: 1,
    }]);
  });

  it("rejects stale completion after the raw source changes", async () => {
    const created = await queryAs<{ id: number; raw_revision: number }>(`
      select id, raw_revision from public.create_journal_v2(
        'journal:synthetic-normalization-2',
        'idem:synthetic-normalization-2',
        date '2030-02-02', null, 'unknown', 'agent', 'owner-only',
        'Original synthetic raw'
      )
    `);
    const row = created.rows[0];
    const job = await queryAs<{ id: string }>(`
      select id from public.begin_journal_normalization(
        ${row.id}, ${row.raw_revision},
        'journal-normalization/1.0.0',
        'journal-normalization-prompt/1.0.0',
        'agent', 'task:synthetic-normalization-2'
      )
    `);
    await queryAs(`
      update public.journals
      set content = 'Changed synthetic raw', revision = revision + 1
      where id = ${row.id}
    `);

    await expect(queryAs(`
      select * from public.complete_journal_normalization(
        '${job.rows[0].id}'::uuid,
        ${row.raw_revision},
        '{"title":"Stale","summary":"","facts":[],"feelings":[],"people":[],"places":[],"themes":[],"planning_clues":[],"inferences":[],"tags":[]}'::jsonb,
        'Stale', array[]::text[]
      )
    `)).rejects.toThrow(/source revision/i);

    const current = await queryAs<{
      content: string;
      raw_revision: number;
      normalization_status: string;
    }>(`select content, raw_revision, normalization_status from public.journals where id = ${row.id}`);
    expect(current.rows).toEqual([{
      content: "Changed synthetic raw",
      raw_revision: 2,
      normalization_status: "pending",
    }]);
  });

  it("reopens one failed job exactly once and keeps completed jobs idempotent", async () => {
    const created = await queryAs<{ id: number; raw_revision: number }>(`
      select id, raw_revision from public.create_journal_v2(
        'journal:synthetic-normalization-retry',
        'idem:synthetic-normalization-retry',
        date '2030-02-03', null, 'unknown', 'life_console', 'owner-only',
        'Synthetic retry raw'
      )
    `);
    const row = created.rows[0];
    const taskKey = 'task:synthetic-normalization-retry';
    const first = await queryAs<{ id: string; attempts: number }>(`
      select id, attempts from public.begin_journal_normalization(
        ${row.id}, ${row.raw_revision},
        'journal-normalization/1.0.0',
        'journal-normalization-prompt/1.0.0',
        'deepseek', '${taskKey}'
      )
    `);
    await queryAs(`select * from public.fail_journal_normalization(
      '${first.rows[0].id}'::uuid, ${row.raw_revision}, 'provider_http_503'
    )`);
    const retried = await queryAs<{ id: string; status: string; attempts: number; failure_code: string | null }>(`
      select id, status, attempts, failure_code from public.begin_journal_normalization(
        ${row.id}, ${row.raw_revision},
        'journal-normalization/1.0.0',
        'journal-normalization-prompt/1.0.0',
        'deepseek', '${taskKey}'
      )
    `);
    expect(retried.rows).toEqual([{
      id: first.rows[0].id,
      status: "processing",
      attempts: 2,
      failure_code: null,
    }]);
    await queryAs(`select * from public.complete_journal_normalization(
      '${first.rows[0].id}'::uuid, ${row.raw_revision},
      '{"title":"Retry title","summary":"","facts":[],"feelings":[],"people":[],"places":[],"themes":[],"planning_clues":[],"inferences":[],"tags":[]}'::jsonb,
      'Retry title', array[]::text[]
    )`);
    const completed = await queryAs<{ status: string; attempts: number }>(`
      select status, attempts from public.begin_journal_normalization(
        ${row.id}, ${row.raw_revision},
        'journal-normalization/1.0.0',
        'journal-normalization-prompt/1.0.0',
        'deepseek', '${taskKey}'
      )
    `);
    expect(completed.rows).toEqual([{ status: "completed", attempts: 2 }]);
  });

  it("reopens one completed Agent job for a newer prompt version", async () => {
    const created = await queryAs<{ id: number; raw_revision: number }>(`
      select id, raw_revision from public.create_journal_v2(
        'journal:synthetic-agent-prompt-upgrade',
        'idem:synthetic-agent-prompt-upgrade',
        date '2030-02-04', null, 'unknown', 'agent', 'owner-only',
        'Synthetic prompt upgrade raw'
      )
    `);
    const row = created.rows[0];
    const taskKey = 'task:synthetic-agent-prompt-upgrade';
    const first = await queryAs<{ id: string }>(`
      select id from public.begin_journal_normalization(
        ${row.id}, ${row.raw_revision},
        'journal-normalization/1.0.0',
        'journal-normalization-prompt/1.0.0',
        'agent', '${taskKey}'
      )
    `);
    await queryAs(`select * from public.complete_journal_normalization(
      '${first.rows[0].id}'::uuid, ${row.raw_revision},
      '{"title":"First title","summary":"","facts":[],"feelings":[],"people":[],"places":[],"themes":[],"planning_clues":[],"inferences":[],"tags":[]}'::jsonb,
      'First title', array[]::text[]
    )`);

    const reopened = await queryAs<{
      id: string;
      status: string;
      attempts: number;
      prompt_version: string;
    }>(`
      select id, status, attempts, prompt_version
      from public.begin_journal_normalization(
        ${row.id}, ${row.raw_revision},
        'journal-normalization/1.0.0',
        'journal-normalization-prompt/1.0.1',
        'agent', '${taskKey}'
      )
    `);
    expect(reopened.rows).toEqual([{
      id: first.rows[0].id,
      status: "processing",
      attempts: 2,
      prompt_version: "journal-normalization-prompt/1.0.1",
    }]);
  });

  it("does not let a failed provider overwrite a completed Agent result", async () => {
    const created = await queryAs<{ id: number; raw_revision: number }>(`
      select id, raw_revision from public.create_journal_v2(
        'journal:synthetic-cross-processor-failure',
        'idem:synthetic-cross-processor-failure',
        date '2030-02-05', null, 'unknown', 'agent', 'owner-only',
        'Synthetic cross processor raw'
      )
    `);
    const row = created.rows[0];
    const provider = await queryAs<{ id: string }>(`
      select id from public.begin_journal_normalization(
        ${row.id}, ${row.raw_revision},
        'journal-normalization/1.0.0',
        'journal-normalization-prompt/1.0.1',
        'deepseek', 'task:synthetic-cross-processor-provider'
      )
    `);
    const agent = await queryAs<{ id: string }>(`
      select id from public.begin_journal_normalization(
        ${row.id}, ${row.raw_revision},
        'journal-normalization/1.0.0',
        'journal-normalization-prompt/1.0.1',
        'agent', 'task:synthetic-cross-processor-agent'
      )
    `);
    await queryAs(`select * from public.complete_journal_normalization(
      '${agent.rows[0].id}'::uuid, ${row.raw_revision},
      '{"title":"Agent title","summary":"","facts":[],"feelings":[],"people":[],"places":[],"themes":[],"planning_clues":[],"inferences":[],"tags":[]}'::jsonb,
      'Agent title', array[]::text[]
    )`);
    await queryAs(`select * from public.fail_journal_normalization(
      '${provider.rows[0].id}'::uuid, ${row.raw_revision}, 'provider_timeout'
    )`);

    const journal = await queryAs<{
      normalization_status: string;
      normalization_processor: string;
      title: string;
      content: string;
    }>(`
      select normalization_status, normalization_processor, title, content
      from public.journals where id = ${row.id}
    `);
    expect(journal.rows).toEqual([{
      normalization_status: "completed",
      normalization_processor: "agent",
      title: "Agent title",
      content: "Synthetic cross processor raw",
    }]);
  });

  it("rejects a second begin while the same task is processing", async () => {
    const created = await queryAs<{ id: number; raw_revision: number }>(`
      select id, raw_revision from public.create_journal_v2(
        'journal:synthetic-processing-lock', 'idem:synthetic-processing-lock',
        date '2030-02-06', null, 'unknown', 'agent', 'owner-only',
        'Synthetic processing raw'
      )
    `);
    const row = created.rows[0];
    const call = () => queryAs(`select * from public.begin_journal_normalization(
      ${row.id}, ${row.raw_revision}, 'journal-normalization/1.0.0',
      'journal-normalization-prompt/1.0.1', 'agent',
      'task:synthetic-processing-lock'
    )`);
    await call();
    await expect(call()).rejects.toThrow(/already processing/i);
  });

  it("does not let a late successful provider overwrite a completed Agent", async () => {
    const created = await queryAs<{ id: number; raw_revision: number }>(`
      select id, raw_revision from public.create_journal_v2(
        'journal:synthetic-late-provider', 'idem:synthetic-late-provider',
        date '2030-02-07', null, 'unknown', 'agent', 'owner-only',
        'Synthetic late provider raw'
      )
    `);
    const row = created.rows[0];
    const provider = await queryAs<{ id: string }>(`select id from public.begin_journal_normalization(
      ${row.id}, ${row.raw_revision}, 'journal-normalization/1.0.0',
      'journal-normalization-prompt/1.0.1', 'deepseek', 'task:synthetic-late-provider-ds'
    )`);
    const agent = await queryAs<{ id: string }>(`select id from public.begin_journal_normalization(
      ${row.id}, ${row.raw_revision}, 'journal-normalization/1.0.0',
      'journal-normalization-prompt/1.0.1', 'agent', 'task:synthetic-late-provider-agent'
    )`);
    const fields = '"summary":"","facts":[],"feelings":[],"people":[],"places":[],"themes":[],"planning_clues":[],"inferences":[],"tags":[]';
    await queryAs(`select * from public.complete_journal_normalization(
      '${agent.rows[0].id}'::uuid, ${row.raw_revision},
      '{"title":"Agent wins",${fields}}'::jsonb, 'Agent wins', array[]::text[]
    )`);
    await queryAs(`select * from public.complete_journal_normalization(
      '${provider.rows[0].id}'::uuid, ${row.raw_revision},
      '{"title":"Provider late",${fields}}'::jsonb, 'Provider late', array[]::text[]
    )`);
    const current = await queryAs<{ title: string; normalization_processor: string }>(`
      select title, normalization_processor from public.journals where id = ${row.id}
    `);
    expect(current.rows).toEqual([{ title: "Agent wins", normalization_processor: "agent" }]);
  });

  it("keeps normalization RPC lock order job before journal", async () => {
    const functions = await db.query<{ name: string; definition: string }>(`
      select p.proname as name, pg_get_functiondef(p.oid) as definition
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('begin_journal_normalization', 'complete_journal_normalization', 'fail_journal_normalization')
    `);
    for (const item of functions.rows) {
      expect(item.definition.indexOf("journal_normalization_jobs"))
        .toBeLessThan(item.definition.indexOf("public.journals"));
    }
  });

  it("enables RLS on jobs and the approved person context projection", async () => {
    const tables = await db.query<{ relname: string; relrowsecurity: boolean }>(`
      select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('journal_normalization_jobs', 'journal_context_entities')
      order by c.relname
    `);
    expect(tables.rows).toEqual([
      { relname: "journal_context_entities", relrowsecurity: true },
      { relname: "journal_normalization_jobs", relrowsecurity: true },
    ]);
  });
});
