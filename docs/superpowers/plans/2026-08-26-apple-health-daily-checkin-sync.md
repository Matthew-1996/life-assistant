# Apple Health Daily Check-in Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从启用日起，在每天 14:00 的生活状态回访提问前，把当天有效的 iCloud Apple Health 六行摘要以 Owner 身份幂等写入 Supabase `health_days`，不补历史、不泄露健康值，也不让同步失败阻断回访。

**Architecture:** 本机解析器负责普通文件、固定字段、数值与 Asia/Shanghai 当天校验；`life_console_cloud.py health-day` 只把规范化五字段摘要和 `generated_at` 发给 authenticated-only RPC；RPC 以 `auth.uid() + health_date` 为唯一目标，在事务锁内完成创建、同值幂等、较新更新和旧来源拒绝。Git PR 只包含通用代码、SQL、合成测试和去敏文档；被 Git 忽略的正式 Prompt、注册表、运行自动化与真实 Owner 验收在 PO 分层批准后更新。

**Tech Stack:** Python 3 `unittest`、Supabase/PostgreSQL PL/pgSQL、PostgREST RPC、PGlite + Vitest、现有 macOS Keychain Owner Session、Codex automation runtime。

**Spec:** [`设计补充-AppleHealth每日回访同步-生活助手-LifeConsole-2.5.0.md`](../../knowledge-base/生活助手-LifeConsole-2.5.0/设计补充-AppleHealth每日回访同步-生活助手-LifeConsole-2.5.0.md)

## Global Constraints

- 只处理 `Asia/Shanghai` 当天；CLI 与 RPC 都拒绝过去或未来日期，禁止历史回填入口、循环和补偿队列。
- 只传输 `steps`、`active_energy`、`exercise_minutes`、`sleep_start`、`sleep_end`；`generated_at` 只保存为来源版本。
- 不把具体健康值、Owner ID、项目 ID、Token、Keychain 内容或运行自动化 ID 写进 Git、PR、日志、异常、测试 fixture 或对话验收证据。
- 使用 publishable key + Owner JWT；禁止 service role、客户端提交 `user_id`、管理 SQL 绕过 RLS 或 iCloud 本地历史回退。
- 不改 `health_days` 表结构、既有 RLS、进展页 Repository 或图表；本项不需要 Vercel Preview 或前端 Production 发布。
- 实施阶段停在 Draft PR 与合成验证。Production migration、PR merge、正式 Prompt/运行任务更新、真实 Owner 写入和旧 LaunchAgent 卸载分别保留 PO 门禁。
- 所有测试先红后绿；测试数据只能使用 `.invalid` 身份、固定 UUID 和合成健康值。

## File and Responsibility Map

| File | Responsibility |
|---|---|
| `tools/apple_health_history.py` | 暴露无副作用的六行摘要解析函数，并让原本地归档复用同一解析逻辑。 |
| `tools/test_apple_health_history.py` | 覆盖规范化、当天校验、非法源拒绝及“解析不写本地历史”。 |
| `apps/life-console/supabase/migrations/*_health_day_daily_sync.sql` | 由 Supabase CLI 生成文件名；新增 authenticated-only、Owner-scoped、today-only RPC。 |
| `apps/life-console/tests/supabase/health-day-daily-sync-migration.test.ts` | 在 PGlite 中验证权限、Owner 隔离、字段契约、幂等、revision 和旧来源拒绝。 |
| `apps/life-console/supabase/tests/hosted_permission_matrix.sql` | 托管环境只读检查函数 rights、search path 和角色授权。 |
| `tools/life_console_cloud.py` | 新增去敏 HTTP 错误映射、Owner RPC adapter 和 `health-day` CLI。 |
| `tools/test_life_console_cloud.py` | 验证请求形状、只调用一次、错误闭集、无健康值/Token 回显。 |
| `tools/validate_daily_health_sync_prompt.py` | 独立验证精确同步命令、执行顺序和禁止回填/泄露约束，不让尚未获批的私有 Prompt 阻塞代码 PR。 |
| `tools/test_daily_health_sync_prompt_contract.py` | 用合成 Prompt 验证契约红绿路径，不读取真实自动化标识。 |
| `automations/每日生活状态回访.prompt.txt` | 私有真相源；仅在 rollout 门禁后加入同步步骤，不进入 Git。 |
| `automations/registry.json` | 私有注册表；仅更新 Prompt SHA-256，不改变调度或目标，不进入 Git。 |
| `docs/knowledge-base/生活助手-LifeConsole-2.5.0/设计补充-AppleHealth每日回访同步-生活助手-LifeConsole-2.5.0.md` | 记录实现、合成验证与分层发布证据，禁止记录健康值和资源 ID。 |

