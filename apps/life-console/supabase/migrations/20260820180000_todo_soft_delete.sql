-- Life Console 2.5.0: revision-safe Owner Todo soft deletion.

alter table public.todo_items
  add column if not exists deleted_at timestamptz;

create index if not exists todo_items_owner_active_status_due_idx
  on public.todo_items (user_id, status, priority, due_at, created_at)
  where deleted_at is null;

create or replace function public.soft_delete_todo(
  p_id bigint,
  p_expected_revision bigint
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

  select * into v_todo
  from public.todo_items
  where user_id = v_user_id and id = p_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Todo not found';
  end if;
  if v_todo.deleted_at is not null then
    return next v_todo;
    return;
  end if;
  if p_expected_revision is null or v_todo.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Todo revision changed';
  end if;

  update public.todo_items
  set deleted_at = transaction_timestamp(),
      revision = revision + 1,
      updated_at = transaction_timestamp()
  where user_id = v_user_id and id = p_id
  returning * into v_todo;

  insert into public.audit_events (
    user_id, action, entity_type, entity_id, result
  ) values (v_user_id, 'SOFT_DELETE', 'todo', v_todo.id::text, 'success');

  return next v_todo;
end
$$;

revoke all on function public.soft_delete_todo(bigint, bigint) from public;
revoke all on function public.soft_delete_todo(bigint, bigint) from anon;
grant execute on function public.soft_delete_todo(bigint, bigint) to authenticated;
