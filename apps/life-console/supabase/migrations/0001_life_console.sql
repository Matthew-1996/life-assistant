-- Life Console 2.2.0 initial Supabase schema.
-- Supabase provides auth.users, auth.uid(), anon, and authenticated.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text check (char_length(display_name) <= 80),
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.goals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 200),
  domain text,
  status text not null default 'active'
    check (status in ('draft', 'active', 'completed', 'archived')),
  priority smallint check (priority between 0 and 9),
  start_date date,
  target_date date,
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_date is null or start_date is null or target_date >= start_date)
);

create table public.journals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  event_date date not null,
  title text check (char_length(title) <= 200),
  content text not null check (char_length(content) <= 100000),
  tags text[] not null default '{}',
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.journal_revisions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  journal_id bigint not null references public.journals(id) on delete restrict,
  revision bigint not null check (revision > 0),
  snapshot jsonb not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (journal_id, revision)
);

create table public.daily_checkins (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  checkin_date date not null,
  sleep_quality smallint check (sleep_quality between 1 and 5),
  energy smallint check (energy between 1 and 5),
  mood smallint check (mood between 1 and 5),
  life_feeling smallint check (life_feeling between 1 and 5),
  anchors jsonb check (
    anchors is null
    or (
      jsonb_typeof(anchors) = 'object'
      and (
        anchors - array[
          'wake',
          'body_light',
          'life_action',
          'wind_down'
        ]::text[]
      ) = '{}'::jsonb
      and (
        not anchors ? 'wake'
        or (
          jsonb_typeof(anchors -> 'wake') = 'string'
          and anchors ->> 'wake' in ('complete', 'minimum', 'skipped')
        )
      )
      and (
        not anchors ? 'body_light'
        or (
          jsonb_typeof(anchors -> 'body_light') = 'string'
          and anchors ->> 'body_light' in (
            'complete',
            'minimum',
            'skipped'
          )
        )
      )
      and (
        not anchors ? 'life_action'
        or (
          jsonb_typeof(anchors -> 'life_action') = 'string'
          and anchors ->> 'life_action' in (
            'complete',
            'minimum',
            'skipped'
          )
        )
      )
      and (
        not anchors ? 'wind_down'
        or (
          jsonb_typeof(anchors -> 'wind_down') = 'string'
          and anchors ->> 'wind_down' in (
            'complete',
            'minimum',
            'skipped'
          )
        )
      )
    )
  ),
  notes text check (notes is null or char_length(notes) <= 160),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);

create table public.weekly_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  week_start date not null,
  content text not null,
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create table public.phase_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  content text not null,
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table public.health_days (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  health_date date not null,
  summary jsonb not null default '{}',
  source_revision text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, health_date)
);

create table public.health_segments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  health_day_id bigint not null references public.health_days(id) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz not null,
  source text,
  details jsonb,
  created_at timestamptz not null default now(),
  check (end_at > start_at),
  check (end_at <= start_at + interval '18 hours')
);

create table public.idempotency_keys (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  key text not null check (char_length(key) between 16 and 200),
  operation text not null,
  result_ref jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, key)
);

create table public.backup_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null
    check (status in ('pending', 'success', 'failed')),
  manifest_version integer not null check (manifest_version > 0),
  record_counts jsonb not null default '{}',
  content_digest text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id text,
  result text not null,
  created_at timestamptz not null default now()
);

create index profiles_user_id_idx
  on public.profiles (user_id);
create index goals_user_status_idx
  on public.goals (user_id, status, id desc);
create index goals_user_created_idx
  on public.goals (user_id, created_at desc, id desc);
create index journals_user_event_idx
  on public.journals (user_id, event_date desc, id desc);
create index journal_revisions_user_journal_idx
  on public.journal_revisions (user_id, journal_id, revision desc);
create index daily_checkins_user_date_idx
  on public.daily_checkins (user_id, checkin_date desc, id desc);
create index weekly_reviews_user_week_idx
  on public.weekly_reviews (user_id, week_start desc, id desc);
create index phase_reviews_user_period_idx
  on public.phase_reviews (user_id, period_start desc, id desc);
create index health_days_user_date_idx
  on public.health_days (user_id, health_date desc, id desc);
create index health_segments_user_day_idx
  on public.health_segments (user_id, health_day_id, start_at, id);
create index idempotency_keys_user_expiry_idx
  on public.idempotency_keys (user_id, expires_at, id);
create index backup_runs_user_created_idx
  on public.backup_runs (user_id, created_at desc, id desc);
create index audit_events_user_created_idx
  on public.audit_events (user_id, created_at desc, id desc);

alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.journals enable row level security;
alter table public.journal_revisions enable row level security;
alter table public.daily_checkins enable row level security;
alter table public.weekly_reviews enable row level security;
alter table public.phase_reviews enable row level security;
alter table public.health_days enable row level security;
alter table public.health_segments enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.backup_runs enable row level security;
alter table public.audit_events enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.goals to authenticated;
grant select, insert, update on public.journals to authenticated;
grant select on public.journal_revisions to authenticated;
grant select, insert, update on public.daily_checkins to authenticated;
grant select, insert, update on public.weekly_reviews to authenticated;
grant select, insert, update on public.phase_reviews to authenticated;
grant select, insert, update on public.health_days to authenticated;
grant select, insert on public.health_segments to authenticated;
grant select, insert on public.idempotency_keys to authenticated;
grant select, insert, update on public.backup_runs to authenticated;
grant select, insert on public.audit_events to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy profiles_insert on public.profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy profiles_update on public.profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy goals_select on public.goals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy goals_insert on public.goals
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy goals_update on public.goals
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy journals_select on public.journals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy journals_insert on public.journals
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy journals_update on public.journals
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy journal_revisions_select on public.journal_revisions
  for select to authenticated using ((select auth.uid()) = user_id);

create policy daily_checkins_select on public.daily_checkins
  for select to authenticated using ((select auth.uid()) = user_id);
create policy daily_checkins_insert on public.daily_checkins
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy daily_checkins_update on public.daily_checkins
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy weekly_reviews_select on public.weekly_reviews
  for select to authenticated using ((select auth.uid()) = user_id);
create policy weekly_reviews_insert on public.weekly_reviews
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy weekly_reviews_update on public.weekly_reviews
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy phase_reviews_select on public.phase_reviews
  for select to authenticated using ((select auth.uid()) = user_id);
create policy phase_reviews_insert on public.phase_reviews
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy phase_reviews_update on public.phase_reviews
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy health_days_select on public.health_days
  for select to authenticated using ((select auth.uid()) = user_id);
create policy health_days_insert on public.health_days
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy health_days_update on public.health_days
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy health_segments_select on public.health_segments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy health_segments_insert on public.health_segments
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.health_days
      where health_days.id = health_day_id
        and health_days.user_id = (select auth.uid())
    )
  );

create policy idempotency_keys_select on public.idempotency_keys
  for select to authenticated using ((select auth.uid()) = user_id);
create policy idempotency_keys_insert on public.idempotency_keys
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy backup_runs_select on public.backup_runs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy backup_runs_insert on public.backup_runs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy backup_runs_update on public.backup_runs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy audit_events_select on public.audit_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy audit_events_insert on public.audit_events
  for insert to authenticated with check ((select auth.uid()) = user_id);

create function public.record_journal_revision()
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
    user_id,
    journal_id,
    revision,
    snapshot,
    reason
  ) values (
    new.user_id,
    new.id,
    new.revision,
    jsonb_build_object(
      'event_date', new.event_date,
      'title', new.title,
      'content', new.content,
      'tags', new.tags,
      'deleted_at', new.deleted_at
    ),
    case when tg_op = 'INSERT' then 'create' else 'update' end
  );

  return new;
end
$$;

revoke all on function public.record_journal_revision() from public;

create trigger journals_record_revision
after insert or update on public.journals
for each row execute function public.record_journal_revision();

create function public.create_journal(
  p_idempotency_key text,
  p_event_date date,
  p_title text,
  p_content text,
  p_tags text[]
)
returns setof public.journals
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_tags text[] := coalesce(p_tags, '{}'::text[]);
  v_fingerprint text;
  v_existing_operation text;
  v_existing_result jsonb;
  v_journal public.journals%rowtype;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'event_date', p_event_date,
    'title', p_title,
    'content', p_content,
    'tags', v_tags
  )::text);

  select operation, result_ref
  into v_existing_operation, v_existing_result
  from public.idempotency_keys
  where user_id = v_user_id
    and key = p_idempotency_key;

  if found then
    if v_existing_operation <> 'journal.create'
      or v_existing_result ->> 'request_fingerprint' <> v_fingerprint
    then
      raise exception using
        errcode = '22023',
        message = 'Idempotency key was reused with a different request';
    end if;

    return query
      select row_value.*
      from public.journals as row_value
      where row_value.user_id = v_user_id
        and row_value.id = (v_existing_result ->> 'id')::bigint;
    return;
  end if;

  begin
    insert into public.journals (
      user_id,
      event_date,
      title,
      content,
      tags
    ) values (
      v_user_id,
      p_event_date,
      p_title,
      p_content,
      v_tags
    )
    returning * into v_journal;

    insert into public.idempotency_keys (
      user_id,
      key,
      operation,
      result_ref,
      expires_at
    ) values (
      v_user_id,
      p_idempotency_key,
      'journal.create',
      jsonb_build_object(
        'entity_type', 'journal',
        'id', v_journal.id,
        'request_fingerprint', v_fingerprint
      ),
      transaction_timestamp() + interval '24 hours'
    );

    insert into public.audit_events (
      user_id,
      action,
      entity_type,
      entity_id,
      result
    ) values (
      v_user_id,
      'CREATE',
      'journal',
      v_journal.id::text,
      'success'
    );

    return next v_journal;
    return;
  exception
    when unique_violation then
      select operation, result_ref
      into v_existing_operation, v_existing_result
      from public.idempotency_keys
      where user_id = v_user_id
        and key = p_idempotency_key;

      if not found
        or v_existing_operation <> 'journal.create'
        or v_existing_result ->> 'request_fingerprint' <> v_fingerprint
      then
        raise exception using
          errcode = '22023',
          message = 'Idempotency key was reused with a different request';
      end if;

      return query
        select row_value.*
        from public.journals as row_value
        where row_value.user_id = v_user_id
          and row_value.id = (v_existing_result ->> 'id')::bigint;
      return;
  end;