---

### Task 1: Extract a side-effect-free Apple Health parser

**Files:**
- Modify: `tools/apple_health_history.py`
- Modify: `tools/test_apple_health_history.py`

- [ ] **Step 1: Write failing parser tests**

在 `tools/test_apple_health_history.py` 直接导入 `HealthHistoryError` 和 `read_health_summary`，新增以下断言：

```python
from apple_health_history import HealthHistoryError, read_health_summary

def test_read_health_summary_normalizes_without_creating_history(self):
    self.write_source()
    parsed = read_health_summary(self.source, "2026-08-06")

    self.assertEqual(parsed["health_date"], "2026-08-06")
    self.assertEqual(parsed["generated_at"], "2026-08-06T10:55:00+08:00")
    self.assertEqual(
        set(parsed["summary"]),
        {"steps", "active_energy", "exercise_minutes", "sleep_start", "sleep_end"},
    )
    self.assertEqual(parsed["summary"]["steps"], 8474)
    self.assertFalse((self.root / "apple-health-history.jsonl").exists())

def test_read_health_summary_rejects_nonmatching_date_without_side_effects(self):
    self.write_source()
    with self.assertRaisesRegex(HealthHistoryError, "不是指定日期"):
        read_health_summary(self.source, "2026-08-07")
    self.assertFalse(self.root.exists())
```

- [ ] **Step 2: Verify the tests fail for the missing API**

Run:

```bash
PYTHONPATH=tools python3 -m unittest tools.test_apple_health_history.AppleHealthHistoryTests.test_read_health_summary_normalizes_without_creating_history tools.test_apple_health_history.AppleHealthHistoryTests.test_read_health_summary_rejects_nonmatching_date_without_side_effects -v
```

Expected: FAIL because `read_health_summary` is not exported.

- [ ] **Step 3: Implement the minimal public parser and reuse it from `ingest`**

Add this function immediately after `_read_source`:

```python
def read_health_summary(source_path: Path, expected_date: str | None = None) -> dict[str, Any]:
    source = _read_source(source_path)
    health_date = source["generated_at"][:10]
    if expected_date is not None and _validate_date(expected_date) != health_date:
        raise HealthHistoryError("苹果健康摘要不是指定日期生成，已忽略")
    return {
        "health_date": health_date,
        "generated_at": source["generated_at"],
        "summary": {
            "steps": source["steps"],
            "active_energy": source["active_energy"],
            "exercise_minutes": source["exercise_minutes"],
            "sleep_start": source["sleep_start"],
            "sleep_end": source["sleep_end"],
        },
    }
```

Refactor `ingest` so it calls the public parser and reconstructs the existing six-key record shape without changing its CLI or ledger behavior:

```python
def ingest(root: Path, source_path: Path, expected_date: str | None) -> dict[str, Any]:
    parsed = read_health_summary(source_path, expected_date)
    record_date = parsed["health_date"]
    source = {"generated_at": parsed["generated_at"], **parsed["summary"]}
    key = f"apple-health-summary:{record_date}"
```

The remainder of `ingest`, beginning with `with _records_lock(root):`, stays byte-for-byte unchanged so this refactor cannot change ledger locking, revision, atomic-write or receipt semantics.

- [ ] **Step 4: Run parser and existing ledger regression tests**

Run:

```bash
PYTHONPATH=tools python3 -m unittest tools.test_apple_health_history -v
```

Expected: PASS; parser tests create no ledger, while all existing ingest/list behavior remains green.

- [ ] **Step 5: Commit Task 1**

```bash
git add tools/apple_health_history.py tools/test_apple_health_history.py
git commit -m "refactor: expose Apple Health summary parser"
```

---

### Task 2: Add the Owner-scoped, today-only Supabase RPC

**Files:**
- Create via CLI: `apps/life-console/supabase/migrations/*_health_day_daily_sync.sql`
- Create: `apps/life-console/tests/supabase/health-day-daily-sync-migration.test.ts`
- Modify: `apps/life-console/supabase/tests/hosted_permission_matrix.sql`

- [ ] **Step 1: Create the migration file through Supabase CLI**

From `apps/life-console`, run:

```bash
supabase migration new health_day_daily_sync
HEALTH_SYNC_MIGRATION="$(ls -1t supabase/migrations/*_health_day_daily_sync.sql | head -1)"
test -f "$HEALTH_SYNC_MIGRATION"
```

