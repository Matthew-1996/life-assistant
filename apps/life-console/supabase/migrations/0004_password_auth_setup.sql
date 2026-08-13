-- Life Console 2.2.0 Password Auth Setup
-- Execute this in Supabase Dashboard → SQL Editor
-- This sets up the synthetic Owner user with a password for testing

-- 1. Create or update synthetic Owner user with password
do $$
declare
  v_owner_id uuid;
  v_existing_user record;
  v_synthetic_email text := 'owner@life-console.test';
  v_initial_password text := 'synthetic-test-pass-2026!';
begin
  -- Check if user already exists
  select id, encrypted_password is not null as has_password
  into v_existing_user
  from auth.users
  where email = v_synthetic_email;

  if not found then
    -- Create new user with password
    v_owner_id := gen_random_uuid();
    insert into auth.users (
      id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    ) values (
      v_owner_id,
      v_synthetic_email,
      crypt(v_initial_password, gen_salt('bf')),
      now(),
      '{"life_console_synthetic_owner":"primary"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    );

    -- Create profile for the user
    insert into public.profiles (user_id, display_name, status)
    values (v_owner_id, 'Synthetic Owner', 'active')
    on conflict (user_id) do nothing;

    raise notice 'Created synthetic Owner user: %', v_synthetic_email;
  else
    -- Update existing user's password
    v_owner_id := v_existing_user.id;
    update auth.users
    set encrypted_password = crypt(v_initial_password, gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
    where id = v_owner_id;

    raise notice 'Updated password for existing Owner user: %', v_synthetic_email;
  end if;

  -- Ensure profile exists
  insert into public.profiles (user_id, display_name, status)
  values (v_owner_id, 'Synthetic Owner', 'active')
  on conflict (user_id) do update set updated_at = now();

  raise notice 'Setup complete. Use credentials: % / %', v_synthetic_email, v_initial_password;
end
$$;
