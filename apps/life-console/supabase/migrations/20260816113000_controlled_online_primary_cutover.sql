-- Fail-closed, Owner-scoped Life Console 2.3.0 data cutover.

create function public.cutover_life_console_230(
  p_run_id uuid,
  p_manifest_digest text,
  p_journals jsonb,
  p_daily_checkins jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_duplicate_groups integer;
  v_redundant_count integer;
  v_min_copies integer;
  v_max_copies integer;
  v_min_tracked integer;
  v_max_tracked integer;
  v_target_goals integer;
  v_redundant_ids bigint[];
  v_changed integer;
  v_item jsonb;
  v_id bigint;
  v_inserted_journals integer := 0;
  v_inserted_daily integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_manifest_digest !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_journals) <> 'array'
     or jsonb_array_length(p_journals) <> 3
     or jsonb_typeof(p_daily_checkins) <> 'array'
     or jsonb_array_length(p_daily_checkins) <> 1 then
    raise exception using errcode = '22023', message = 'Cutover manifest invalid';
  end if;

  if (select count(*) from public.journals where user_id = v_user_id) <> 31
     or (select count(*) from public.daily_checkins where user_id = v_user_id) <> 14
     or (select count(*) from public.goals where user_id = v_user_id) <> 6
     or (select count(*) from public.weekly_reviews where user_id = v_user_id) <> 1
     or (select count(*) from public.phase_reviews where user_id = v_user_id) <> 1
     or (select count(*) from public.health_days where user_id = v_user_id) <> 8 then
    raise exception using errcode = 'P0001', message = 'Cutover preflight counts changed';
  end if;

  with duplicate_groups as (
    select user_id, event_date, title, content, tags, deleted_at,
           count(*)::integer as copies
    from public.journals
    where user_id = v_user_id
    group by user_id, event_date, title, content, tags, deleted_at
    having count(*) > 1
  ), grouped as (
    select g.copies, count(mi.id)::integer as tracked
    from duplicate_groups g
    join public.journals j
      on j.user_id = g.user_id and j.event_date = g.event_date
     and j.title is not distinct from g.title
     and j.content = g.content and j.tags = g.tags
     and j.deleted_at is not distinct from g.deleted_at
    left join public.migration_imports mi
      on mi.table_name = 'journals' and mi.imported_id = j.id
    group by g.user_id, g.event_date, g.title, g.content, g.tags,
             g.deleted_at, g.copies
  )
  select count(*)::integer, coalesce(sum(copies - 1), 0)::integer,
         min(copies), max(copies), min(tracked), max(tracked)
    into v_duplicate_groups, v_redundant_count, v_min_copies,
         v_max_copies, v_min_tracked, v_max_tracked
  from grouped;

  if v_duplicate_groups <> 10 or v_redundant_count <> 20
     or v_min_copies <> 3 or v_max_copies <> 3
     or v_min_tracked <> 1 or v_max_tracked <> 1 then
    raise exception using errcode = 'P0001', message = 'Duplicate groups changed';
  end if;

  select count(*)::integer into v_target_goals
  from public.goals g
  where g.user_id = v_user_id and g.status = 'archived'
    and g.deleted_at is not null
    and not exists (
      select 1 from public.migration_imports mi
      where mi.table_name = 'goals' and mi.imported_id = g.id
    );
  if v_target_goals <> 1 then
    raise exception using errcode = 'P0001', message = 'Target goal changed';
  end if;

  with duplicate_groups as (
    select user_id, event_date, title, content, tags, deleted_at
    from public.journals
    where user_id = v_user_id
    group by user_id, event_date, title, content, tags, deleted_at
    having count(*) = 3
  )
  select array_agg(j.id order by j.id) into v_redundant_ids
  from duplicate_groups g
  join public.journals j
    on j.user_id = g.user_id and j.event_date = g.event_date
   and j.title is not distinct from g.title
   and j.content = g.content and j.tags = g.tags
   and j.deleted_at is not distinct from g.deleted_at
  where not exists (
    select 1 from public.migration_imports mi
    where mi.table_name = 'journals' and mi.imported_id = j.id
  );
  if coalesce(array_length(v_redundant_ids, 1), 0) <> 20 then
    raise exception using errcode = 'P0001', message = 'Redundant journal set changed';
  end if;

  delete from public.journal_revisions
  where user_id = v_user_id and journal_id = any(v_redundant_ids);
  get diagnostics v_changed = row_count;
  if v_changed <> 20 then
    raise exception using errcode = 'P0001', message = 'Redundant revisions changed';
  end if;
  delete from public.journals
  where user_id = v_user_id and id = any(v_redundant_ids);
  get diagnostics v_changed = row_count;
  if v_changed <> 20 then
    raise exception using errcode = 'P0001', message = 'Redundant journals changed';
  end if;

  delete from public.goals
  where user_id = v_user_id and status = 'archived' and deleted_at is not null
    and not exists (
      select 1 from public.migration_imports mi
      where mi.table_name = 'goals' and mi.imported_id = goals.id
    );
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception using errcode = 'P0001', message = 'Target goal changed';
  end if;

  insert into public.migration_runs (
    id, manifest_digest, status, started_at
  ) values (p_run_id, p_manifest_digest, 'running', now());

  for v_item in select value from jsonb_array_elements(p_journals)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or (v_item - array[
         'record_key','event_date','title','content','tags','metadata',
         'created_at','updated_at'
       ]::text[]) <> '{}'::jsonb
       or jsonb_typeof(v_item->'metadata') <> 'object'
       or jsonb_typeof(v_item->'tags') <> 'array'
       or coalesce(char_length(v_item->>'record_key'), 0) not between 8 and 200
       or coalesce(char_length(v_item->>'content'), 0) not between 1 and 100000 then
      raise exception using errcode = '22023', message = 'Journal delta invalid';
    end if;
    insert into public.journals (
      user_id, record_key, event_date, title, content, tags, metadata,
      revision, created_at, updated_at
    ) values (
      v_user_id,
      v_item->>'record_key',
      (v_item->>'event_date')::date,
      nullif(v_item->>'title', ''),
      v_item->>'content',
      array(select jsonb_array_elements_text(v_item->'tags')),
      v_item->'metadata',
      1,
      (v_item->>'created_at')::timestamptz,
      (v_item->>'updated_at')::timestamptz
    ) returning id into v_id;
    insert into public.migration_imports (
      migration_run_id, table_name, source_stable_id, imported_id
    ) values (p_run_id, 'journals', v_item->>'record_key', v_id);
    v_inserted_journals := v_inserted_journals + 1;
  end loop;

  for v_item in select value from jsonb_array_elements(p_daily_checkins)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or (v_item - array[
         'source_stable_id','checkin_date','sleep_quality','energy','mood',
         'life_feeling','sleep_time','wake_time','out_of_bed_time',
         'awake_in_bed','anchors','notes','created_at','updated_at'
       ]::text[]) <> '{}'::jsonb
       or coalesce(char_length(v_item->>'source_stable_id'), 0) not between 8 and 200 then
      raise exception using errcode = '22023', message = 'Daily delta invalid';
    end if;
    insert into public.daily_checkins (
      user_id, checkin_date, sleep_quality, energy, mood, life_feeling,
      sleep_time, wake_time, out_of_bed_time, awake_in_bed,
      anchors, notes, revision, created_at, updated_at
    ) values (
      v_user_id,
      (v_item->>'checkin_date')::date,
      nullif(v_item->>'sleep_quality', '')::smallint,
      nullif(v_item->>'energy', '')::smallint,
      nullif(v_item->>'mood', '')::smallint,
      nullif(v_item->>'life_feeling', '')::smallint,
      nullif(v_item->>'sleep_time', ''),
      nullif(v_item->>'wake_time', ''),
      nullif(v_item->>'out_of_bed_time', ''),
      nullif(v_item->>'awake_in_bed', ''),
      v_item->'anchors',
      nullif(v_item->>'notes', ''),
      1,
      (v_item->>'created_at')::timestamptz,
      (v_item->>'updated_at')::timestamptz
    ) returning id into v_id;
    insert into public.migration_imports (
      migration_run_id, table_name, source_stable_id, imported_id
    ) values (p_run_id, 'daily_checkins', v_item->>'source_stable_id', v_id);
    v_inserted_daily := v_inserted_daily + 1;
  end loop;

  if v_inserted_journals <> 3 or v_inserted_daily <> 1
     or (select count(*) from public.journals where user_id = v_user_id) <> 14
     or (select count(*) from public.daily_checkins where user_id = v_user_id) <> 15
     or (select count(*) from public.goals where user_id = v_user_id) <> 5
     or (select count(*) from public.weekly_reviews where user_id = v_user_id) <> 1
     or (select count(*) from public.phase_reviews where user_id = v_user_id) <> 1
     or (select count(*) from public.health_days where user_id = v_user_id) <> 8 then
    raise exception using errcode = 'P0001', message = 'Cutover final counts invalid';
  end if;

  update public.migration_runs
  set status = 'completed', completed_at = now()
  where id = p_run_id;

  return jsonb_build_object(
    'status', 'completed',
    'removed_journals', 20,
    'removed_goals', 1,
    'inserted_journals', v_inserted_journals,
    'inserted_daily_checkins', v_inserted_daily,
    'final_counts', jsonb_build_object(
      'journals', 14, 'daily_checkins', 15, 'goals', 5,
      'weekly_reviews', 1, 'phase_reviews', 1, 'health_days', 8
    )
  );
end
$$;

revoke all on function public.cutover_life_console_230(uuid, text, jsonb, jsonb)
  from public;
grant execute on function public.cutover_life_console_230(uuid, text, jsonb, jsonb)
  to authenticated;
