// @vitest-environment node
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { createBackupArchive } from "../../src/supabase/backups";
import { strFromU8, unzipSync } from "fflate";
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
async function setup() {
  const db = new PGlite();
  await db.exec(
    await readFile("tests/supabase/fixtures/auth-shim.sql", "utf8"),
  );
  for (const name of [
    "0001_life_console.sql",
    "20260819161427_life_console_250.sql",
    ...(await readdir("supabase/migrations"))
      .filter(
        (n) =>
          n.endsWith("_fitness_appointments.sql") ||
          n.endsWith("_fitness_backup_v4.sql") || n.endsWith("_fitness_http_conflicts.sql"),
      )
      .sort(),
  ]) {
    await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
  }
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.query(
    "insert into life_console_private.fitness_owners(user_id) values ($1),($2)",
    [owner, other],
  );
  return db;
}
it("exports only the current Owner including tombstones and restores exact appointment identities into an isolated database", async () => {
  const db = await setup();
  let restored: PGlite | undefined;
  try {
    for (const user of [owner, other]) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        user,
      ]);
      await db.exec("set role authenticated");
      await db.query(
        "select * from public.create_fitness_appointment($1,'合成预约','2030-05-01T10:00Z','2030-05-01T11:00Z','场地','备注')",
        ["backup-synthetic"],
      );
      await db.exec("reset role");
    }
    await db.query(
      "update public.fitness_appointments set revision=3,deleted_at='2030-05-02T00:00Z' where user_id=$1",
      [owner],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    await db.exec("set role authenticated");
    const snapshot = (
      await db.query<{ snapshot: any }>(
        "select public.export_life_console_snapshot() as snapshot",
      )
    ).rows[0].snapshot;
    expect(snapshot.schema_version).toBe(4);
    expect(snapshot.fitness_appointments).toHaveLength(1);
    expect(snapshot.fitness_appointments[0]).toMatchObject({
      user_id: owner,
      revision: 3,
    });
    expect(snapshot.fitness_appointments[0].deleted_at).toBeTruthy();
    expect(Object.keys(snapshot).join()).not.toMatch(
      /subscription|receipts|owners/,
    );
    await db.exec("reset role; set role anon");
    await expect(
      db.query("select public.export_life_console_snapshot()"),
    ).rejects.toThrow(/permission denied/);
    const archive = await createBackupArchive(snapshot, {
      exportId: "synthetic-restore",
      sourceProductVersion: "2.10.0",
      sourceSchemaVersion: "supabase/4",
    });
    const rows = strFromU8(
      unzipSync(archive.bytes)["data/fitness_appointments.ndjson"],
    )
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    restored = await setup();
    await restored.query(
      "insert into public.fitness_appointments select * from jsonb_populate_recordset(null::public.fitness_appointments,$1::jsonb)",
      [JSON.stringify(rows)],
    );
    const result = (
      await restored.query<{ rows: any }>(
        "select jsonb_agg(to_jsonb(a)) as rows from public.fitness_appointments a",
      )
    ).rows[0].rows;
    expect(result).toEqual(snapshot.fitness_appointments);
    expect(
      (
        await restored.query(
          "select * from life_console_private.fitness_calendar_subscription",
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await db.close();
    await restored?.close();
  }
});
