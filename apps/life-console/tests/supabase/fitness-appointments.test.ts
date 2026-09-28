// @vitest-environment node
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const guest = "33333333-3333-4333-8333-333333333333";
let db: PGlite;
let key = 0;
const input = (title = "合成预约") => [`fitness-synthetic-${++key}`, title, "2030-05-01T10:00:00Z", "2030-05-01T11:00:00Z", "示例场地", "合成备注"];
async function asUser(sql: string, params: unknown[] = [], user: string | null = owner, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(`set role ${role}`);
  try { return (await db.query<Record<string, any>>(sql, params)).rows; }
  finally { await db.exec("reset role"); }
}
const create = (params: unknown[] = input(), user: string | null = owner, role = "authenticated") =>
  asUser("select * from public.create_fitness_appointment($1,$2,$3,$4,$5,$6)", params, user, role);
const update = (id: unknown, rev: unknown, title = "更新预约", user = owner) => asUser(
  "select * from public.update_fitness_appointment($1,$2,$3,$4,$5,$6,$7)",
  [id,rev,title,"2030-05-02T10:00:00Z","2030-05-02T11:00:00Z","新场地","新备注"],user);
const remove = (id: unknown, rev: unknown, user = owner) => asUser("select * from public.soft_delete_fitness_appointment($1,$2)",[id,rev],user);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/auth-shim.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/0001_life_console.sql", import.meta.url), "utf8"));
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const migration = (await readdir(dir)).find(name => name.endsWith("_fitness_appointments.sql"));
  if (!migration) throw new Error("Fitness appointment migration is not implemented");
  await db.exec(await readFile(new URL(migration, dir), "utf8"));
  await db.query("insert into auth.users(id) values ($1),($2),($3)",[owner,other,guest]);
  await db.query("insert into life_console_private.fitness_owners(user_id) values ($1),($2)",[owner,other]);
});
afterAll(async () => { await db?.close(); });

