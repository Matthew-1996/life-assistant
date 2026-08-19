// @vitest-environment node

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
    "../../supabase/migrations/20260819161427_life_console_250.sql",
  ]) {
    await database.exec(await readFile(new URL(file, import.meta.url), "utf8"));
  }
}

beforeAll(async () => {
  db = new PGlite();
  await applyCurrentSchema(db);
  await db.query("insert into auth.users (id) values ($1), ($2)", [ownerA, ownerB]);
});

afterAll(async () => {
  await db?.close();
});

describe("Life Console 2.5.0 owner data behavior", () => {
  it("keeps all three resources isolated and denies direct writes", async () => {
    await queryAs(
      "authenticated",
      ownerA,
      `select * from public.create_todo($1, $2, $3, $4, $5)`,
      [
        "synthetic-owner-a-0001",
        "Owner A synthetic Todo",
        "P1",
        "2026-08-20T01:00:00Z",
        "2026-08-21T01:00:00Z",
      ],
    );
    await queryAs(
      "authenticated",
      ownerA,
      `select * from public.upsert_dashboard_message($1, $2, $3, $4, $5, $6, $7)`,
      [
        "synthetic-message-0001",
        "2026-08-17",
        null,
        "Owner A synthetic message",
        null,
        {},
        "sunrise",
      ],
    );

    for (const table of ["todo_items", "todo_status_events", "dashboard_messages"]) {
      const ownerBRows = await queryAs(
        "authenticated",
        ownerB,
        `select id from public.${table}`,
      );
      expect(ownerBRows.rows).toEqual([]);
    }

    await expect(
      queryAs(
        "authenticated",
        ownerA,
        `insert into public.todo_items (user_id, title, due_at)
         values ($1, 'Direct write', transaction_timestamp() + interval '1 day')`,
        [ownerA],
      ),
    ).rejects.toThrow();
    await expect(
      queryAs("anon", null, "select * from public.create_todo($1, $2, $3, $4, $5)", [
        "synthetic-anon-0001",
        "Anonymous Todo",
        "P1",
        null,
        "2026-08-21T01:00:00Z",
      ]),
    ).rejects.toThrow();
  });

  it("creates Todo idempotently and rejects a reused key with different input", async () => {
    const params = [
      "synthetic-idempotent-0001",
      "Idempotent Todo",
      "P0",
      null,
      "2026-08-22T01:00:00Z",
    ];
    const first = await queryAs<{ id: number; priority: string; status: string }>(
      "authenticated",
      ownerA,
      "select id, priority, status from public.create_todo($1, $2, $3, $4, $5)",
      params,
    );
    const repeated = await queryAs<{ id: number }>(
      "authenticated",
      ownerA,
      "select id from public.create_todo($1, $2, $3, $4, $5)",
      params,
    );

    expect(first.rows[0]).toMatchObject({ priority: "P0", status: "not_started" });
    expect(repeated.rows).toEqual([{ id: first.rows[0].id }]);
    await expect(
      queryAs(
        "authenticated",
        ownerA,
        "select * from public.create_todo($1, $2, $3, $4, $5)",
        [params[0], "Changed title", ...params.slice(2)],
      ),
    ).rejects.toThrow(/idempotency key/i);
  });

  it("guards Todo edits with revision and leaves status timestamps unchanged", async () => {
    const created = await queryAs<{
      id: number;
      revision: number;
      actual_started_at: string | null;
      completed_at: string | null;
    }>(
      "authenticated",
      ownerA,
      "select id, revision, actual_started_at, completed_at from public.create_todo($1, $2, $3, $4, $5)",
      [
        "synthetic-edit-0001",
        "Before edit",
        "P1",
        "2026-08-20T02:00:00Z",
        "2026-08-21T02:00:00Z",
      ],
    );
    const row = created.rows[0];
    await expect(
      queryAs(
        "authenticated",
        ownerA,
        "select * from public.update_todo($1, $2, $3, $4, $5, $6)",
        [row.id, null, "Missing revision", "P1", "2026-08-20T03:00:00Z", "2026-08-21T03:00:00Z"],
      ),
    ).rejects.toThrow(/revision/i);
    const updated = await queryAs<{
      title: string;
      revision: number;
      status: string;
      actual_started_at: string | null;
      completed_at: string | null;
    }>(
      "authenticated",
      ownerA,
      "select title, revision, status, actual_started_at, completed_at from public.update_todo($1, $2, $3, $4, $5, $6)",
      [
        row.id,
        row.revision,
        "After edit",
        "P2",
        "2026-08-20T03:00:00Z",
        "2026-08-21T03:00:00Z",
      ],
    );

    expect(updated.rows).toEqual([{
      title: "After edit",
      revision: 2,
      status: "not_started",
      actual_started_at: null,
      completed_at: null,
    }]);
    await expect(
      queryAs(
        "authenticated",
        ownerA,
        "select * from public.update_todo($1, $2, $3, $4, $5, $6)",
        [row.id, row.revision, "Stale", "P1", "2026-08-20T03:00:00Z", "2026-08-21T03:00:00Z"],
      ),
    ).rejects.toThrow(/revision/i);
    await expect(
      queryAs(
        "authenticated",
        ownerB,
        "select * from public.update_todo($1, $2, $3, $4, $5, $6)",
        [row.id, 2, "Cross owner", "P1", "2026-08-20T03:00:00Z", "2026-08-21T03:00:00Z"],
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("records atomic Todo transitions and treats a same-state request as a no-op", async () => {
    const created = await queryAs<{ id: number; revision: number }>(
      "authenticated",
      ownerA,
      "select id, revision from public.create_todo($1, $2, $3, $4, $5)",
      [
        "synthetic-transition-0001",
        "Transition Todo",
        "P1",
        "2026-08-20T04:00:00Z",
        "2026-08-21T04:00:00Z",
      ],
    );
    const directCompletion = await queryAs<{
      revision: number;
      status: string;
      actual_started_at: string;
      completed_at: string;
    }>(
      "authenticated",
      ownerA,
      "select revision, status, actual_started_at, completed_at from public.transition_todo($1, $2, $3)",
      [created.rows[0].id, 1, "completed"],
    );
    expect(directCompletion.rows[0].status).toBe("completed");
    expect(directCompletion.rows[0].revision).toBe(2);
    expect(directCompletion.rows[0].actual_started_at).toEqual(
      directCompletion.rows[0].completed_at,
    );

    const reopened = await queryAs<{
      revision: number;
      actual_started_at: string;
      completed_at: string | null;
    }>(
      "authenticated",
      ownerA,
      "select revision, actual_started_at, completed_at from public.transition_todo($1, $2, $3)",
      [created.rows[0].id, 2, "in_progress"],
    );
    expect(reopened.rows).toEqual([{
      revision: 3,
      actual_started_at: directCompletion.rows[0].actual_started_at,
      completed_at: null,
    }]);

    const sameState = await queryAs<{ revision: number }>(
      "authenticated",
      ownerA,
      "select revision from public.transition_todo($1, $2, $3)",
      [created.rows[0].id, 3, "in_progress"],
    );
    const eventsAfterNoop = await queryAs<{ count: number }>(
      "authenticated",
      ownerA,
      "select count(*)::int as count from public.todo_status_events where todo_id = $1",
      [created.rows[0].id],
    );
    expect(sameState.rows).toEqual([{ revision: 3 }]);
    expect(eventsAfterNoop.rows).toEqual([{ count: 2 }]);

    const reset = await queryAs<{
      revision: number;
      status: string;
      actual_started_at: string | null;
      completed_at: string | null;
    }>(
      "authenticated",
      ownerA,
      "select revision, status, actual_started_at, completed_at from public.transition_todo($1, $2, $3)",
      [created.rows[0].id, 3, "not_started"],
    );
    expect(reset.rows).toEqual([{
      revision: 4,
      status: "not_started",
      actual_started_at: null,
      completed_at: null,
    }]);
  });

  it("upserts one weekly message idempotently with revision protection", async () => {
    const params = [
      "synthetic-message-0002",
      "2026-08-24",
      null,
      "First weekly message",
      "Synthetic source",
      {
        image_url: "https://images.unsplash.com/photo-synthetic",
        image_author_name: "Synthetic Photographer",
        image_author_url: "https://unsplash.com/@synthetic",
        image_platform_url: "https://unsplash.com",
      },
      "dawn",
    ];
    const first = await queryAs<{ id: number; revision: number; image_author_name: string }>(
      "authenticated",
      ownerA,
      "select id, revision, image_author_name from public.upsert_dashboard_message($1, $2, $3, $4, $5, $6, $7)",
      params,
    );
    const repeated = await queryAs<{ id: number; revision: number }>(
      "authenticated",
      ownerA,
      "select id, revision from public.upsert_dashboard_message($1, $2, $3, $4, $5, $6, $7)",
      params,
    );
    expect(first.rows[0]).toMatchObject({ revision: 1, image_author_name: "Synthetic Photographer" });
    expect(repeated.rows).toEqual([{ id: first.rows[0].id, revision: 1 }]);
    await expect(
      queryAs(
        "authenticated",
        ownerA,
        "select * from public.upsert_dashboard_message($1, $2, $3, $4, $5, $6, $7)",
        ["synthetic-message-0005", params[1], null, "Missing revision", null, {}, "twilight"],
      ),
    ).rejects.toThrow(/revision/i);

    const updated = await queryAs<{ revision: number; message: string }>(
      "authenticated",
      ownerA,
      "select revision, message from public.upsert_dashboard_message($1, $2, $3, $4, $5, $6, $7)",
      ["synthetic-message-0003", params[1], 1, "Updated weekly message", null, {}, "twilight"],
    );
    expect(updated.rows).toEqual([{ revision: 2, message: "Updated weekly message" }]);
    await expect(
      queryAs(
        "authenticated",
        ownerA,
        "select * from public.upsert_dashboard_message($1, $2, $3, $4, $5, $6, $7)",
        ["synthetic-message-0004", params[1], 1, "Stale weekly message", null, {}, "twilight"],
      ),
    ).rejects.toThrow(/revision/i);
  });

  it("soft-deletes and restores only the owner's journal with idempotent repeats", async () => {
    await db.query(
      `insert into public.journals (user_id, event_date, title, content)
       values ($1, '2026-08-20', 'Synthetic journal', 'Synthetic content')
       returning id`,
      [ownerA],
    );
    const journal = await db.query<{ id: number; revision: number }>(
      "select id, revision from public.journals where user_id = $1 order by id desc limit 1",
      [ownerA],
    );
    await expect(
      queryAs(
        "authenticated",
        ownerA,
        "select * from public.soft_delete_journal($1, $2)",
        [journal.rows[0].id, null],
      ),
    ).rejects.toThrow(/revision/i);
    const deleted = await queryAs<{ revision: number; deleted_at: string }>(
      "authenticated",
      ownerA,
      "select revision, deleted_at from public.soft_delete_journal($1, $2)",
      [journal.rows[0].id, journal.rows[0].revision],
    );
    expect(deleted.rows[0].revision).toBe(journal.rows[0].revision + 1);
    expect(deleted.rows[0].deleted_at).toBeTruthy();

    const repeatedDelete = await queryAs<{ revision: number; deleted_at: string }>(
      "authenticated",
      ownerA,
      "select revision, deleted_at from public.soft_delete_journal($1, $2)",
      [journal.rows[0].id, journal.rows[0].revision],
    );
    expect(repeatedDelete.rows).toEqual(deleted.rows);
    await expect(
      queryAs(
        "authenticated",
        ownerB,
        "select * from public.restore_journal($1, $2)",
        [journal.rows[0].id, deleted.rows[0].revision],
      ),
    ).rejects.toThrow(/not found/i);

    const restored = await queryAs<{ revision: number; deleted_at: string | null }>(
      "authenticated",
      ownerA,
      "select revision, deleted_at from public.restore_journal($1, $2)",
      [journal.rows[0].id, deleted.rows[0].revision],
    );
    expect(restored.rows).toEqual([{
      revision: deleted.rows[0].revision + 1,
      deleted_at: null,
    }]);
    const repeatedRestore = await queryAs<{ revision: number; deleted_at: string | null }>(
      "authenticated",
      ownerA,
      "select revision, deleted_at from public.restore_journal($1, $2)",
      [journal.rows[0].id, deleted.rows[0].revision],
    );
    expect(repeatedRestore.rows).toEqual(restored.rows);
  });

  it("exports an owner-only schema v3 snapshot without public news cache", async () => {
    const ownerSnapshot = await queryAs<{ snapshot: Record<string, unknown> }>(
      "authenticated",
      ownerA,
      "select public.export_life_console_snapshot() as snapshot",
    );
    const snapshot = ownerSnapshot.rows[0].snapshot as {
      schema_version: number;
      todo_items: unknown[];
      todo_status_events: unknown[];
      dashboard_messages: unknown[];
    };
    expect(snapshot.schema_version).toBe(3);
    expect(snapshot.todo_items.length).toBeGreaterThan(0);
    expect(snapshot.todo_status_events.length).toBeGreaterThan(0);
    expect(snapshot.dashboard_messages.length).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toMatch(/daily.news|news/i);

    const otherOwner = await queryAs<{ snapshot: Record<string, unknown> }>(
      "authenticated",
      ownerB,
      "select public.export_life_console_snapshot() as snapshot",
    );
    expect(otherOwner.rows[0].snapshot).toMatchObject({
      schema_version: 3,
      todo_items: [],
      todo_status_events: [],
      dashboard_messages: [],
    });
  });
});
