-- Life Console 2.5.0: owner-scoped Todo, status history, weekly messages,
-- and revision-safe journal soft deletion. Supabase provides auth.uid(),
-- anon, and authenticated.

create table if not exists public.todo_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  priority text not null default 'P1'
    check (priority in ('P0', 'P1', 'P2')),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed')),
  planned_start_at timestamptz not null default transaction_timestamp(),
  due_at timestamptz not null,
  actual_started_at timestamptz,
  completed_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  unique (user_id, id),
  check (due_at > planned_start_at),
  check (
    (status = 'not_started' and actual_started_at is null and completed_at is null)
    or (status = 'in_progress' and actual_started_at is not null and completed_at is null)
    or (
      status = 'completed'
      and actual_started_at is not null
      and completed_at is not null
      and completed_at >= actual_started_at
    )
  )
);

create table if not exists public.todo_status_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  todo_id bigint not null,
  from_status text not null
    check (from_status in ('not_started', 'in_progress', 'completed')),
  to_status text not null
    check (to_status in ('not_started', 'in_progress', 'completed')),
  todo_revision bigint not null check (todo_revision > 1),
  occurred_at timestamptz not null default transaction_timestamp(),
  foreign key (user_id, todo_id)
    references public.todo_items(user_id, id) on delete restrict,
  check (from_status <> to_status)
);

create table if not exists public.dashboard_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  week_start date not null,
  message text not null check (char_length(btrim(message)) between 1 and 1000),
  quote_source text check (quote_source is null or char_length(quote_source) <= 300),
  image_url text check (image_url is null or char_length(image_url) <= 2000),
  image_author_name text
    check (image_author_name is null or char_length(image_author_name) <= 200),
  image_author_url text
    check (image_author_url is null or char_length(image_author_url) <= 2000),
  image_platform_url text
    check (image_platform_url is null or char_length(image_platform_url) <= 2000),
  fallback_theme text not null default 'default'
    check (char_length(fallback_theme) between 1 and 80),
  generated_at timestamptz not null default transaction_timestamp(),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  unique (user_id, week_start),
  check (extract(isodow from week_start) = 1)
);

create index if not exists todo_items_owner_status_due_idx
  on public.todo_items (user_id, status, priority, due_at, created_at);
create index if not exists todo_items_owner_schedule_idx
  on public.todo_items (user_id, planned_start_at, due_at);
create index if not exists todo_status_events_owner_todo_idx
  on public.todo_status_events (user_id, todo_id, occurred_at desc, id desc);
create index if not exists dashboard_messages_owner_week_idx
  on public.dashboard_messages (user_id, week_start desc);

alter table public.todo_items enable row level security;
alter table public.todo_status_events enable row level security;
alter table public.dashboard_messages enable row level security;

revoke all on table public.todo_items from anon, authenticated;
revoke all on table public.todo_status_events from anon, authenticated;
revoke all on table public.dashboard_messages from anon, authenticated;
grant select on table public.todo_items to authenticated;
grant select on table public.todo_status_events to authenticated;
grant select on table public.dashboard_messages to authenticated;

