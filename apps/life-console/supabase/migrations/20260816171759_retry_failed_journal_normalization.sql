-- Life Console 2.4.0: retry one failed normalization without creating a duplicate job.

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
  where user_id = v_user_id and task_key = p_task_key
  for update;
  if found then
    if v_job.journal_id <> p_journal_id
       or v_job.source_revision <> p_source_revision
       or v_job.contract_version <> p_contract_version
       or v_job.prompt_version <> p_prompt_version
       or v_job.processor <> p_processor then
      raise exception using errcode = '22023', message = 'Normalization task key changed';
    end if;
    if v_job.status = 'failed' then
      if v_job.attempts >= 2 then
        raise exception using errcode = '22023', message = 'Normalization retry limit reached';
      end if;
      update public.journal_normalization_jobs
      set status = 'processing', attempts = attempts + 1,
          failure_code = null, updated_at = transaction_timestamp()
      where id = v_job.id
      returning * into v_job;
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

revoke all on function public.begin_journal_normalization(
  bigint, integer, text, text, text, text
) from public, anon;
grant execute on function public.begin_journal_normalization(
  bigint, integer, text, text, text, text
) to authenticated;
