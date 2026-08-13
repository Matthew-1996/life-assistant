-- Life Console 2.2.0 Password Auth Setup
-- Execute this after creating and auto-confirming the synthetic Owner through
-- Supabase Dashboard -> Authentication -> Users.

do $$
declare
  v_owner_id uuid;
  v_synthetic_email text := 'owner@life-console.test';
begin
  select id
  into v_owner_id
  from auth.users
  where email = v_synthetic_email;

  if v_owner_id is null then
    raise exception using
      message = format(
        'Create and auto-confirm %s through Supabase Authentication > Users before running this migration',
        v_synthetic_email
      );
  end if;

  insert into public.profiles (user_id, display_name, status)
  values (v_owner_id, 'Synthetic Owner', 'active')
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        status = excluded.status,
        updated_at = now();

  raise notice 'Synthetic Owner profile is ready for %', v_synthetic_email;
end
$$;