drop policy if exists todo_items_select on public.todo_items;
create policy todo_items_select on public.todo_items
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists todo_status_events_select on public.todo_status_events;
create policy todo_status_events_select on public.todo_status_events
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists dashboard_messages_select on public.dashboard_messages;
create policy dashboard_messages_select on public.dashboard_messages
  for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.create_todo(
  p_idempotency_key text,
  p_title text,
  p_priority text,
  p_planned_start_at timestamptz,
  p_due_at timestamptz
)
returns setof public.todo_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_priority text := coalesce(p_priority, 'P1');
  v_planned_start_at timestamptz := coalesce(
    p_planned_start_at,
    transaction_timestamp()
  );
  v_fingerprint text;
  v_existing_operation text;
  v_existing_result jsonb;
  v_todo public.todo_items%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if coalesce(char_length(p_idempotency_key), 0) not between 16 and 200 then
    raise exception using errcode = '22023', message = 'Invalid idempotency key';
  end if;
  if coalesce(char_length(btrim(p_title)), 0) not between 1 and 240 then
    raise exception using errcode = '22023', message = 'Invalid Todo title';
  end if;
  if v_priority not in ('P0', 'P1', 'P2') then
    raise exception using errcode = '22023', message = 'Invalid Todo priority';
  end if;
  if p_due_at is null or p_due_at <= v_planned_start_at then
    raise exception using errcode = '22023', message = 'Todo DDL must follow planned start';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'title', btrim(p_title),
    'priority', v_priority,
    'planned_start_at', p_planned_start_at,
    'due_at', p_due_at
  )::text);

  select operation, result_ref
    into v_existing_operation, v_existing_result
  from public.idempotency_keys
  where user_id = v_user_id and key = p_idempotency_key;

  if found then
    if v_existing_operation <> 'todo.create'
      or v_existing_result ->> 'request_fingerprint' <> v_fingerprint
    then
      raise exception using
        errcode = '22023',
        message = 'Idempotency key was reused with a different request';
    end if;
    return query
      select row_value.*
      from public.todo_items as row_value
      where row_value.user_id = v_user_id
        and row_value.id = (v_existing_result ->> 'id')::bigint;
    return;
  end if;

  begin
    insert into public.todo_items (
      user_id, title, priority, planned_start_at, due_at
    ) values (
      v_user_id, btrim(p_title), v_priority, v_planned_start_at, p_due_at
    ) returning * into v_todo;

    insert into public.idempotency_keys (
      user_id, key, operation, result_ref, expires_at
    ) values (
      v_user_id,
      p_idempotency_key,
      'todo.create',
      jsonb_build_object(
        'entity_type', 'todo',
        'id', v_todo.id,
        'request_fingerprint', v_fingerprint
      ),
      transaction_timestamp() + interval '24 hours'
    );

    insert into public.audit_events (
      user_id, action, entity_type, entity_id, result
    ) values (v_user_id, 'CREATE', 'todo', v_todo.id::text, 'success');

    return next v_todo;
    return;
  exception
    when unique_violation then
      select operation, result_ref
        into v_existing_operation, v_existing_result
      from public.idempotency_keys
      where user_id = v_user_id and key = p_idempotency_key;
      if not found
        or v_existing_operation <> 'todo.create'
        or v_existing_result ->> 'request_fingerprint' <> v_fingerprint
      then
        raise exception using
          errcode = '22023',
          message = 'Idempotency key was reused with a different request';
      end if;
      return query
        select row_value.*
        from public.todo_items as row_value
        where row_value.user_id = v_user_id
          and row_value.id = (v_existing_result ->> 'id')::bigint;
      return;
  end;
end
$$;

create or replace function public.update_todo(
  p_id bigint,
  p_expected_revision bigint,
  p_title text,
  p_priority text,
  p_planned_start_at timestamptz,
  p_due_at timestamptz
)
returns setof public.todo_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_todo public.todo_items%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if coalesce(char_length(btrim(p_title)), 0) not between 1 and 240
    or p_priority not in ('P0', 'P1', 'P2')
    or p_planned_start_at is null
    or p_due_at is null
    or p_due_at <= p_planned_start_at
  then
    raise exception using errcode = '22023', message = 'Invalid Todo update';
  end if;

  select * into v_todo
  from public.todo_items
  where user_id = v_user_id and id = p_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Todo not found';
  end if;
  if p_expected_revision is null or v_todo.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Todo revision changed';
  end if;

  update public.todo_items
  set title = btrim(p_title),
      priority = p_priority,
      planned_start_at = p_planned_start_at,
      due_at = p_due_at,
      revision = revision + 1,
      updated_at = transaction_timestamp()
  where user_id = v_user_id and id = p_id
  returning * into v_todo;

  insert into public.audit_events (
    user_id, action, entity_type, entity_id, result
  ) values (v_user_id, 'UPDATE', 'todo', v_todo.id::text, 'success');

  return next v_todo;
end
$$;

create or replace function public.transition_todo(
  p_id bigint,
  p_expected_revision bigint,
  p_status text
)
returns setof public.todo_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_todo public.todo_items%rowtype;
  v_from_status text;
  v_occurred_at timestamptz := transaction_timestamp();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if p_status is null or p_status not in ('not_started', 'in_progress', 'completed') then
    raise exception using errcode = '22023', message = 'Invalid Todo status';
  end if;

  select * into v_todo
  from public.todo_items
  where user_id = v_user_id and id = p_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Todo not found';
  end if;
  if v_todo.status = p_status then
    return next v_todo;
    return;
  end if;
  if p_expected_revision is null or v_todo.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Todo revision changed';
  end if;

  v_from_status := v_todo.status;
  update public.todo_items
  set status = p_status,
      actual_started_at = case
        when p_status = 'not_started' then null
        when actual_started_at is not null then actual_started_at
        else v_occurred_at
      end,
      completed_at = case
        when p_status = 'completed' then v_occurred_at
        else null
      end,
      revision = revision + 1,
      updated_at = v_occurred_at
  where user_id = v_user_id and id = p_id
  returning * into v_todo;

  insert into public.todo_status_events (
    user_id, todo_id, from_status, to_status, todo_revision, occurred_at
  ) values (
    v_user_id, v_todo.id, v_from_status, v_todo.status,
    v_todo.revision, v_occurred_at
  );
  insert into public.audit_events (
    user_id, action, entity_type, entity_id, result
  ) values (v_user_id, 'TRANSITION', 'todo', v_todo.id::text, 'success');

  return next v_todo;
