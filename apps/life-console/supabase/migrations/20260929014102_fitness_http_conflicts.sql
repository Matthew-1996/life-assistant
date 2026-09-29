-- Business conflicts must return HTTP 409 immediately, not transaction-serialization failures.
-- https://docs.postgrest.org/en/stable/references/errors.html#raise-errors-with-http-status-codes
create or replace function public.create_fitness_appointment(
  p_operation_key text, p_title text, p_start_at timestamptz, p_end_at timestamptz,
  p_location text default '', p_notes text default ''
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
  select * into v_receipt from life_console_private.fitness_create_receipts where user_id=v_user and operation_key=p_operation_key;
  if found then
    if v_receipt.fingerprint <> v_fingerprint then
      raise exception using errcode='PT409',message='Idempotency key has different input';
    end if;
    return query select * from public.fitness_appointments where user_id=v_user and id=v_receipt.appointment_id;
    return;
  end if;
  insert into public.fitness_appointments(user_id,title,start_at,end_at,location,notes)
    values(v_user,btrim(p_title),p_start_at,p_end_at,coalesce(p_location,''),coalesce(p_notes,'')) returning * into v_row;
  insert into life_console_private.fitness_create_receipts(user_id,operation_key,fingerprint,appointment_id)
    values(v_user,p_operation_key,v_fingerprint,v_row.id);
  perform life_console_private.fitness_bump_feed(v_user);
  insert into public.audit_events(user_id,action,entity_type,entity_id,result)
    values(v_user,'CREATE','fitness_appointment',v_row.id::text,'success');
  return next v_row;
end $$;

create or replace function public.update_fitness_appointment(
  p_id uuid,p_expected_revision integer,p_title text,p_start_at timestamptz,p_end_at timestamptz,
  p_location text default '',p_notes text default ''
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
    location=coalesce(p_location,''),notes=coalesce(p_notes,''),revision=revision+1,updated_at=transaction_timestamp()
    where user_id=v_user and id=p_id returning * into v_row;
  perform life_console_private.fitness_bump_feed(v_user);
  insert into public.audit_events(user_id,action,entity_type,entity_id,result)
    values(v_user,'UPDATE','fitness_appointment',v_row.id::text,'success');
  return next v_row;
end $$;

create or replace function public.soft_delete_fitness_appointment(p_id uuid,p_expected_revision integer)
returns setof public.fitness_appointments
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := life_console_private.fitness_require_owner();
  v_row public.fitness_appointments%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fitness:'||v_user::text,0));
  select * into v_row from public.fitness_appointments where id=p_id and user_id=v_user for update;
  if not found then raise exception using errcode='P0002',message='Appointment not found'; end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode='PT409',message='Expected revision is required';
  end if;
  if v_row.deleted_at is not null then return next v_row; return; end if;
  if p_expected_revision <> v_row.revision then raise exception using errcode='PT409',message='Appointment revision changed'; end if;
  update public.fitness_appointments set deleted_at=transaction_timestamp(),revision=revision+1,updated_at=transaction_timestamp()
    where id=p_id and user_id=v_user returning * into v_row;
  perform life_console_private.fitness_bump_feed(v_user);
  insert into public.audit_events(user_id,action,entity_type,entity_id,result)
    values(v_user,'SOFT_DELETE','fitness_appointment',v_row.id::text,'success');
  return next v_row;
end $$;
