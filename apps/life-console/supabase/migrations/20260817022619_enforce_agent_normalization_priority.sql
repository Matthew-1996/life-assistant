-- Life Console 2.4.0: serialize normalization jobs and keep Agent results authoritative.
-- Version aligned with the Production migration history.

create or replace function public.begin_journal_normalization(
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
  v_has_completed_agent boolean;
  v_has_other_completed boolean;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;

  -- All normalization RPCs lock an existing job before its journal.
  select * into v_job from public.journal_normalization_jobs
  where user_id = v_user_id and task_key = p_task_key
  for update;
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

  if v_job.id is not null and (
    v_job.journal_id <> p_journal_id
    or v_job.source_revision <> p_source_revision
    or v_job.contract_version <> p_contract_version
    or v_job.processor <> p_processor
  ) then
    raise exception using errcode = '22023', message = 'Normalization task key changed';
  end if;

  select exists (
    select 1 from public.journal_normalization_jobs agent_job
    where agent_job.user_id = v_user_id
      and agent_job.journal_id = p_journal_id
      and agent_job.source_revision = p_source_revision
      and agent_job.processor = 'agent'
      and agent_job.status = 'completed'
  ) into v_has_completed_agent;
  if p_processor = 'deepseek' and v_has_completed_agent then
    if v_job.id is not null and v_job.status = 'completed' then
      return next v_job;
      return;
    end if;
    raise exception using errcode = '40001', message = 'Agent normalization already completed';
  end if;

  if v_job.id is not null then
    if v_job.prompt_version <> p_prompt_version then
      if v_job.status not in ('failed', 'completed') or v_job.attempts >= 2 then
        raise exception using errcode = '22023', message = 'Normalization prompt upgrade is unavailable';
      end if;
      update public.journal_normalization_jobs
      set status = 'processing', attempts = attempts + 1,
          prompt_version = p_prompt_version, failure_code = null,
          updated_at = transaction_timestamp()
      where id = v_job.id returning * into v_job;
    elsif v_job.status = 'failed' then
      if v_job.attempts >= 2 then
        raise exception using errcode = '22023', message = 'Normalization retry limit reached';
      end if;
      update public.journal_normalization_jobs
      set status = 'processing', attempts = attempts + 1,
          failure_code = null, updated_at = transaction_timestamp()
      where id = v_job.id returning * into v_job;
    elsif v_job.status = 'processing' then
      raise exception using errcode = '40001', message = 'Normalization is already processing';
    else
      return next v_job;
      return;
    end if;

    select exists (
      select 1 from public.journal_normalization_jobs other
      where other.user_id = v_user_id
        and other.journal_id = p_journal_id
        and other.source_revision = p_source_revision
        and other.id <> v_job.id
        and other.status = 'completed'
    ) into v_has_other_completed;
    if not v_has_other_completed then
      update public.journals
      set normalization_status = 'processing', normalization_error_code = null,
          revision = revision + 1
      where id = v_job.journal_id and user_id = v_user_id;
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

create or replace function public.complete_journal_normalization(
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
  v_has_completed_agent boolean;
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

  select exists (
    select 1 from public.journal_normalization_jobs agent_job
    where agent_job.user_id = v_user_id
      and agent_job.journal_id = v_job.journal_id
      and agent_job.source_revision = v_job.source_revision
      and agent_job.processor = 'agent'
      and agent_job.status = 'completed'
      and agent_job.id <> v_job.id
  ) into v_has_completed_agent;
  if v_job.processor = 'deepseek' and v_has_completed_agent then
    update public.journal_normalization_jobs
    set status = 'completed', failure_code = null,
        updated_at = transaction_timestamp()
    where id = v_job.id;
    return next v_journal;
    return;
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
  where id = v_journal.id returning * into v_journal;
  update public.journal_normalization_jobs
  set status = 'completed', failure_code = null, updated_at = transaction_timestamp()
  where id = v_job.id;
  return next v_journal;
end
$$;

revoke all on function public.begin_journal_normalization(
  bigint, integer, text, text, text, text
) from public, anon;
grant execute on function public.begin_journal_normalization(
  bigint, integer, text, text, text, text
) to authenticated;
revoke all on function public.complete_journal_normalization(
  uuid, integer, jsonb, text, text[]
) from public, anon;
grant execute on function public.complete_journal_normalization(
  uuid, integer, jsonb, text, text[]
) to authenticated;
