-- Life Console 2.4.0: one raw-first journal contract and revision-safe normalization.

alter table public.journals
  add column event_time text,
  add column time_precision text not null default 'unknown'
    check (time_precision in ('exact', 'approximate', 'unknown')),
  add column source text not null default 'legacy'
    check (source in ('legacy', 'agent', 'life_console', 'automation')),
  add column privacy text not null default 'owner-only'
    check (privacy = 'owner-only'),
  add column raw_revision integer not null default 1
    check (raw_revision > 0),
  add column normalization_status text not null default 'legacy'
    check (normalization_status in (
      'legacy', 'pending', 'processing', 'completed', 'failed', 'stale'
    )),
  add column normalization_contract_version text,
  add column normalization_prompt_version text,
  add column normalization_processor text
    check (normalization_processor is null or normalization_processor in ('agent', 'deepseek')),
  add column normalized_source_revision integer
    check (normalized_source_revision is null or normalized_source_revision > 0),
  add column normalized_at timestamptz,
  add column normalization_error_code text,
  add constraint journals_event_time_format check (
    event_time is null or event_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ),
  add constraint journals_event_time_precision check (
    (time_precision = 'unknown' and event_time is null)
    or (time_precision in ('exact', 'approximate') and event_time is not null)
  );

create table public.journal_context_entities (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 180),
  aliases text[] not null default '{}'::text[],
  relation text not null check (char_length(relation) between 1 and 120),
  revision text not null check (char_length(revision) between 8 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, display_name)
);

create table public.journal_normalization_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  journal_id bigint not null references public.journals(id) on delete cascade,
  source_revision integer not null check (source_revision > 0),
  contract_version text not null check (char_length(contract_version) between 8 and 120),
  prompt_version text not null check (char_length(prompt_version) between 8 and 120),
  processor text not null check (processor in ('agent', 'deepseek')),
  task_key text not null check (char_length(task_key) between 16 and 200),
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  attempts integer not null default 1 check (attempts between 1 and 2),
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, task_key),
  unique (user_id, journal_id, source_revision, contract_version, processor)
);

create index journal_context_entities_user_active_idx
  on public.journal_context_entities (user_id, active, id);
create index journal_normalization_jobs_user_journal_idx
  on public.journal_normalization_jobs (user_id, journal_id, created_at desc);

alter table public.journal_context_entities enable row level security;
alter table public.journal_normalization_jobs enable row level security;

revoke all on public.journal_context_entities from anon, authenticated;
revoke all on public.journal_normalization_jobs from anon, authenticated;
grant select on public.journal_context_entities to authenticated;
grant select, insert, update on public.journal_normalization_jobs to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy journal_context_entities_select on public.journal_context_entities
  for select to authenticated using ((select auth.uid()) = user_id);
create policy journal_normalization_jobs_select on public.journal_normalization_jobs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy journal_normalization_jobs_insert on public.journal_normalization_jobs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy journal_normalization_jobs_update on public.journal_normalization_jobs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create function public.mark_journal_raw_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.content is distinct from old.content
     or new.event_date is distinct from old.event_date
     or new.event_time is distinct from old.event_time
     or new.time_precision is distinct from old.time_precision then
    new.raw_revision := old.raw_revision + 1;
    if old.normalization_status = 'completed' then
      new.normalization_status := 'stale';
    elsif old.normalization_status <> 'legacy' then
      new.normalization_status := 'pending';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.mark_journal_raw_change() from public;
create trigger journals_mark_raw_change
before update on public.journals
for each row execute function public.mark_journal_raw_change();

