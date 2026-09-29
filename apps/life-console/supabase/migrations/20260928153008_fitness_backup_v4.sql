-- Business export includes fitness tombstones; credentials and private receipts remain database-backup only.
create or replace function public.export_life_console_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 4,
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
    ), '[]'::jsonb),
    'todo_items', coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.todo_items as row_value
      where row_value.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'todo_status_events', coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.todo_id, row_value.occurred_at, row_value.id)
      from public.todo_status_events as row_value
      where row_value.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'fitness_appointments', coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.start_at, row_value.id)
      from public.fitness_appointments as row_value
      where row_value.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'dashboard_messages', coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.week_start, row_value.id)
      from public.dashboard_messages as row_value
      where row_value.user_id = (select auth.uid())
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.export_life_console_snapshot() from public;
revoke all on function public.export_life_console_snapshot() from anon;
grant execute on function public.export_life_console_snapshot() to authenticated;
