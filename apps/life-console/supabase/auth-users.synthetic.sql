-- Hosted synthetic Auth placeholders for the Stage E RLS matrix.
-- Supabase documents this seed form for test users. These rows have no
-- password or identity and therefore cannot sign in. Browser OTP acceptance
-- requires a separately approved, receivable synthetic address.

do $$
declare
  v_owner_a_count integer;
  v_owner_b_count integer;
  v_owner_a uuid;
  v_owner_b uuid;
begin
  select count(*) into v_owner_a_count
  from auth.users
  where raw_user_meta_data ->> 'life_console_synthetic_owner' = 'A';
  select count(*) into v_owner_b_count
  from auth.users
  where raw_user_meta_data ->> 'life_console_synthetic_owner' = 'B';

  if v_owner_a_count = 1 and v_owner_b_count = 1 then
    return;
  end if;
  if v_owner_a_count <> 0 or v_owner_b_count <> 0 then
    raise exception using
      errcode = '22023',
      message = 'Synthetic Auth placeholders are incomplete or duplicated';
  end if;

  v_owner_a := gen_random_uuid();
  v_owner_b := gen_random_uuid();

  insert into auth.users (id, email, raw_user_meta_data)
  values
    (
      v_owner_a,
      'life-console-a-' || replace(v_owner_a::text, '-', '')
        || '@example.invalid',
      '{"life_console_synthetic_owner":"A"}'::jsonb
    ),
    (
      v_owner_b,
      'life-console-b-' || replace(v_owner_b::text, '-', '')
        || '@example.invalid',
      '{"life_console_synthetic_owner":"B"}'::jsonb
    );
end
$$;