create function public.create_journal_v2(
  p_record_key text,
  p_idempotency_key text,
  p_event_date date,
  p_event_time text,
  p_time_precision text,
  p_source text,
  p_privacy text,
  p_content text
)
returns setof public.journals
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_fingerprint text;
  v_existing_operation text;
  v_existing_result jsonb;
  v_journal public.journals%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if coalesce(char_length(p_record_key), 0) not between 8 and 200
     or coalesce(char_length(p_idempotency_key), 0) not between 16 and 200
     or coalesce(char_length(p_content), 0) not between 1 and 100000
     or p_time_precision not in ('exact', 'approximate', 'unknown')
     or p_source not in ('agent', 'life_console', 'automation')
     or p_privacy <> 'owner-only'
     or (p_time_precision = 'unknown' and p_event_time is not null)
     or (p_time_precision in ('exact', 'approximate') and p_event_time is null) then
    raise exception using errcode = '22023', message = 'Journal v2 input is invalid';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'record_key', p_record_key,
    'event_date', p_event_date,
    'event_time', p_event_time,
    'time_precision', p_time_precision,
    'source', p_source,
    'privacy', p_privacy,
    'content', p_content
  )::text);

  select operation, result_ref into v_existing_operation, v_existing_result
  from public.idempotency_keys
  where user_id = v_user_id and key = p_idempotency_key;
  if found then
    if v_existing_operation <> 'journal.create.v2'
       or v_existing_result->>'request_fingerprint' <> v_fingerprint then
      raise exception using errcode = '22023', message = 'Idempotency key request changed';
    end if;
    return query select row_value.* from public.journals row_value
      where row_value.user_id = v_user_id
        and row_value.id = (v_existing_result->>'id')::bigint;
    return;
  end if;

  insert into public.journals (
    user_id, record_key, event_date, event_time, time_precision,
    source, privacy, content, title, tags, metadata,
    normalization_status, raw_revision
  ) values (
    v_user_id, p_record_key, p_event_date, p_event_time, p_time_precision,
    p_source, p_privacy, p_content, null, '{}'::text[], '{}'::jsonb,
    'pending', 1
  ) returning * into v_journal;

  insert into public.idempotency_keys (
    user_id, key, operation, result_ref, expires_at
  ) values (
    v_user_id, p_idempotency_key, 'journal.create.v2',
    jsonb_build_object(
      'entity_type', 'journal',
      'id', v_journal.id,
      'request_fingerprint', v_fingerprint
    ),
    transaction_timestamp() + interval '24 hours'
  );
  return next v_journal;
end
$$;

create function public.begin_journal_normalization(
  p_journal_id bigint,
  p_source_revision integer,
  p_contract_version text,
  p_prompt_version text,
  p_processor text,
  p_task_key text
)
returns setof public.journal_normalization_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_journal public.journals%rowtype;
  v_job public.journal_normalization_jobs%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  select * into v_journal from public.journals
  where id = p_journal_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Journal is unavailable';
  end if;
  if v_journal.raw_revision <> p_source_revision then
    raise exception using errcode = '40001', message = 'Journal source revision changed';
  end if;
  if p_processor not in ('agent', 'deepseek')
     or coalesce(char_length(p_task_key), 0) not between 16 and 200 then
    raise exception using errcode = '22023', message = 'Normalization request is invalid';
  end if;

  select * into v_job from public.journal_normalization_jobs
  where user_id = v_user_id and task_key = p_task_key;
  if found then
    if v_job.journal_id <> p_journal_id
       or v_job.source_revision <> p_source_revision
       or v_job.contract_version <> p_contract_version
       or v_job.prompt_version <> p_prompt_version
       or v_job.processor <> p_processor then
      raise exception using errcode = '22023', message = 'Normalization task key changed';
    end if;
    return next v_job;
    return;
  end if;

  insert into public.journal_normalization_jobs (
    user_id, journal_id, source_revision, contract_version,
    prompt_version, processor, task_key
  ) values (
    v_user_id, p_journal_id, p_source_revision, p_contract_version,
    p_prompt_version, p_processor, p_task_key
  ) returning * into v_job;
  return next v_job;
end
$$;

