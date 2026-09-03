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
  v_generated_at timestamptz := pg_catalog.date_trunc('microseconds', p_generated_at);
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
    or v_generated_at is null
    or p_health_date <> v_today
    or (v_generated_at at time zone 'Asia/Shanghai')::date <> v_today
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
          v_generated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
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

  if v_generated_at < v_existing_generated_at then
    raise exception using errcode = '22023', message = 'health_day_stale_source';
  end if;
  if v_generated_at = v_existing_generated_at then
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
          v_generated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
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