Keep `HEALTH_SYNC_MIGRATION` for the remaining commands in this task. Do not hand-invent a migration timestamp.

- [ ] **Step 2: Write failing PGlite permission and behavior tests**

Create `tests/supabase/health-day-daily-sync-migration.test.ts`. Reuse the repository's `auth-shim.sql`, `PGlite`, fixed Owner A/B UUIDs, and `queryAs` helper. Load the existing baseline migrations through `20260819161427_life_console_250.sql`, then load the exact new file emitted in Step 1.

The first test must assert the function shape and grants:

```ts
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
```

Use SQL to derive the synthetic request date inside PostgreSQL, avoiding a workstation-date assumption:

```ts
const today = await db.query<{ health_date: string; generated_at: string }>(`
  select
    (clock_timestamp() at time zone 'Asia/Shanghai')::date::text as health_date,
    ((clock_timestamp() at time zone 'Asia/Shanghai')::date + time '13:30')
      at time zone 'Asia/Shanghai' as generated_at
`);
```

Add separate tests for all of the following:

```ts
// anon and missing auth.uid() are rejected
// Owner A creates revision 1 and Owner B cannot read or modify A's row
// summary must contain exactly the five allowed keys and no extras
// steps rejects negative/fractional values; all metrics reject negative values
// sleep timestamps accept null or timezone-bearing ISO strings only
// yesterday and tomorrow are rejected even with otherwise valid payloads
// identical generated_at + summary returns unchanged and keeps revision 1
// later generated_at updates the same row and returns revision 2
// earlier generated_at raises health_day_stale_source and leaves stored data unchanged
// same generated_at + different summary raises health_day_conflict
// two duplicate submissions leave exactly one (user_id, health_date) row
// the RPC response has only action, id, health_date and revision, never summary
```

Use only synthetic payloads such as:

```ts
const summary = {
  steps: 4321,
  active_energy: 210.5,
  exercise_minutes: 18,
  sleep_start: null,
  sleep_end: null,
};
```

- [ ] **Step 3: Verify the migration tests fail before SQL is implemented**

Run from `apps/life-console`:

```bash
npx vitest run tests/supabase/health-day-daily-sync-migration.test.ts
```

Expected: FAIL because `public.upsert_health_day_v1` does not exist.

- [ ] **Step 4: Implement the RPC with exact return and error contracts**

Write the generated migration with this interface and control flow:

```sql
create or replace function public.upsert_health_day_v1(
  p_health_date date,
  p_generated_at timestamptz,
  p_summary jsonb
)
returns table(action text, id bigint, health_date date, revision bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_today date := (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date;
  v_summary jsonb := p_summary;
  v_existing public.health_days%rowtype;
  v_existing_generated_at timestamptz;
  v_field text;
  v_numeric numeric;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'health_day_unauthenticated';
  end if;
  if p_health_date is null
    or p_generated_at is null
    or p_health_date <> v_today
    or (p_generated_at at time zone 'Asia/Shanghai')::date <> v_today
  then
    raise exception using errcode = '22023', message = 'health_day_invalid_source';
  end if;
  if p_summary is null
    or pg_catalog.jsonb_typeof(v_summary) <> 'object'
    or not (v_summary ?& array[
      'steps', 'active_energy', 'exercise_minutes', 'sleep_start', 'sleep_end'
    ])
    or (v_summary - array[
      'steps', 'active_energy', 'exercise_minutes', 'sleep_start', 'sleep_end'
    ]::text[]) <> '{}'::jsonb
  then
    raise exception using errcode = '22023', message = 'health_day_invalid_source';
  end if;

  foreach v_field in array array['steps', 'active_energy', 'exercise_minutes'] loop
    if pg_catalog.jsonb_typeof(v_summary -> v_field) not in ('number', 'null') then
      raise exception using errcode = '22023', message = 'health_day_invalid_source';
    end if;
    if pg_catalog.jsonb_typeof(v_summary -> v_field) = 'number' then
      v_numeric := (v_summary ->> v_field)::numeric;
      if v_numeric < 0
        or (v_field = 'steps' and v_numeric <> pg_catalog.trunc(v_numeric))
      then
        raise exception using errcode = '22023', message = 'health_day_invalid_source';
      end if;
    end if;
  end loop;

  foreach v_field in array array['sleep_start', 'sleep_end'] loop
    if pg_catalog.jsonb_typeof(v_summary -> v_field) not in ('string', 'null') then
      raise exception using errcode = '22023', message = 'health_day_invalid_source';
    end if;
    if pg_catalog.jsonb_typeof(v_summary -> v_field) = 'string' then
      if (v_summary ->> v_field) !~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      then
        raise exception using errcode = '22023', message = 'health_day_invalid_source';
      end if;
      begin
        perform (v_summary ->> v_field)::timestamptz;
      exception when others then
        raise exception using errcode = '22023', message = 'health_day_invalid_source';
      end;
    end if;
  end loop;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || p_health_date::text, 0)
  );

  select row_value.* into v_existing
  from public.health_days as row_value
  where row_value.user_id = v_user_id
    and row_value.health_date = p_health_date
  for update;

  if not found then
    return query
      insert into public.health_days as row_value (
        user_id, health_date, summary, source_revision, revision
      ) values (
        v_user_id,
        p_health_date,
        v_summary,
        pg_catalog.to_char(
          p_generated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        ),
        1
      )
      returning 'created'::text,
        row_value.id,
        row_value.health_date,
        row_value.revision;
    return;
  end if;

  begin
    v_existing_generated_at := v_existing.source_revision::timestamptz;
  exception when others then
    raise exception using errcode = '40001', message = 'health_day_conflict';
  end;

  if p_generated_at < v_existing_generated_at then
    raise exception using errcode = '22023', message = 'health_day_stale_source';
  end if;
  if p_generated_at = v_existing_generated_at then
    if v_summary <> v_existing.summary then
      raise exception using errcode = '40001', message = 'health_day_conflict';
    end if;
    return query select 'unchanged'::text,
      v_existing.id, v_existing.health_date, v_existing.revision;
    return;
  end if;

  return query
    update public.health_days as row_value
    set summary = v_summary,
        source_revision = pg_catalog.to_char(
          p_generated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        ),
        revision = row_value.revision + 1,
        updated_at = pg_catalog.transaction_timestamp()
    where row_value.user_id = v_user_id
      and row_value.id = v_existing.id
    returning 'updated'::text,
      row_value.id, row_value.health_date, row_value.revision;
end
$$;

revoke all on function public.upsert_health_day_v1(date, timestamptz, jsonb) from public;
revoke all on function public.upsert_health_day_v1(date, timestamptz, jsonb) from anon;
grant execute on function public.upsert_health_day_v1(date, timestamptz, jsonb) to authenticated;
```

Keep the function `SECURITY INVOKER`; existing Owner RLS remains the enforcement layer for table access.

- [ ] **Step 5: Extend the hosted permission matrix**

In `apps/life-console/supabase/tests/hosted_permission_matrix.sql`, add checks that:

```sql
insert into life_console_permission_results
select
  'health_day_rpc_rights',
  count(*) = 1
    and bool_and(not p.prosecdef)
    and bool_and(p.proretset)
    and bool_and(p.proconfig @> array['search_path=""'])
    and pg_catalog.has_function_privilege(
      'authenticated',
      'public.upsert_health_day_v1(date,timestamptz,jsonb)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.upsert_health_day_v1(date,timestamptz,jsonb)',
      'EXECUTE'
    )
    and not exists (
      select 1
      from information_schema.routine_privileges as privilege
      where privilege.routine_schema = 'public'
        and privilege.routine_name = 'upsert_health_day_v1'
        and privilege.grantee = 'PUBLIC'
        and privilege.privilege_type = 'EXECUTE'
    )
from pg_catalog.pg_proc as p
join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'upsert_health_day_v1';

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  perform * from public.upsert_health_day_v1(
    (clock_timestamp() at time zone 'Asia/Shanghai')::date,
    clock_timestamp(),
    jsonb_build_object(
      'steps', 1,
      'active_energy', 1,
      'exercise_minutes', 1,
      'sleep_start', null,
      'sleep_end', null
    )
  );
  insert into life_console_permission_results
  values ('health_day_rpc_anon_denied', false);
exception when others then
  insert into life_console_permission_results
  values ('health_day_rpc_anon_denied', sqlstate = '42501');
end
$$;
reset role;
```

Do not add a hosted write using real Owner health data; this file remains a permission check.

- [ ] **Step 6: Run targeted migration tests until green**

```bash
npx vitest run tests/supabase/health-day-daily-sync-migration.test.ts
npx vitest run tests/supabase/life-console-250-migration.test.ts tests/supabase/life-console-250-rls.test.ts
```

Expected: PASS, with no table, column, index or existing RLS changes.

- [ ] **Step 7: Commit Task 2**

From the repository root:

```bash
git add apps/life-console/supabase/migrations apps/life-console/tests/supabase/health-day-daily-sync-migration.test.ts apps/life-console/supabase/tests/hosted_permission_matrix.sql
git commit -m "feat: add Owner-scoped health day sync RPC"
```