end
$$;

create or replace function public.upsert_dashboard_message(
  p_idempotency_key text,
  p_week_start date,
  p_expected_revision bigint,
  p_message text,
  p_quote_source text,
  p_image_metadata jsonb,
  p_fallback_theme text
)
returns setof public.dashboard_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_image_metadata jsonb := coalesce(p_image_metadata, '{}'::jsonb);
  v_fingerprint text;
  v_existing_operation text;
  v_existing_result jsonb;
  v_message public.dashboard_messages%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if coalesce(char_length(p_idempotency_key), 0) not between 16 and 200 then
    raise exception using errcode = '22023', message = 'Invalid idempotency key';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception using errcode = '22023', message = 'Week start must be Monday';
  end if;
  if coalesce(char_length(btrim(p_message)), 0) not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'Invalid dashboard message';
  end if;
  if jsonb_typeof(v_image_metadata) <> 'object'
    or (v_image_metadata - array[
      'image_url', 'image_author_name', 'image_author_url', 'image_platform_url'
    ]::text[]) <> '{}'::jsonb
  then
    raise exception using errcode = '22023', message = 'Invalid image metadata';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'week_start', p_week_start,
    'expected_revision', p_expected_revision,
    'message', btrim(p_message),
    'quote_source', p_quote_source,
    'image_metadata', v_image_metadata,
    'fallback_theme', coalesce(p_fallback_theme, 'default')
  )::text);

  select operation, result_ref
    into v_existing_operation, v_existing_result
  from public.idempotency_keys
  where user_id = v_user_id and key = p_idempotency_key;
  if found then
    if v_existing_operation <> 'dashboard_message.upsert'
      or v_existing_result ->> 'request_fingerprint' <> v_fingerprint
    then
      raise exception using
        errcode = '22023',
        message = 'Idempotency key was reused with a different request';
    end if;
    return query
      select row_value.*
      from public.dashboard_messages as row_value
      where row_value.user_id = v_user_id
        and row_value.id = (v_existing_result ->> 'id')::bigint;
    return;
  end if;

  begin
    select * into v_message
    from public.dashboard_messages
    where user_id = v_user_id and week_start = p_week_start
    for update;

    if found then
      if p_expected_revision is null or v_message.revision <> p_expected_revision then
        raise exception using errcode = '40001', message = 'Dashboard message revision changed';
      end if;
      update public.dashboard_messages
      set message = btrim(p_message),
          quote_source = nullif(btrim(p_quote_source), ''),
          image_url = nullif(v_image_metadata ->> 'image_url', ''),
          image_author_name = nullif(v_image_metadata ->> 'image_author_name', ''),
          image_author_url = nullif(v_image_metadata ->> 'image_author_url', ''),
          image_platform_url = nullif(v_image_metadata ->> 'image_platform_url', ''),
          fallback_theme = coalesce(nullif(btrim(p_fallback_theme), ''), 'default'),
          generated_at = transaction_timestamp(),
          revision = revision + 1,
          updated_at = transaction_timestamp()
      where user_id = v_user_id and id = v_message.id
      returning * into v_message;
    else
      if p_expected_revision is not null then
        raise exception using errcode = '40001', message = 'Dashboard message revision changed';
      end if;
      insert into public.dashboard_messages (
        user_id, week_start, message, quote_source,
        image_url, image_author_name, image_author_url, image_platform_url,
        fallback_theme
      ) values (
        v_user_id, p_week_start, btrim(p_message), nullif(btrim(p_quote_source), ''),
        nullif(v_image_metadata ->> 'image_url', ''),
        nullif(v_image_metadata ->> 'image_author_name', ''),
        nullif(v_image_metadata ->> 'image_author_url', ''),
        nullif(v_image_metadata ->> 'image_platform_url', ''),
        coalesce(nullif(btrim(p_fallback_theme), ''), 'default')
      ) returning * into v_message;
    end if;

    insert into public.idempotency_keys (
      user_id, key, operation, result_ref, expires_at
    ) values (
      v_user_id,
      p_idempotency_key,
      'dashboard_message.upsert',
      jsonb_build_object(
        'entity_type', 'dashboard_message',
        'id', v_message.id,
        'request_fingerprint', v_fingerprint
      ),
      transaction_timestamp() + interval '24 hours'
    );
    insert into public.audit_events (
      user_id, action, entity_type, entity_id, result
    ) values (v_user_id, 'UPSERT', 'dashboard_message', v_message.id::text, 'success');

    return next v_message;
    return;
  exception
    when unique_violation then
      select operation, result_ref
        into v_existing_operation, v_existing_result
      from public.idempotency_keys
      where user_id = v_user_id and key = p_idempotency_key;
      if found then
        if v_existing_operation <> 'dashboard_message.upsert'
          or v_existing_result ->> 'request_fingerprint' <> v_fingerprint
        then
          raise exception using
            errcode = '22023',
            message = 'Idempotency key was reused with a different request';
        end if;
        return query
          select row_value.*
          from public.dashboard_messages as row_value
          where row_value.user_id = v_user_id
            and row_value.id = (v_existing_result ->> 'id')::bigint;
        return;
      end if;
      raise exception using
        errcode = '40001',
        message = 'Dashboard message revision changed';
  end;