describe("fitness appointment SQL behavior", () => {
  it("denies anonymous, missing identity and non-Owner even with a self-created profile", async () => {
    await expect(create(input(),null,"anon")).rejects.toThrow();
    await expect(create(input(),null)).rejects.toThrow(/Owner|Authentication/);
    await asUser("insert into public.profiles(user_id,display_name) values ($1,'Owner')",[guest],guest);
    await expect(create(input(),guest)).rejects.toThrow(/Owner/);
    await expect(asUser("select * from public.list_fitness_appointments($1,$2)",["2030-05-01","2030-06-01"],guest)).rejects.toThrow(/Owner/);
  });
  it("isolates Owners and denies direct writes to appointments and authorization", async () => {
    const [row] = await create();
    expect(await asUser("select * from public.fitness_appointments where id=$1",[row.id],other)).toEqual([]);
    expect(await asUser("select * from public.get_fitness_appointment($1)",[row.id],other)).toEqual([]);
    await expect(update(row.id,1,"跨账号",other)).rejects.toThrow(/not found/);
    await expect(remove(row.id,1,other)).rejects.toThrow(/not found/);
    for (const sql of [
      "insert into public.fitness_appointments(user_id,title,start_at,end_at) values (auth.uid(),'bad',now(),now())",
      "update public.fitness_appointments set title='bad'",
      "delete from public.fitness_appointments",
      "insert into life_console_private.fitness_owners(user_id) values (auth.uid())",
      "select * from life_console_private.fitness_create_receipts",
      "update life_console_private.fitness_calendar_subscription set enabled=true",
    ]) await expect(asUser(sql)).rejects.toThrow(/permission denied/);
  });
  it("revoking Owner access blocks reads and writes without modifying other modules", async () => {
    const [row] = await create(input(),other);
    await db.query("update life_console_private.fitness_owners set enabled=false where user_id=$1",[other]);
    try {
      expect(await asUser("select * from public.fitness_appointments",[],other)).toEqual([]);
      await expect(update(row.id,1,"停用",other)).rejects.toThrow(/Owner/);
    } finally { await db.query("update life_console_private.fitness_owners set enabled=true where user_id=$1",[other]); }
  });
  it("creates once, normalizes title and equivalent time offsets, and rejects changed input", async () => {
    const p=input("  私教  ");const [a]=await create(p);
    const [b]=await create([p[0],"私教","2030-05-01T18:00:00+08:00","2030-05-01T19:00:00+08:00",...p.slice(4)]);
    expect(b.id).toBe(a.id);expect(a.title).toBe("私教");expect(a.revision).toBe(1);
    await expect(create([p[0],"不同标题",...p.slice(2)])).rejects.toThrow(/Idempotency/);
    const rows=await db.query<{count:number}>("select count(*)::int as count from public.audit_events where entity_type='fitness_appointment' and entity_id=$1",[a.id]);
    expect(rows.rows[0].count).toBe(1);
  });
  it("keeps idempotency receipts private and scopes operation keys to Owner", async () => {
    const p=input();const [a]=await create(p);const [b]=await create(p,other);expect(a.id).not.toBe(b.id);
    const receipts=await db.query("select * from life_console_private.fitness_create_receipts where operation_key=$1",[p[0]]);
    expect(receipts.rows).toHaveLength(2);expect(JSON.stringify(receipts.rows)).not.toContain("合成备注");
  });
  it.each([
    ["", "2030-05-01T10:00Z", "2030-05-01T11:00Z", "", ""],
    ["x".repeat(121), "2030-05-01T10:00Z", "2030-05-01T11:00Z", "", ""],
    ["事件", "2030-05-01T10:00Z", "2030-05-01T10:00Z", "", ""],
    ["事件", "2030-05-01T15:30Z", "2030-05-01T16:30Z", "", ""],
    ["事件", "infinity", "infinity", "", ""],
    ["事件", "2030-05-01T10:00Z", "2030-05-01T11:00Z", "x".repeat(241), ""],
    ["事件", "2030-05-01T10:00Z", "2030-05-01T11:00Z", "", "x".repeat(4001)],
  ])("rejects invalid fields, same instant and cross-Shanghai-day time", async (...p) => {
    await expect(create([input()[0],...p])).rejects.toThrow();
  });
  it("accepts UTC midnight crossing within one Shanghai day and optional null fields", async () => {
    const [row]=await create([input()[0],"清晨预约","2030-04-30T23:30Z","2030-05-01T00:30Z",null,null]);
    expect(row.location).toBe("");expect(row.notes).toBe("");expect(row.time_zone).toBe("Asia/Shanghai");
  });
  it("protects edits and deletes with revision; repeat deletes and create retries never resurrect", async () => {
    const p=input();const [a]=await create(p);const [b]=await update(a.id,1);expect(b.revision).toBe(2);
    await expect(update(a.id,1)).rejects.toThrow(/revision/);
    await expect(remove(a.id,1)).rejects.toThrow(/revision/);
    const [c]=await remove(a.id,2);expect(c.revision).toBe(3);expect(c.deleted_at).toBeTruthy();
    expect((await remove(a.id,2))[0].revision).toBe(3);
    await expect(update(a.id,3)).rejects.toThrow(/deleted/);
    expect((await create(p))[0].deleted_at).toEqual(c.deleted_at);
    expect((await asUser("select * from public.get_fitness_appointment($1)",[a.id]))[0].deleted_at).toBeTruthy();
  });
  it("initializes a disabled feed without a token and bumps only on successful mutations", async () => {
    const state=async()=> (await db.query<{feed_revision:number;enabled:boolean;token_hash:null}>("select * from life_console_private.fitness_calendar_subscription where user_id=$1",[owner])).rows[0];
    const before=(await state())?.feed_revision??0;const p=input();const [a]=await create(p);
    expect(await state()).toMatchObject({enabled:false,token_hash:null,feed_revision:before+1});
    await create(p);expect((await state()).feed_revision).toBe(before+1);
    await update(a.id,1);await expect(update(a.id,1)).rejects.toThrow();expect((await state()).feed_revision).toBe(before+2);
    await remove(a.id,2);await remove(a.id,2);expect((await state()).feed_revision).toBe(before+3);
  });
  it("paginates tied timestamps without omissions and filters Shanghai date boundaries and deleted rows", async () => {
    for(let i=0;i<103;i++) await create([input()[0],`分页 ${i}`,"2031-06-01T02:00Z","2031-06-01T03:00Z","",""]);
    const page=await asUser("select * from public.list_fitness_appointments($1,$2)",["2031-06-01","2031-06-02"]);
    expect(page).toHaveLength(101);const last=page[99];
    const next=await asUser("select * from public.list_fitness_appointments($1,$2,$3,$4)",["2031-06-01","2031-06-02",last.start_at,last.id]);
    expect(next).toHaveLength(3);expect(new Set([...page.slice(0,100),...next].map(x=>x.id)).size).toBe(103);
    await remove(next[0].id,1);
    const after=await asUser("select * from public.list_fitness_appointments($1,$2,$3,$4)",["2031-06-01","2031-06-02",last.start_at,last.id]);expect(after).toHaveLength(2);
    const outside=await asUser("select * from public.list_fitness_appointments($1,$2)",["2031-06-02","2031-06-03"]);expect(outside).toEqual([]);
    for(const range of [["2031-01-01","2031-04-01"],["2031-06-02","2031-06-01"]]) await expect(asUser("select * from public.list_fitness_appointments($1,$2)",range)).rejects.toThrow(/range/);
  });
  it("grants only the intended RPCs and keeps private tables RLS enabled", async () => {
    const rows=await db.query<{name:string;anon:boolean;authenticated:boolean;proconfig:string[]}>(`select p.proname as name, has_function_privilege('anon',p.oid,'execute') as anon, has_function_privilege('authenticated',p.oid,'execute') as authenticated,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_fitness_appointment','update_fitness_appointment','soft_delete_fitness_appointment','get_fitness_appointment','list_fitness_appointments')`);
    expect(rows.rows).toHaveLength(5);for(const row of rows.rows){expect(row.anon).toBe(false);expect(row.authenticated).toBe(true);expect(row.proconfig.join(',')).toContain('search_path=');}
    const privateTables=await db.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='life_console_private' and relkind='r'");
    expect(privateTables.rows).toHaveLength(3);expect(privateTables.rows.every(x=>x.relrowsecurity)).toBe(true);
  });
});