---

### Task 3: Add the redacted cloud adapter and `health-day` CLI

**Files:**
- Modify: `tools/life_console_cloud.py`
- Modify: `tools/test_life_console_cloud.py`

- [ ] **Step 1: Write failing `CloudClient` request/receipt tests**

Add a synthetic response and assert the exact PostgREST call:

```python
def test_health_day_write_uses_owner_rpc_and_returns_redacted_receipt(self):
    transport = FakeTransport([{
        "action": "created",
        "id": 17,
        "health_date": "2026-08-26",
        "revision": 1,
    }])
    client = CloudClient(transport, token_provider=lambda: "synthetic-token")
    parsed = {
        "health_date": "2026-08-26",
        "generated_at": "2026-08-26T13:30:00+08:00",
        "summary": {
            "steps": 4321,
            "active_energy": 210.5,
            "exercise_minutes": 18,
            "sleep_start": None,
            "sleep_end": None,
        },
    }

    receipt = client.upsert_health_day(parsed)

    self.assertEqual(
        transport.calls,
        [("POST", "/rest/v1/rpc/upsert_health_day_v1", {
            "p_health_date": "2026-08-26",
            "p_generated_at": "2026-08-26T13:30:00+08:00",
            "p_summary": parsed["summary"],
        }, "synthetic-token")],
    )
    self.assertEqual(receipt, {
        "status": "saved",
        "resource": "health_day",
        "action": "created",
        "date": "2026-08-26",
        "revision": 1,
    })
    self.assertNotIn("4321", json.dumps(receipt))
    self.assertNotIn("synthetic-token", json.dumps(receipt))
```

Also test that only `created`, `updated`, and `unchanged` actions are accepted, and a malformed RPC response maps to `CloudWriteError("unavailable")`.

- [ ] **Step 2: Write failing HTTP error and CLI tests**

Add tests for these exact mappings without echoing HTTP bodies:

```python
{
    "health_day_stale_source": "stale_source",
    "health_day_invalid_source": "invalid_source",
    "health_day_conflict": "conflict",
    "health_day_unauthenticated": "unauthenticated",
}
```

Patch `read_health_summary`, `_load_client`, stdout and stderr to verify:

```python
# valid --expect-today parses once and calls upsert_health_day once
# stale/missing/invalid source returns {"status":"invalid_source"} on stderr
# invalid source never loads the client and never sends a network request
# success emits only status/resource/action/date/revision
# every failure returns exit code 2 and one closed status
```

- [ ] **Step 3: Verify targeted tests fail before implementation**

```bash
PYTHONPATH=tools python3 -m unittest tools.test_life_console_cloud.LifeConsoleCloudTest.test_health_day_write_uses_owner_rpc_and_returns_redacted_receipt -v
```

Expected: FAIL because `CloudClient.upsert_health_day` is missing.

- [ ] **Step 4: Implement safe RPC error mapping**

In `HttpTransport.request`, read at most the structured PostgREST error response already returned by `HTTPError`, map only an exact known `message`, and discard everything else:

```python
HEALTH_RPC_ERROR_STATUS = {
    "health_day_stale_source": "stale_source",
    "health_day_invalid_source": "invalid_source",
    "health_day_conflict": "conflict",
    "health_day_unauthenticated": "unauthenticated",
}

def _closed_http_error_status(exc: error.HTTPError) -> str:
    if exc.code in (401, 403):
        return "unauthenticated"
    if exc.code == 409:
        return "conflict"
    try:
        payload = json.loads(exc.read())
    except (OSError, json.JSONDecodeError, TypeError):
        return "unavailable"
    message = payload.get("message") if isinstance(payload, dict) else None
    return HEALTH_RPC_ERROR_STATUS.get(message, "unavailable")
```

Raise only `CloudWriteError(_closed_http_error_status(exc))`; never include the response body or request payload in the exception.

- [ ] **Step 5: Implement `CloudClient.upsert_health_day`**

```python
def upsert_health_day(self, parsed: dict[str, Any]) -> dict[str, Any]:
    row = _first_row(self._request(
        "POST",
        "/rest/v1/rpc/upsert_health_day_v1",
        body={
            "p_health_date": parsed.get("health_date"),
            "p_generated_at": parsed.get("generated_at"),
            "p_summary": parsed.get("summary"),
        },
    ))
    action = row.get("action")
    health_date = row.get("health_date")
    revision = row.get("revision")
    if action not in {"created", "updated", "unchanged"}:
        raise CloudWriteError("unavailable")
    if not isinstance(health_date, str) or not isinstance(revision, int):
        raise CloudWriteError("unavailable")
    return {
        "status": "saved",
        "resource": "health_day",
        "action": action,
        "date": health_date,
        "revision": revision,
    }
```