end
$$;

revoke all on function public.create_journal(
  text,
  date,
  text,
  text,
  text[]
) from public;
grant execute on function public.create_journal(
  text,
  date,
  text,
  text,
  text[]
) to authenticated;

create function public.create_goal(
  p_idempotency_key text,
  p_title text,
  p_domain text,
  p_status text,
  p_priority smallint,
  p_start_date date,
  p_target_date date
)
returns setof public.goals
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_fingerprint text;
  v_existing_operation text;
  v_existing_result jsonb;
  v_goal public.goals%rowtype;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'title', p_title,
    'domain', p_domain,
    'status', p_status,
    'priority', p_priority,
    'start_date', p_start_date,
    'target_date', p_target_date
  )::text);

  select operation, result_ref
  into v_existing_operation, v_existing_result
  from public.idempotency_keys
  where user_id = v_user_id
    and key = p_idempotency_key;

  if found then
    if v_existing_operation <> 'goal.create'
      or v_existing_result ->> 'request_fingerprint' <> v_fingerprint
    then
      raise exception using
        errcode = '22023',
        message = 'Idempotency key was reused with a different request';
    end if;

    return query
      select row_value.*
      from public.goals as row_value
      where row_value.user_id = v_user_id
        and row_value.id = (v_existing_result ->> 'id')::bigint;
    return;
  end if;

  begin
    insert into public.goals (
      user_id,
      title,
      domain,
      status,
      priority,
      start_date,
      target_date
    ) values (
      v_user_id,
      p_title,
      p_domain,
      p_status,
      p_priority,
      p_start_date,
      p_target_date
    )
    returning * into v_goal;

    insert into public.idempotency_keys (
      user_id,
      key,
      operation,
      result_ref,
      expires_at
    ) values (
      v_user_id,
      p_idempotency_key,
      'goal.create',
      jsonb_build_object(
        'entity_type', 'goal',
        'id', v_goal.id,
        'request_fingerprint', v_fingerprint
      ),
      transaction_timestamp() + interval '24 hours'
    );

    insert into public.audit_events (
      user_id,
      action,
      entity_type,
      entity_id,
      result
    ) values (
      v_user_id,
      'CREATE',
      'goal',
      v_goal.id::text,
      'success'
    );

    return next v_goal;
    return;
  exception
    when unique_violation then
      select operation, result_ref
      into v_existing_operation, v_existing_result
      from public.idempotency_keys
      where user_id = v_user_id
        and key = p_idempotency_key;

      if not found
        or v_existing_operation <> 'goal.create'
        or v_existing_result ->> 'request_fingerprint' <> v_fingerprint
      then
        raise exception using
          errcode = '22023',
          message = 'Idempotency key was reused with a different request';
      end if;

      return query
        select row_value.*
        from public.goals as row_value
        where row_value.user_id = v_user_id
          and row_value.id = (v_existing_result ->> 'id')::bigint;
      return;
  end;
end
$$;

revoke all on function public.create_goal(
  text,
  text,
  text,
  text,
  smallint,
  date,
  date
) from public;
grant execute on function public.create_goal(
  text,
  text,
  text,
  text,
  smallint,
  date,
  date
) to authenticated;

