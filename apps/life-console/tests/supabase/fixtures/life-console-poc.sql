-- Life Console 2.2.0 Supabase feasibility fixture.
-- This is synthetic test input, not a production migration.

create role anon nologin;
create role authenticated nologin;

create schema auth;
create table auth.users (
  id uuid primary key
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table public.journals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  event_date date not null,
  title text,
  content text not null,
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index journals_user_date_idx
on public.journals (user_id, event_date desc, id desc);

alter table public.journals enable row level security;
grant select, insert, update on public.journals to authenticated;
grant usage, select on sequence public.journals_id_seq to authenticated;

create policy journals_select
on public.journals for select to authenticated
using ((select auth.uid()) = user_id);

create policy journals_insert
on public.journals for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy journals_update
on public.journals for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create table public.daily_checkins (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  checkin_date date not null,
  sleep_quality smallint check (sleep_quality between 1 and 5),
  energy smallint check (energy between 1 and 5),
  mood smallint check (mood between 1 and 5),
  life_feeling smallint check (life_feeling between 1 and 5),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);

create index daily_checkins_user_date_idx
on public.daily_checkins (user_id, checkin_date desc, id desc);

alter table public.daily_checkins enable row level security;
grant select, insert, update on public.daily_checkins to authenticated;
grant usage, select on sequence public.daily_checkins_id_seq to authenticated;

create policy daily_checkins_select
on public.daily_checkins for select to authenticated
using ((select auth.uid()) = user_id);

create policy daily_checkins_insert
on public.daily_checkins for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy daily_checkins_update
on public.daily_checkins for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create view public.journal_feed
with (security_invoker = true)
as
select id, user_id, event_date, title, revision
from public.journals
where deleted_at is null;

grant select on public.journal_feed to authenticated;

create function public.export_life_console_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'journals', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'event_date', event_date,
            'title', title,
            'content', content,
            'revision', revision
          ) order by event_date, id
        )
        from public.journals
        where user_id = (select auth.uid())
      ),
      '[]'::jsonb
    ),
    'daily_checkins', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'checkin_date', checkin_date,
            'sleep_quality', sleep_quality,
            'energy', energy,
            'mood', mood,
            'life_feeling', life_feeling,
            'revision', revision
          ) order by checkin_date, id
        )
        from public.daily_checkins
        where user_id = (select auth.uid())
      ),
      '[]'::jsonb
    )
  )
$$;

revoke all on function public.export_life_console_snapshot() from public;
grant execute on function public.export_life_console_snapshot() to authenticated;