- [ ] **Step 6: Implement the CLI without stdin or intermediate JSON**

Import `LOCAL_ZONE`, `HealthHistoryError`, and `read_health_summary`. Add a dedicated parser instead of including `health-day` in the JSON-input loop:

```python
health_day = subparsers.add_parser("health-day")
health_day.add_argument("--source", type=Path, required=True)
health_day.add_argument("--expect-today", action="store_true", required=True)
```

Route it before the generic `--input` reader:

```python
if args.command == "health-day":
    expected_date = datetime.now(LOCAL_ZONE).date().isoformat()
    parsed = read_health_summary(args.source, expected_date)
    receipt = client.upsert_health_day(parsed)
    print(json.dumps(receipt, ensure_ascii=False, sort_keys=True))
    return 0
```

Catch `HealthHistoryError` separately as `invalid_source`; keep existing `CloudWriteError` statuses unchanged. The CLI must never print `parsed`, the source path's contents, or an exception message containing a field value.

- [ ] **Step 7: Run all Python regressions**

```bash
PYTHONPATH=tools python3 -m unittest tools.test_apple_health_history tools.test_life_console_cloud -v
```

Expected: PASS; valid CLI calls the RPC once, invalid local input calls it zero times.

- [ ] **Step 8: Commit Task 3**

```bash
git add tools/life_console_cloud.py tools/test_life_console_cloud.py
git commit -m "feat: add redacted health day cloud sync command"
```

---

### Task 4: Add a testable daily-check-in Prompt contract without committing the private Prompt

**Files:**
- Create: `tools/validate_daily_health_sync_prompt.py`
- Create: `tools/test_daily_health_sync_prompt_contract.py`
- Later private rollout only: `automations/每日生活状态回访.prompt.txt`
- Later private rollout only: `automations/registry.json`

- [ ] **Step 1: Write failing synthetic Prompt contract tests**

Import `validate_prompt` from the new validator. Tests must use only synthetic Prompt strings:

```python
HEALTH_SYNC_COMMAND = (
    "PYTHONPATH=.:tools python3 tools/life_console_cloud.py health-day "
    "--source records/apple-health-latest.txt --expect-today"
)

valid_prompt = f"""先执行：
{HEALTH_SYNC_COMMAND}
只读取命令回执；不得在对话中展示设备健康数值。
若 status=saved（action=created、updated 或 unchanged），继续回访。
若失败，短提示“今日健康数据未同步”并继续回访；不得补历史或回退本地写入。
然后开始每日回访提问。
"""
```

Assert that validation rejects each mutation independently:

```python
def test_prompt_contract_rejects_each_missing_boundary(self):
    cases = {
        "command": valid_prompt.replace(HEALTH_SYNC_COMMAND, ""),
        "today": valid_prompt.replace("--expect-today", "--expect-date 2026-08-26"),
        "order": valid_prompt.replace(
            f"先执行：\n{HEALTH_SYNC_COMMAND}",
            f"开始每日回访提问。\n{HEALTH_SYNC_COMMAND}",
        ),
        "nonblocking": valid_prompt.replace("并继续回访", "并停止回访"),
        "history": valid_prompt.replace("不得补历史或回退本地写入", "允许补历史"),
        "privacy": valid_prompt.replace("不得在对话中展示设备健康数值", "展示设备健康数值"),
    }
    for label, prompt in cases.items():
        with self.subTest(label=label):
            self.assertTrue(validate_prompt(prompt))
```

- [ ] **Step 2: Verify Prompt contract tests fail**

```bash
PYTHONPATH=tools python3 -m unittest tools.test_daily_health_sync_prompt_contract -v
```

Expected: at least the new tests FAIL because the health-sync contract is not implemented.

- [ ] **Step 3: Implement the pure validation checks**

Create `tools/validate_daily_health_sync_prompt.py` with a pure validator and a content-free CLI receipt:

