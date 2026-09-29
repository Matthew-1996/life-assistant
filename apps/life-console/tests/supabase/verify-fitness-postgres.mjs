/** Real multi-connection tests in a new Unix-socket-only temporary cluster.
 * FITNESS_TEST_PG_BIN=/postgres/bin FITNESS_TEST_PG_MODULE=/node_modules/pg/lib/index.js node this-file.mjs
 * Never accepts a database URL or connects to an existing cluster.
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

const bin = process.env.FITNESS_TEST_PG_BIN;
const modulePath = process.env.FITNESS_TEST_PG_MODULE;
if (!bin || !modulePath) throw new Error('Explicit local PostgreSQL binaries and pg module required');
const { Client } = createRequire(import.meta.url)(modulePath);
const app = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = mkdtempSync(join(tmpdir(), 'fitness-pg-'));
const socket = join(root, 'socket'), data = join(root, 'data');
mkdirSync(socket, { mode: 0o700 });
const owner = '11111111-1111-4111-8111-111111111111';
const connections = [];
let running = false;
async function connect(auth = false) {
  const client = new Client({ host: socket, port: 55483, user: 'fitness_test', database: 'postgres', statement_timeout: 10000 });
  connections.push(client);
  await client.connect();
  if (auth) await client.query(`set request.jwt.claim.sub='${owner}'; set role authenticated`);
  return client;
}
try {
  execFileSync(join(bin, 'initdb'), ['-D', data, '-U', 'fitness_test', '-A', 'trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${socket} -h '' -p 55483`, '-w', 'start'], { stdio: 'pipe' });
  running = true;
  const admin = await connect();
  const migrations = join(app, 'supabase/migrations');
  for (const file of [join(app, 'tests/supabase/fixtures/auth-shim.sql'), join(migrations, '0001_life_console.sql'), join(migrations, readdirSync(migrations).find(n => n.endsWith('_fitness_appointments.sql'))), join(migrations, readdirSync(migrations).find(n => n.endsWith('_fitness_http_conflicts.sql')))]) await admin.query(readFileSync(file, 'utf8'));
  await admin.query(`insert into auth.users(id) values ($1);`, [owner]);
  await admin.query('insert into life_console_private.fitness_owners(user_id) values ($1)', [owner]);
  const a = await connect(true), b = await connect(true);
  const create = key => ({ text: `select * from public.create_fitness_appointment($1,$2,'2030-05-01T10:00Z','2030-05-01T11:00Z','','')`, values: [key, 'Synthetic appointment'] });
  async function race(first, second) {
    await a.query('begin');
    try {
      const result = await a.query(first);
      let settled = false;
      const pending = b.query(second).then(value => ({value}), error => ({error})).finally(() => { settled = true; });
      let blocked = false;
      for (let i = 0; i < 250 && !settled; i++) {
        const state = await admin.query("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock') blocked", [b.processID]);
        if (state.rows[0].blocked) { blocked = true; break; }
        await setTimeout(20);
      }
      assert.ok(blocked, 'second connection must actually wait on a PostgreSQL lock');
      await a.query('commit');
      return [result.rows[0], await pending];
    } finally { await a.query('rollback'); }
  }
  const [row, duplicate] = await race(create('fitness-concurrent-same-key'), create('fitness-concurrent-same-key'));
  assert.ifError(duplicate.error);
  assert.equal(duplicate.value.rows[0].id, row.id);
  assert.equal((await admin.query('select count(*)::int n from public.audit_events where entity_id=$1', [row.id])).rows[0].n, 1);
  assert.equal((await admin.query('select count(*)::int n from life_console_private.fitness_create_receipts where operation_key=$1', ['fitness-concurrent-same-key'])).rows[0].n, 1);
  console.log('PASS same key concurrent create: one appointment, receipt and audit');
  const altered = create('fitness-concurrent-different'); altered.values[1] = 'Different';
  const [, conflict] = await race(create('fitness-concurrent-different'), altered);
  assert.equal(conflict.error?.code, 'PT409');
  console.log('PASS same key different payload: conflict');
  const [updated, deleted] = await race({ text: `select * from public.update_fitness_appointment($1,1,'Updated','2030-05-01T12:00Z','2030-05-01T13:00Z','','')`, values: [row.id] }, { text: 'select * from public.soft_delete_fitness_appointment($1,1)', values: [row.id] });
  assert.equal(updated.revision, 2);
  assert.equal(deleted.error?.code, 'PT409');
  assert.equal((await admin.query('select deleted_at from public.fitness_appointments where id=$1', [row.id])).rows[0].deleted_at, null);
  console.log('PASS same revision concurrent update/delete: only update succeeds');
} finally {
  await Promise.allSettled(connections.map(client => client.end()));
  if (running) execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
  rmSync(root, { recursive: true, force: true });
}
