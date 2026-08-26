-- Hosted-only, synthetic-only permission matrix for Production validation.
-- Preconditions:
--   * 0001-0004 migrations are applied.
--   * The Dashboard-created Production Owner is the only persistent Auth user.
-- The transaction creates non-login synthetic placeholders, always rolls back
-- all test writes, and returns booleans only.

begin;

do $$
declare
  v_owner_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (
      v_owner_a,
      'life-console-a-' || replace(v_owner_a::text, '-', '')
        || '@example.invalid',
      '{"life_console_synthetic_owner":"A"}'::jsonb
    ),
    (
      v_owner_b,
      'life-console-b-' || replace(v_owner_b::text, '-', '')
        || '@example.invalid',
      '{"life_console_synthetic_owner":"B"}'::jsonb
    );

  insert into public.profiles (user_id, display_name)
  values
    (v_owner_a, 'Synthetic Owner A'),
    (v_owner_b, 'Synthetic Owner B');

  insert into public.goals (user_id, title, domain, status, priority)
  values
    (v_owner_a, 'Synthetic Goal Alpha', 'test', 'active', 1),
    (v_owner_b, 'Synthetic Goal Beta', 'test', 'active', 1);
end
$$;

select set_config(
  'life_console.owner_a',
  (
    select id::text
    from auth.users
    where raw_user_meta_data ->> 'life_console_synthetic_owner' = 'A'
  ),
  true
);
select set_config(
  'life_console.owner_b',
  (
    select id::text
    from auth.users
    where raw_user_meta_data ->> 'life_console_synthetic_owner' = 'B'
  ),
  true
);

do $$
begin
  if current_setting('life_console.owner_a', true) is null
    or current_setting('life_console.owner_b', true) is null
    or current_setting('life_console.owner_a')
      = current_setting('life_console.owner_b')
  then
    raise exception using
      errcode = '22023',
      message = 'Hosted permission matrix requires two distinct tagged users';
  end if;
end
$$;

create temporary table life_console_permission_results (
  item text primary key,
  passed boolean not null
) on commit drop;
grant select, insert on life_console_permission_results to anon, authenticated;

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

do $$
begin
  perform id from public.goals limit 1;
  insert into life_console_permission_results values ('anon_read_denied', false);
exception when others then
  insert into life_console_permission_results
  values ('anon_read_denied', sqlstate = '42501');
end
$$;

do $$
begin
  insert into public.goals (user_id, title)
  values (
    current_setting('life_console.owner_a')::uuid,
    'Synthetic anonymous write'
  );
  insert into life_console_permission_results values ('anon_write_denied', false);
exception when others then
  insert into life_console_permission_results
  values ('anon_write_denied', sqlstate = '42501');
end
$$;

do $$
begin
  perform * from public.export_life_console_snapshot();
  insert into life_console_permission_results
  values ('authenticated_only_rpc', false);
exception when others then
  insert into life_console_permission_results
  values ('authenticated_only_rpc', sqlstate = '42501');
end
$$;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  current_setting('life_console.owner_a'),
  true
);

insert into life_console_permission_results
select
  'owner_reads_only_own_rows',
  count(*) = 1
    and bool_and(title = 'Synthetic Goal Alpha')
from public.goals;

do $$
begin
  insert into public.goals (user_id, title)
  values (
    current_setting('life_console.owner_b')::uuid,
    'Synthetic cross-owner insert'
  );
  insert into life_console_permission_results
  values ('cross_owner_insert_denied', false);
exception when others then
  insert into life_console_permission_results
  values ('cross_owner_insert_denied', sqlstate = '42501');
end
$$;

do $$
begin
  update public.goals
  set user_id = current_setting('life_console.owner_b')::uuid
  where title = 'Synthetic Goal Alpha';
  insert into life_console_permission_results
  values ('user_id_rebind_denied', false);
exception when others then
  insert into life_console_permission_results
  values ('user_id_rebind_denied', sqlstate = '42501');