```python
#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

HEALTH_SYNC_COMMAND = (
    "PYTHONPATH=.:tools python3 tools/life_console_cloud.py health-day "
    "--source records/apple-health-latest.txt --expect-today"
)

def validate_prompt(prompt_text: str) -> list[str]:
    errors: list[str] = []
    command_position = prompt_text.find(HEALTH_SYNC_COMMAND)
    question_positions = [
        position for marker in ("开始每日回访提问", "逐项询问", "只问缺失字段")
        if (position := prompt_text.find(marker)) >= 0
    ]
    if command_position < 0:
        errors.append("每日回访缺少当天 Apple Health 同步命令")
    elif question_positions and command_position > min(question_positions):
        errors.append("Apple Health 同步必须发生在每日回访提问前")
    for pattern, label in (
        (r"今日健康数据未同步.{0,80}继续回访", "同步失败不得阻断回访"),
        (r"(?:不得|禁止|不进行).{0,40}(?:补历史|历史回填)", "禁止健康历史回填"),
        (r"(?:不得|禁止|不).{0,40}(?:展示|输出).{0,40}健康数值", "禁止展示设备健康数值"),
    ):
        if re.search(pattern, prompt_text, re.DOTALL) is None:
            errors.append(f"每日回访健康同步契约缺失：{label}")
    return errors

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="验证每日回访 Apple Health 同步契约")
    parser.add_argument("--prompt", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        prompt_text = args.prompt.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        print(json.dumps({"status": "unavailable"}), file=sys.stderr)
        return 2
    errors = validate_prompt(prompt_text)
    if errors:
        print(json.dumps({"status": "invalid", "errors": errors}, ensure_ascii=False), file=sys.stderr)
        return 2
    print(json.dumps({"status": "valid"}, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

Do not import this validator from the repository-wide `validate_project.py` yet: the private Prompt is deliberately unchanged until rollout approval, and that pending runtime change must not make an otherwise reviewable code PR permanently red.

- [ ] **Step 4: Run Prompt validator tests until green**

```bash
PYTHONPATH=tools python3 -m unittest tools.test_daily_health_sync_prompt_contract -v
```

Expected: PASS for the synthetic valid Prompt and a precise error for every invalid mutation.

- [ ] **Step 5: Commit Task 4**

```bash
git add tools/validate_daily_health_sync_prompt.py tools/test_daily_health_sync_prompt_contract.py
git commit -m "test: enforce daily health sync prompt contract"
```

---

### Task 5: Reconcile evidence, run implementation gates, and update Draft PR

**Files:**
- Modify: `docs/knowledge-base/生活助手-LifeConsole-2.5.0/设计补充-AppleHealth每日回访同步-生活助手-LifeConsole-2.5.0.md`

- [ ] **Step 1: Add an implementation evidence section**

Append a section recording only:

```markdown
## 9. Implementation evidence

