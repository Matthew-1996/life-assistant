-- Life Console 2.2.0 Password Auth Setup
-- Execute this after creating and auto-confirming the sole Owner through
-- Supabase Dashboard -> Authentication -> Users.

do $$
declare
  v_owner_id uuid;
  v_owner_count integer;
  v_confirmed_owner_count integer;
begin
  select
    count(*),
    count(*) filter (where email_confirmed_at is not null)
  into v_owner_count, v_confirmed_owner_count
  from auth.users;

  if v_owner_count <> 1 or v_confirmed_owner_count <> 1 then
    raise exception using
      message = format(
        'Expected exactly one auto-confirmed Owner in Supabase Authentication > Users; found %s users and %s confirmed users',
        v_owner_count,
        v_confirmed_owner_count
      );
  end if;

  select id
  into v_owner_id
  from auth.users
  where email_confirmed_at is not null;

  insert into public.profiles (user_id, display_name, status)
  values (v_owner_id, 'Owner', 'active')
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        status = excluded.status,
        updated_at = now();

  raise notice 'Owner profile is ready';
end
$$;