create function public.create_daily_checkin(
  p_idempotency_key text,
  p_checkin_date date,
  p_sleep_quality integer,
  p_energy integer,
  p_mood integer,
  p_life_feeling integer,
  p_anchors jsonb,
  p_notes text
)
returns setof public.daily_checkins
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_notes text := nullif(btrim(p_notes), '');
  v_fingerprint text;
  v_existing_operation text;
  v_existing_result jsonb;
  v_checkin public.daily_checkins%rowtype;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required';
  end if;

  if (p_sleep_quality is not null and p_sleep_quality not between 1 and 5)
    or (p_energy is not null and p_energy not between 1 and 5)
    or (p_mood is not null and p_mood not between 1 and 5)
    or (p_life_feeling is not null and p_life_feeling not between 1 and 5)
  then
    raise exception using
      errcode = '22023',
      message = 'Daily check-in ratings must be integers from 1 through 5';
  end if;

  if p_anchors is not null
    and (
      jsonb_typeof(p_anchors) <> 'object'
      or (
        p_anchors - array[
          'wake',
          'body_light',
          'life_action',
          'wind_down'
        ]::text[]
      ) <> '{}'::jsonb
      or exists (
        select 1
        from jsonb_each_text(p_anchors) as anchor
        where anchor.value not in ('complete', 'minimum', 'skipped')
      )
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Daily check-in anchors are invalid';
  end if;

  if p_sleep_quality is null
    and p_energy is null
    and p_mood is null
    and p_life_feeling is null
    and coalesce(p_anchors, '{}'::jsonb) = '{}'::jsonb
    and v_notes is null
  then
    raise exception using
      errcode = '22023',
      message = 'Daily check-in requires at least one explicit field';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'checkin_date', p_checkin_date,
    'sleep_quality', p_sleep_quality,
    'energy', p_energy,
    'mood', p_mood,
    'life_feeling', p_life_feeling,
    'anchors', p_anchors,
    'notes', v_notes
  )::text);

  select operation, result_ref
  into v_existing_operation, v_existing_result
  from public.idempotency_keys
  where user_id = v_user_id
    and key = p_idempotency_key;

  if found then
    if v_existing_operation <> 'daily_checkin.create'
      or v_existing_result ->> 'request_fingerprint' <> v_fingerprint
    then
      raise exception using
        errcode = '22023',
        message = 'Idempotency key was reused with a different request';
    end if;

    return query
      select row_value.*
      from public.daily_checkins as row_value
      where row_value.user_id = v_user_id
        and row_value.id = (v_existing_result ->> 'id')::bigint;
    return;
  end if;

  begin
    insert into public.daily_checkins (
      user_id,
      checkin_date,
      sleep_quality,
      energy,
      mood,
      life_feeling,
      anchors,
      notes
    ) values (
      v_user_id,
      p_checkin_date,
      p_sleep_quality,
      p_energy,
      p_mood,
      p_life_feeling,
      p_anchors,
      v_notes
    )
    returning * into v_checkin;

    insert into public.idempotency_keys (
      user_id,
      key,
      operation,
      result_ref,
      expires_at
    ) values (
      v_user_id,
      p_idempotency_key,
      'daily_checkin.create',
      jsonb_build_object(
        'entity_type', 'daily_checkin',
        'id', v_checkin.id,
        'request_fingerprint', v_fingerprint
      ),
      transaction_timestamp() + interval '24 hours'
    );

    insert into public.audit_events (
      user_id,
      action,
      entity_type,
      entity_id,
      result
    ) values (
      v_user_id,
      'CREATE',
      'daily_checkin',
      v_checkin.id::text,
      'success'
    );

    return next v_checkin;
    return;
  exception
    when unique_violation then
      select operation, result_ref
      into v_existing_operation, v_existing_result
      from public.idempotency_keys
      where user_id = v_user_id
        and key = p_idempotency_key;

      if not found then
        raise;
      end if;
      if v_existing_operation <> 'daily_checkin.create'
        or v_existing_result ->> 'request_fingerprint' <> v_fingerprint
      then
        raise exception using
          errcode = '22023',
          message = 'Idempotency key was reused with a different request';
      end if;

      return query
        select row_value.*
        from public.daily_checkins as row_value
        where row_value.user_id = v_user_id
          and row_value.id = (v_existing_result ->> 'id')::bigint;
      return;
  end;
end
$$;

revoke all on function public.create_daily_checkin(
  text,
  date,
  integer,
  integer,
  integer,
  integer,
  jsonb,
  text
) from public;
grant execute on function public.create_daily_checkin(
  text,
  date,
  integer,
  integer,
  integer,
  integer,
  jsonb,
  text
) to authenticated;

create function public.export_life_console_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
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
    'backup_runs', coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.created_at, row_value.id)
      from public.backup_runs as row_value
      where row_value.user_id = (select auth.uid())
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.export_life_console_snapshot() from public;
grant execute on function public.export_life_console_snapshot() to authenticated;