- Parser/CLI: targeted Python tests passed; receipts contain no health values or credentials.
- Database: PGlite behavior and permission tests passed; migration only adds one function and grants.
- Prompt contract: synthetic validator tests passed; private Prompt remains gated and unmodified.
- Frontend: no source changes; the existing `health_days` reader remains the consumer.
- Release state: Draft PR only; Production migration, runtime update, real write and LaunchAgent unload not performed.
```

Include exact test counts and commit hashes only after the commands below have produced them. Do not include project IDs, Owner IDs, health values or automation IDs.

- [ ] **Step 2: Run targeted and full implementation tests**

From the repository root:

```bash
PYTHONPATH=tools python3 -m unittest tools.test_apple_health_history tools.test_life_console_cloud tools.test_daily_health_sync_prompt_contract -v
cd apps/life-console
npm test
npm run build
npm run build:supabase-production
```

Expected: Python, Vitest, contract generation and Production build PASS. Return to the repository root afterward.

- [ ] **Step 3: Run governance, privacy and diff gates that do not require runtime mutation**

```bash
cd ../..
python3 tools/check_project_governance.py
tools/check_git_privacy.sh
tools/check_git_privacy.sh --history origin/main..HEAD
git diff --check origin/main...HEAD
git status --short
```

Expected: governance, index/history privacy and diff checks PASS. The standalone Prompt contract is green against synthetic fixtures; the private Prompt itself remains unmodified and unclaimed until rollout. The private, repository-wide `python3 tools/validate_project.py` runs in Task 6 only after the approved Prompt update because an isolated Git worktree intentionally does not contain its ignored iCloud truth sources.

- [ ] **Step 4: Self-review the implementation against the approved spec**

Check every item explicitly:

```text
future-only; no historical path
exact five-field summary
local expected-today validation before network
auth.uid Owner scope and existing RLS
SECURITY INVOKER, empty search_path, authenticated-only grant
single-row idempotency and monotonic revision
older source rejected
redacted success and closed failure receipts
sync failure cannot block check-in
no frontend or Vercel change
private Prompt and real data still untouched
```

- [ ] **Step 5: Commit evidence and push the Draft PR branch**

```bash
git add docs/knowledge-base/生活助手-LifeConsole-2.5.0/设计补充-AppleHealth每日回访同步-生活助手-LifeConsole-2.5.0.md
git commit -m "docs: record health sync implementation evidence"
git push origin agent/life-console-health-sync-design
gh pr checks 76 --watch
```

Keep PR #76 Draft. Report test evidence and ask for PO implementation acceptance; do not apply the migration or update any automation yet.

---

### Task 6: Perform the separately approved Production rollout

**Files and systems:**
- Production Supabase migration history
- Private `automations/每日生活状态回访.prompt.txt`
- Private `automations/registry.json`
- Codex daily automation runtime
- Existing LaunchAgent labeled `local.life-assistant.apple-health-history`

This task is not part of implementation authorization. Stop before each marked gate and obtain the PO's explicit approval for the named operation.

- [ ] **Step 1: Gate A — obtain approval to merge the reviewed PR**

Require: Draft PR checks green, PO implementation acceptance, and explicit approval to mark ready and merge. After merge, verify `origin/main` contains the migration, CLI and tests. Do not interpret specification approval as merge approval.

- [ ] **Step 2: Gate B — obtain approval to apply the Production migration**

Before applying, use Supabase read-only inspection to confirm the migration is absent and `health_days` still has its existing columns/RLS. Apply only the exact reviewed migration through the Supabase migration workflow. Then run the hosted permission matrix and verify no historical `health_days` row count changed.

Acceptance evidence is limited to migration name, applied state, function rights, grants and unchanged historical row count; no row contents.

- [ ] **Step 3: Gate C — obtain approval to update the private formal Prompt and runtime automation**

In the primary iCloud workspace, insert this exact command before questions and sleep calibration:

```bash
PYTHONPATH=.:tools python3 tools/life_console_cloud.py health-day --source records/apple-health-latest.txt --expect-today
```

The Prompt must state:

```text
Read only the redacted receipt.
If status=saved, including action created, updated or unchanged, continue quietly.
On any failure, say only “今日健康数据未同步” and continue the check-in.
Never display device health values, retry a past date, backfill history or write a local fallback.
```

Recompute the exact Prompt SHA-256 in `automations/registry.json` while leaving name, 14:00 Asia/Shanghai schedule, target and status unchanged. Use the product's automation update capability to update only the existing task Prompt; do not create a second task. Read back the task and verify the hash/protected fields.

- [ ] **Step 4: Run the full private project validator after Prompt rollout**

```bash
python3 tools/validate_project.py
python3 tools/validate_daily_health_sync_prompt.py --prompt automations/每日生活状态回访.prompt.txt
python3 tools/life_assistant_status.py --write STATUS.md
```

Expected: the full project validator and standalone Prompt contract are green; automation registry hash and runtime Prompt match. Commit no private Prompt, registry, STATUS health values or runtime identifiers to Git.

- [ ] **Step 5: Gate D — obtain approval for one same-day real Owner write/readback**

Only if `records/apple-health-latest.txt` is valid for Shanghai today, run the exact `health-day --expect-today` command once. Read back only the Owner-scoped row's date, revision and the presence/nullness of the five keys. Report only the literal `status=saved`, `resource=health_day`, one returned action from the closed set `created`, `updated`, `unchanged`, the returned ISO date and returned revision. The report must omit values, Owner ID and row ID. If write or readback fails, report not saved and leave the old LaunchAgent intact.

- [ ] **Step 6: Gate E — after successful readback, unload the obsolete LaunchAgent**

Resolve the current UID read-only, verify the exact label `local.life-assistant.apple-health-history`, then unload only:

```bash
launchctl bootout "gui/$(id -u)/local.life-assistant.apple-health-history"
```

Verify the exact service label exists before execution, then verify it is absent from `launchctl print`. Preserve the plist, `apple-health-history.jsonl`, iCloud latest file and backups; do not delete or truncate any history.

- [ ] **Step 7: Observe the next natural daily run**

After the next 14:00 run, verify the automation completed, the same-day sync receipt is redacted, and the check-in still proceeded. The Life Console trend should gain future samples naturally; do not fabricate 14-day sufficiency or backfill missing dates.

- [ ] **Step 8: Close release evidence and clean the development branch**

Record the approved gates and redacted verification in the standalone design supplement. After merge and acceptance, follow `GIT_WORKFLOW.md` to remove the task worktree and delete the local/remote activity branch so only `main` remains idle.
