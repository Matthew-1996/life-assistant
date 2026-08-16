-- Owner-scoped backup request used by the web UI and the local backup Agent.

create function public.request_life_console_backup()
returns setof public.backup_runs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  return query
  insert into public.backup_runs (user_id, status, manifest_version)
  values (v_user_id, 'pending', 2)
  returning *;
end
$$;

revoke all on function public.request_life_console_backup() from public;
grant execute on function public.request_life_console_backup() to authenticated;