end
$$;

do $$
begin
  delete from public.goals where title = 'Synthetic Goal Alpha';
  insert into life_console_permission_results
  values ('physical_delete_denied', false);
exception when others then
  insert into life_console_permission_results
  values ('physical_delete_denied', sqlstate = '42501');
end
$$;

with changed as (
  update public.goals
  set title = title, revision = revision + 1
  where title = 'Synthetic Goal Alpha' and revision = 999
  returning id
)
insert into life_console_permission_results
select 'revision_conflict_detectable', count(*) = 0 from changed;

insert into life_console_permission_results
with first_call as materialized (
  select id from public.create_goal(
    'hosted-matrix-idempotency-0001',
    'Synthetic Matrix Goal',
    'test',
    'active',
    1::smallint,
    null::date,
    null::date
  )
), second_call as materialized (
  select id from public.create_goal(
    'hosted-matrix-idempotency-0001',
    'Synthetic Matrix Goal',
    'test',
    'active',
    1::smallint,
    null::date,
    null::date
  )
), combined as (
  select id from first_call
  union all
  select id from second_call
)
select
  'idempotent_create',
  count(*) = 2 and count(distinct id) = 1
from combined;

do $$
begin
  perform id from public.create_journal(
    'hosted-matrix-journal-0001',
    date '2030-02-01',
    'Synthetic Matrix Journal',
    'synthetic matrix payload',
    array['synthetic']
  );
end
$$;

insert into life_console_permission_results
select
  'journal_revision_trigger',
  count(*) = 1
from public.journal_revisions as revisions
join public.journals as journals on journals.id = revisions.journal_id
where journals.title = 'Synthetic Matrix Journal';

insert into life_console_permission_results
with snapshot as materialized (
  select public.export_life_console_snapshot() as value
), arrays as (
  select entry.key, entry.value
  from snapshot, lateral jsonb_each(snapshot.value) as entry
  where entry.key in (
    'profiles', 'goals', 'journals', 'journal_revisions',
    'daily_checkins', 'weekly_reviews', 'phase_reviews',
    'health_days', 'health_segments', 'backup_runs'
  )
)
select
  'export_rpc_isolated',
  bool_and(not exists (
    select 1
    from jsonb_array_elements(arrays.value) as row_value
    where row_value ->> 'user_id'
      <> current_setting('life_console.owner_a')
  ))
from arrays;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  current_setting('life_console.owner_b'),
  true
);

insert into life_console_permission_results
select
  'non_owner_cannot_see_owner_rows',
  count(*) = 0
from public.goals
where title = 'Synthetic Goal Alpha';

reset role;

insert into life_console_permission_results
select
  'grant_rls_index_trigger_integrity',
  (
    select count(*) = 12 and bool_and(c.relrowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (
        'profiles', 'goals', 'journals', 'journal_revisions',
        'daily_checkins', 'weekly_reviews', 'phase_reviews',
        'health_days', 'health_segments', 'idempotency_keys',
        'backup_runs', 'audit_events'
      )
  )
  and not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and privilege_type = 'DELETE'
  )
  and not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'
  )
  and (
    select count(*) = 14
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'profiles_user_id_idx', 'goals_user_status_idx',
        'goals_user_created_idx', 'journals_user_event_idx',
        'journal_revisions_user_journal_idx',
        'daily_checkins_user_date_idx',
        'weekly_reviews_user_week_idx',
        'phase_reviews_user_period_idx',
        'health_days_user_date_idx',
        'health_segments_user_day_idx',
        'health_segments_health_day_id_idx',
        'idempotency_keys_user_expiry_idx',
        'backup_runs_user_created_idx',
        'audit_events_user_created_idx'
      )
  )
  and exists (
    select 1 from pg_trigger
    where tgname = 'journals_record_revision' and tgenabled <> 'D'
  );

select jsonb_object_agg(item, passed order by item) as permission_matrix
from life_console_permission_results;

rollback;
