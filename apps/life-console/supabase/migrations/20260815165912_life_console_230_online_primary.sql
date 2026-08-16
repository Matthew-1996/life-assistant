-- Life Console 2.3.0: Supabase is the sole source of truth for business records.
-- Existing rows receive stable legacy keys; new clients may supply stable keys
-- while the legacy 2.2.0 RPCs remain available during the zero-downtime deploy.

alter table public.goals
  add column record_key text;
alter table public.journals
  add column record_key text,
  add column metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object');
alter table public.weekly_reviews
  add column record_key text,
  add column structured_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(structured_data) = 'object');
alter table public.phase_reviews
  add column record_key text,
  add column structured_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(structured_data) = 'object');

update public.goals set record_key = 'legacy:goal:' || id::text;
alter table public.journals disable trigger journals_record_revision;
update public.journals set record_key = 'legacy:journal:' || id::text;
alter table public.journals enable trigger journals_record_revision;
update public.weekly_reviews set record_key = 'weekly:' || week_start::text;
update public.phase_reviews
set record_key = 'phase:' || period_start::text || ':' || period_end::text;

alter table public.goals
  alter column record_key set default ('online:goal:' || gen_random_uuid()::text),
  alter column record_key set not null,
  add constraint goals_record_key_length
    check (char_length(record_key) between 8 and 200);
alter table public.journals
  alter column record_key set default ('online:journal:' || gen_random_uuid()::text),
  alter column record_key set not null,
  add constraint journals_record_key_length
    check (char_length(record_key) between 8 and 200);
alter table public.weekly_reviews
  alter column record_key set default ('online:weekly:' || gen_random_uuid()::text),
  alter column record_key set not null,
  add constraint weekly_reviews_record_key_length
    check (char_length(record_key) between 8 and 200);
alter table public.phase_reviews
  alter column record_key set default ('online:phase:' || gen_random_uuid()::text),
  alter column record_key set not null,
  add constraint phase_reviews_record_key_length
    check (char_length(record_key) between 8 and 200);

create unique index goals_user_record_key_uidx
  on public.goals (user_id, record_key);
create unique index journals_user_record_key_uidx
  on public.journals (user_id, record_key);
create unique index weekly_reviews_user_record_key_uidx
  on public.weekly_reviews (user_id, record_key);
create unique index phase_reviews_user_record_key_uidx
  on public.phase_reviews (user_id, record_key);
create unique index migration_imports_source_uidx
  on public.migration_imports (table_name, source_stable_id);

alter table public.daily_checkins
  add column sleep_time text,
  add column wake_time text,
  add column out_of_bed_time text,
  add column awake_in_bed text,
  add constraint daily_checkins_sleep_time_format check (
    sleep_time is null or sleep_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ),
  add constraint daily_checkins_wake_time_format check (
    wake_time is null or wake_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ),
  add constraint daily_checkins_out_of_bed_time_format check (
    out_of_bed_time is null
    or out_of_bed_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ),
  add constraint daily_checkins_awake_in_bed_values check (
    awake_in_bed is null or awake_in_bed in ('yes', 'no')
  );

create or replace function public.record_journal_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.revision <> 1 then
      raise exception using
        errcode = '22023',
        message = 'A journal must begin at revision 1';
    end if;
  elsif new.revision <> old.revision + 1 then
    raise exception using
      errcode = '22023',
      message = 'A journal update must increment revision by one';
  end if;

  insert into public.journal_revisions (
    user_id, journal_id, revision, snapshot, reason
  ) values (
    new.user_id,
    new.id,
    new.revision,
    to_jsonb(new) - 'user_id',
    case when tg_op = 'INSERT' then 'create' else 'update' end
  );
  return new;
end
$$;

revoke all on function public.record_journal_revision() from public;

create or replace function public.export_life_console_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 2,
    'exported_at', transaction_timestamp(),
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.user_id)
      from public.profiles as row_value
      where row_value.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.goals as row_value
      where row_value.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'journals', coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.event_date, row_value.id)
      from public.journals as row_value
      where row_value.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'journal_revisions', coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.journal_id, row_value.revision)
      from public.journal_revisions as row_value
      where row_value.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'daily_checkins', coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.checkin_date, row_value.id)
      from public.daily_checkins as row_value
      where row_value.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'weekly_reviews', coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.week_start, row_value.id)
      from public.weekly_reviews as row_value
      where row_value.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'phase_reviews', coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.period_start, row_value.id)
      from public.phase_reviews as row_value
      where row_value.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'health_days', coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.health_date, row_value.id)
      from public.health_days as row_value
      where row_value.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'health_segments', coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.start_at, row_value.id)
      from public.health_segments as row_value
      where row_value.user_id = (select auth.uid())
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.export_life_console_snapshot() from public;
grant execute on function public.export_life_console_snapshot() to authenticated;
