-- Add an explicit kind; old rows and legacy callers remain timed.
alter table public.fitness_appointments add column time_kind text not null default 'timed'
  check (time_kind in ('timed','all_day'));
alter table public.fitness_appointments drop constraint fitness_appointments_check1;
alter table public.fitness_appointments add constraint fitness_appointments_time_kind_bounds check (
 (time_kind='timed' and (start_at at time zone 'Asia/Shanghai')::date=(end_at at time zone 'Asia/Shanghai')::date)
 or (time_kind='all_day'
 and (start_at at time zone 'Asia/Shanghai')::time=time '00:00:00'
 and (end_at at time zone 'Asia/Shanghai')::time=time '00:00:00'
 and (end_at at time zone 'Asia/Shanghai')::date=(start_at at time zone 'Asia/Shanghai')::date+1)
);
-- Replace signatures, avoiding ambiguous PostgREST overload resolution.
drop function public.create_fitness_appointment(text,text,timestamptz,timestamptz,text,text);
drop function public.update_fitness_appointment(uuid,integer,text,timestamptz,timestamptz,text,text);
-- Business conflicts must return HTTP 409 immediately, not transaction-serialization failures.
-- https://docs.postgrest.org/en/stable/references/errors.html#raise-errors-with-http-status-codes
create or replace function public.create_fitness_appointment(
  p_operation_key text, p_title text, p_start_at timestamptz, p_end_at timestamptz,
  p_location text default '', p_notes text default '', p_time_kind text default 'timed'
) returns setof public.fitness_appointments
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := life_console_private.fitness_require_owner();
  v_fingerprint text;
  v_receipt life_console_private.fitness_create_receipts%rowtype;
  v_row public.fitness_appointments%rowtype;
begin
  if coalesce(char_length(p_operation_key),0) not between 16 and 200 then
    raise exception using errcode='22023',message='Invalid operation key';
  end if;
  -- Serializes this small Owner calendar, including receipt + feed + audit writes.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fitness:'||v_user::text,0));
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'title',btrim(p_title),'start',extract(epoch from p_start_at),'end',extract(epoch from p_end_at),
    'location',coalesce(p_location,''),'notes',coalesce(p_notes,'')
  )::text,'UTF8')),'hex');
  if p_time_kind <> 'timed' then v_fingerprint := encode(sha256(convert_to(v_fingerprint || ':' || p_time_kind,'UTF8')),'hex'); end if;
  select * into v_receipt from life_console_private.fitness_create_receipts where user_id=v_user and operation_key=p_operation_key;
  if found then
    if v_receipt.fingerprint <> v_fingerprint then
      raise exception using errcode='PT409',message='Idempotency key has different input';
    end if;
    return query select * from public.fitness_appointments where user_id=v_user and id=v_receipt.appointment_id;
    return;
  end if;
  insert into public.fitness_appointments(user_id,title,start_at,end_at,location,notes,time_kind)
    values(v_user,btrim(p_title),p_start_at,p_end_at,coalesce(p_location,''),coalesce(p_notes,''),p_time_kind) returning * into v_row;
  insert into life_console_private.fitness_create_receipts(user_id,operation_key,fingerprint,appointment_id)
    values(v_user,p_operation_key,v_fingerprint,v_row.id);
  perform life_console_private.fitness_bump_feed(v_user);
  insert into public.audit_events(user_id,action,entity_type,entity_id,result)
    values(v_user,'CREATE','fitness_appointment',v_row.id::text,'success');
  return next v_row;
end $$;

create or replace function public.update_fitness_appointment(
  p_id uuid,p_expected_revision integer,p_title text,p_start_at timestamptz,p_end_at timestamptz,
  p_location text default '',p_notes text default '',p_time_kind text default 'timed'
) returns setof public.fitness_appointments
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := life_console_private.fitness_require_owner();
  v_row public.fitness_appointments%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fitness:'||v_user::text,0));
  select * into v_row from public.fitness_appointments where id=p_id and user_id=v_user for update;
  if not found then raise exception using errcode='P0002',message='Appointment not found'; end if;
  if v_row.deleted_at is not null then raise exception using errcode='PT409',message='Appointment was deleted'; end if;
  if p_expected_revision is null or p_expected_revision <> v_row.revision then
    raise exception using errcode='PT409',message='Appointment revision changed';
  end if;
  update public.fitness_appointments set title=btrim(p_title),start_at=p_start_at,end_at=p_end_at,
    location=coalesce(p_location,''),notes=coalesce(p_notes,''),time_kind=p_time_kind,revision=revision+1,updated_at=transaction_timestamp()
    where user_id=v_user and id=p_id returning * into v_row;
  perform life_console_private.fitness_bump_feed(v_user);
  insert into public.audit_events(user_id,action,entity_type,entity_id,result)
    values(v_user,'UPDATE','fitness_appointment',v_row.id::text,'success');
  return next v_row;
end $$;


revoke all on function public.create_fitness_appointment(text,text,timestamptz,timestamptz,text,text,text) from public,anon,authenticated;
revoke all on function public.update_fitness_appointment(uuid,integer,text,timestamptz,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.create_fitness_appointment(text,text,timestamptz,timestamptz,text,text,text) to authenticated;
grant execute on function public.update_fitness_appointment(uuid,integer,text,timestamptz,timestamptz,text,text,text) to authenticated;
notify pgrst, 'reload schema';