create function public.complete_journal_normalization(
  p_job_id uuid,
  p_expected_source_revision integer,
  p_metadata jsonb,
  p_title text,
  p_tags text[]
)
returns setof public.journals
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_job public.journal_normalization_jobs%rowtype;
  v_journal public.journals%rowtype;
  v_required text[] := array[
    'title','summary','facts','feelings','people','places','themes',
    'planning_clues','inferences','tags'
  ];
begin
  select * into v_job from public.journal_normalization_jobs
  where id = p_job_id and user_id = v_user_id for update;
  if not found or v_job.status <> 'processing' then
    raise exception using errcode = '22023', message = 'Normalization job is unavailable';
  end if;
  select * into v_journal from public.journals
  where id = v_job.journal_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found
     or v_journal.raw_revision <> p_expected_source_revision
     or v_job.source_revision <> p_expected_source_revision then
    raise exception using errcode = '40001', message = 'Journal source revision changed';
  end if;
  if jsonb_typeof(p_metadata) <> 'object'
     or not (p_metadata ?& v_required)
     or (p_metadata - v_required) <> '{}'::jsonb
     or p_metadata->>'title' <> p_title
     or jsonb_typeof(p_metadata->'tags') <> 'array' then
    raise exception using errcode = '22023', message = 'Normalization metadata is invalid';
  end if;

  update public.journals set
    title = p_title,
    tags = coalesce(p_tags, '{}'::text[]),
    metadata = p_metadata,
    normalization_status = 'completed',
    normalization_contract_version = v_job.contract_version,
    normalization_prompt_version = v_job.prompt_version,
    normalization_processor = v_job.processor,
    normalized_source_revision = p_expected_source_revision,
    normalized_at = transaction_timestamp(),
    normalization_error_code = null,
    revision = revision + 1
  where id = v_journal.id
  returning * into v_journal;

  update public.journal_normalization_jobs
  set status = 'completed', failure_code = null, updated_at = transaction_timestamp()
  where id = v_job.id;
  return next v_journal;
end
$$;

create function public.fail_journal_normalization(
  p_job_id uuid,
  p_expected_source_revision integer,
  p_failure_code text
)
returns setof public.journals
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_job public.journal_normalization_jobs%rowtype;
  v_journal public.journals%rowtype;
begin
  select * into v_job from public.journal_normalization_jobs
  where id = p_job_id and user_id = v_user_id for update;
  if not found or v_job.status <> 'processing' then
    raise exception using errcode = '22023', message = 'Normalization job is unavailable';
  end if;
  select * into v_journal from public.journals
  where id = v_job.journal_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found
     or v_journal.raw_revision <> p_expected_source_revision
     or v_job.source_revision <> p_expected_source_revision then
    raise exception using errcode = '40001', message = 'Journal source revision changed';
  end if;
  if coalesce(char_length(p_failure_code), 0) not between 3 and 80 then
    raise exception using errcode = '22023', message = 'Failure code is invalid';
  end if;

  update public.journals set
    normalization_status = 'failed',
    normalization_error_code = p_failure_code,
    revision = revision + 1
  where id = v_journal.id returning * into v_journal;
  update public.journal_normalization_jobs
  set status = 'failed', failure_code = p_failure_code,
      updated_at = transaction_timestamp()
  where id = v_job.id;
  return next v_journal;
end
$$;

revoke all on function public.create_journal_v2(
  text, text, date, text, text, text, text, text
) from public;
revoke all on function public.begin_journal_normalization(
  bigint, integer, text, text, text, text
) from public;
revoke all on function public.complete_journal_normalization(
  uuid, integer, jsonb, text, text[]
) from public;
revoke all on function public.fail_journal_normalization(
  uuid, integer, text
) from public;
grant execute on function public.create_journal_v2(
  text, text, date, text, text, text, text, text
) to authenticated;
grant execute on function public.begin_journal_normalization(
  bigint, integer, text, text, text, text
) to authenticated;
grant execute on function public.complete_journal_normalization(
  uuid, integer, jsonb, text, text[]
) to authenticated;
grant execute on function public.fail_journal_normalization(
  uuid, integer, text
) to authenticated;
