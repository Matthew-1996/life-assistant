-- Life Console 2.10.0 phase A. No real Owner is provisioned by this migration.
-- Only a separately approved operator may populate the private allowlist.
create schema if not exists life_console_private;
revoke all on schema life_console_private from public, anon, authenticated;
grant usage on schema life_console_private to authenticated;

create table life_console_private.fitness_owners (
  user_id uuid primary key references auth.users(id) on delete restrict,
  enabled boolean not null default true
);
create table public.fitness_appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 120 and title ~ '[^[:space:]]'),
  start_at timestamptz not null check (isfinite(start_at)),
  end_at timestamptz not null check (isfinite(end_at)),
  time_zone text not null default 'Asia/Shanghai' check (time_zone = 'Asia/Shanghai'),
  location text not null default '' check (char_length(location) <= 240),
  notes text not null default '' check (char_length(notes) <= 4000),
  revision integer not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  unique (user_id, id),
  check (end_at > start_at),
  check ((start_at at time zone 'Asia/Shanghai')::date = (end_at at time zone 'Asia/Shanghai')::date)
);
create index fitness_appointments_active_range_idx on public.fitness_appointments(user_id,start_at,id) where deleted_at is null;
create table life_console_private.fitness_create_receipts (
  user_id uuid not null references auth.users(id) on delete restrict,
  operation_key text not null check (char_length(operation_key) between 16 and 200),
  fingerprint text not null,
  appointment_id uuid not null,
  created_at timestamptz not null default transaction_timestamp(),
  primary key (user_id, operation_key),
  foreign key (user_id,appointment_id) references public.fitness_appointments(user_id,id) on delete restrict
);
-- Reserved feed metadata only; phase A exposes no token or subscription API.
create table life_console_private.fitness_calendar_subscription (
  user_id uuid primary key references auth.users(id) on delete restrict,
  enabled boolean not null default false,
  token_hash text,
  include_notes boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  feed_revision integer not null default 0 check (feed_revision >= 0),
  updated_at timestamptz not null default transaction_timestamp(),
  check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  check (not enabled or token_hash is not null)
);
alter table life_console_private.fitness_owners enable row level security;
alter table life_console_private.fitness_create_receipts enable row level security;
alter table life_console_private.fitness_calendar_subscription enable row level security;
alter table public.fitness_appointments enable row level security;
revoke all on life_console_private.fitness_owners, life_console_private.fitness_create_receipts, life_console_private.fitness_calendar_subscription, public.fitness_appointments from public, anon, authenticated;
grant select on public.fitness_appointments to authenticated;

create function life_console_private.fitness_is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from life_console_private.fitness_owners where user_id=(select auth.uid()) and enabled)
$$;
revoke all on function life_console_private.fitness_is_owner() from public, anon, authenticated;
grant execute on function life_console_private.fitness_is_owner() to authenticated;
create policy fitness_appointments_select on public.fitness_appointments for select to authenticated
  using (user_id=(select auth.uid()) and (select life_console_private.fitness_is_owner()));

create function life_console_private.fitness_require_owner() returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not life_console_private.fitness_is_owner() then
    raise exception using errcode='42501', message='Active Owner authorization is required';
  end if;
  return auth.uid();
end $$;
revoke all on function life_console_private.fitness_require_owner() from public, anon, authenticated;

create function life_console_private.fitness_bump_feed(p_user_id uuid) returns void
language sql security definer set search_path = '' as $$
  insert into life_console_private.fitness_calendar_subscription(user_id,feed_revision)
  values(p_user_id,1)
  on conflict(user_id) do update set feed_revision=fitness_calendar_subscription.feed_revision+1,updated_at=transaction_timestamp()
$$;
revoke all on function life_console_private.fitness_bump_feed(uuid) from public, anon, authenticated;

create function public.create_fitness_appointment(
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
      raise exception using errcode='40001',message='Idempotency key has different input';
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

create function public.update_fitness_appointment(
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
  if v_row.deleted_at is not null then raise exception using errcode='40001',message='Appointment was deleted'; end if;
  if p_expected_revision is null or p_expected_revision <> v_row.revision then
    raise exception using errcode='40001',message='Appointment revision changed';
  end if;
  update public.fitness_appointments set title=btrim(p_title),start_at=p_start_at,end_at=p_end_at,
    location=coalesce(p_location,''),notes=coalesce(p_notes,''),revision=revision+1,updated_at=transaction_timestamp()
    where user_id=v_user and id=p_id returning * into v_row;
  perform life_console_private.fitness_bump_feed(v_user);
  insert into public.audit_events(user_id,action,entity_type,entity_id,result)
    values(v_user,'UPDATE','fitness_appointment',v_row.id::text,'success');
  return next v_row;
end $$;

create function public.soft_delete_fitness_appointment(p_id uuid,p_expected_revision integer)
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
    raise exception using errcode='40001',message='Expected revision is required';
  end if;
  if v_row.deleted_at is not null then return next v_row; return; end if;
  if p_expected_revision <> v_row.revision then raise exception using errcode='40001',message='Appointment revision changed'; end if;
  update public.fitness_appointments set deleted_at=transaction_timestamp(),revision=revision+1,updated_at=transaction_timestamp()
    where id=p_id and user_id=v_user returning * into v_row;
  perform life_console_private.fitness_bump_feed(v_user);
  insert into public.audit_events(user_id,action,entity_type,entity_id,result)
    values(v_user,'SOFT_DELETE','fitness_appointment',v_row.id::text,'success');
  return next v_row;
end $$;

create function public.get_fitness_appointment(p_id uuid) returns setof public.fitness_appointments
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := life_console_private.fitness_require_owner();
begin
  return query select * from public.fitness_appointments where user_id=v_user and id=p_id;
end $$;

create function public.list_fitness_appointments(p_from date,p_to date,p_cursor_start timestamptz default null,p_cursor_id uuid default null)
returns setof public.fitness_appointments
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := life_console_private.fitness_require_owner();
begin
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to-p_from>62 then
    raise exception using errcode='22023',message='Invalid calendar date range';
  end if;
  if (p_cursor_start is null) <> (p_cursor_id is null) or (p_cursor_start is not null and not isfinite(p_cursor_start)) then
    raise exception using errcode='22023',message='Invalid calendar cursor';
  end if;
  return query select a.* from public.fitness_appointments a
    where a.user_id=v_user and a.deleted_at is null
      and a.start_at >= (p_from::timestamp at time zone 'Asia/Shanghai')
      and a.start_at < (p_to::timestamp at time zone 'Asia/Shanghai')
      and (p_cursor_start is null or (a.start_at,a.id)>(p_cursor_start,p_cursor_id))
    order by a.start_at,a.id limit 101;
end $$;

revoke all on function public.create_fitness_appointment(text,text,timestamptz,timestamptz,text,text),
 public.update_fitness_appointment(uuid,integer,text,timestamptz,timestamptz,text,text),
 public.soft_delete_fitness_appointment(uuid,integer),public.get_fitness_appointment(uuid),
 public.list_fitness_appointments(date,date,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.create_fitness_appointment(text,text,timestamptz,timestamptz,text,text),
 public.update_fitness_appointment(uuid,integer,text,timestamptz,timestamptz,text,text),
 public.soft_delete_fitness_appointment(uuid,integer),public.get_fitness_appointment(uuid),
 public.list_fitness_appointments(date,date,timestamptz,uuid) to authenticated;