end
$$;

create or replace function public.soft_delete_journal(
  p_journal_id bigint,
  p_expected_revision bigint
)
returns setof public.journals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_journal public.journals%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  select * into v_journal
  from public.journals
  where user_id = v_user_id and id = p_journal_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Journal not found';
  end if;
  if v_journal.deleted_at is not null then
    return next v_journal;
    return;
  end if;
  if p_expected_revision is null or v_journal.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Journal revision changed';
  end if;

  update public.journals
  set deleted_at = transaction_timestamp(),
      revision = revision + 1,
      updated_at = transaction_timestamp()
  where user_id = v_user_id and id = p_journal_id
  returning * into v_journal;
  insert into public.audit_events (
    user_id, action, entity_type, entity_id, result
  ) values (v_user_id, 'SOFT_DELETE', 'journal', v_journal.id::text, 'success');
  return next v_journal;
end
$$;

create or replace function public.restore_journal(
  p_journal_id bigint,
  p_expected_revision bigint
)
returns setof public.journals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_journal public.journals%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  select * into v_journal
  from public.journals
  where user_id = v_user_id and id = p_journal_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Journal not found';
  end if;
  if v_journal.deleted_at is null then
    return next v_journal;
    return;
  end if;
  if p_expected_revision is null or v_journal.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Journal revision changed';
  end if;

  update public.journals
  set deleted_at = null,
      revision = revision + 1,
      updated_at = transaction_timestamp()
  where user_id = v_user_id and id = p_journal_id
  returning * into v_journal;
  insert into public.audit_events (
    user_id, action, entity_type, entity_id, result
  ) values (v_user_id, 'RESTORE', 'journal', v_journal.id::text, 'success');
  return next v_journal;
end
$$;

revoke all on function public.create_todo(
  text, text, text, timestamptz, timestamptz
) from public;
revoke all on function public.create_todo(
  text, text, text, timestamptz, timestamptz
) from anon;
grant execute on function public.create_todo(
  text, text, text, timestamptz, timestamptz
) to authenticated;

revoke all on function public.update_todo(
  bigint, bigint, text, text, timestamptz, timestamptz
) from public;
revoke all on function public.update_todo(
  bigint, bigint, text, text, timestamptz, timestamptz
) from anon;
grant execute on function public.update_todo(
  bigint, bigint, text, text, timestamptz, timestamptz
) to authenticated;

revoke all on function public.transition_todo(bigint, bigint, text) from public;
revoke all on function public.transition_todo(bigint, bigint, text) from anon;
grant execute on function public.transition_todo(bigint, bigint, text) to authenticated;

revoke all on function public.upsert_dashboard_message(
  text, date, bigint, text, text, jsonb, text
) from public;
revoke all on function public.upsert_dashboard_message(
  text, date, bigint, text, text, jsonb, text
) from anon;
grant execute on function public.upsert_dashboard_message(
  text, date, bigint, text, text, jsonb, text
) to authenticated;

revoke all on function public.soft_delete_journal(bigint, bigint) from public;
revoke all on function public.soft_delete_journal(bigint, bigint) from anon;
grant execute on function public.soft_delete_journal(bigint, bigint) to authenticated;

revoke all on function public.restore_journal(bigint, bigint) from public;
revoke all on function public.restore_journal(bigint, bigint) from anon;
grant execute on function public.restore_journal(bigint, bigint) to authenticated;
