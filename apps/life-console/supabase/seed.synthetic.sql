-- Synthetic-only seed for Life Console Supabase tests.
-- Never use this file for production or personal data.
--
-- Hosted Supabase: resolve exactly two pre-created Auth users from the
-- life_console_synthetic_owner metadata label. Never insert into auth.users.
-- PGlite tests: auth.users has no metadata column, so fixed local-only UUIDs
-- are inserted into the compatibility shim.

do $$
declare
  v_has_hosted_metadata boolean;
  v_owner_a uuid;
  v_owner_b uuid;
  v_owner_a_ids uuid[];
  v_owner_b_ids uuid[];
  v_owner_a_health_day bigint;
  v_owner_b_health_day bigint;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'auth'
      and table_name = 'users'
      and column_name = 'raw_user_meta_data'
  ) into v_has_hosted_metadata;

  if v_has_hosted_metadata then
    execute $query$
      select array_agg(id order by id)
      from auth.users
      where raw_user_meta_data ->> 'life_console_synthetic_owner' = 'A'
    $query$ into v_owner_a_ids;
    execute $query$
      select array_agg(id order by id)
      from auth.users
      where raw_user_meta_data ->> 'life_console_synthetic_owner' = 'B'
    $query$ into v_owner_b_ids;

    if cardinality(v_owner_a_ids) <> 1
      or cardinality(v_owner_b_ids) <> 1
    then
      raise exception using
        errcode = '22023',
        message = 'Synthetic seed requires exactly one tagged Auth user per owner';
    end if;
    v_owner_a := v_owner_a_ids[1];
    v_owner_b := v_owner_b_ids[1];
  else
    v_owner_a := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    v_owner_b := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    insert into auth.users (id) values (v_owner_a), (v_owner_b)
    on conflict (id) do nothing;
  end if;

  if not exists (
    select 1 from public.idempotency_keys
    where user_id = v_owner_a and key = 'synthetic-key-alpha-0001'
  ) then
    insert into public.profiles (user_id, display_name)
    values (v_owner_a, 'Synthetic Owner A');

    insert into public.goals (user_id, title, domain, status, priority)
    values (v_owner_a, 'Synthetic Goal Alpha', 'test', 'active', 1);

    insert into public.journals (user_id, event_date, title, content)
    values (
      v_owner_a,
      date '2030-01-01',
      'Synthetic Alpha',
      'alpha payload'
    );

    insert into public.daily_checkins (
      user_id, checkin_date, sleep_quality, energy, mood, life_feeling
    ) values (v_owner_a, date '2030-01-01', 4, 3, null, 3);

    insert into public.weekly_reviews (user_id, week_start, content)
    values (
      v_owner_a,
      date '2029-12-31',
      'synthetic weekly alpha'
    );

    insert into public.phase_reviews (
      user_id, period_start, period_end, content
    ) values (
      v_owner_a,
      date '2030-01-01',
      date '2030-01-07',
      'synthetic phase alpha'
    );

    insert into public.health_days (
      user_id, health_date, summary, source_revision
    ) values (
      v_owner_a,
      date '2030-01-01',
      '{"steps": 1234}',
      'synthetic-a'
    ) returning id into v_owner_a_health_day;

    insert into public.health_segments (
      user_id, health_day_id, start_at, end_at, source, details
    ) values (
      v_owner_a,
      v_owner_a_health_day,
      timestamptz '2030-01-01 00:00:00+00',
      timestamptz '2030-01-01 01:00:00+00',
      'synthetic',
      '{"kind": "test"}'
    );

    insert into public.backup_runs (
      user_id,
      status,
      manifest_version,
      record_counts,
      content_digest,
      completed_at
    ) values (
      v_owner_a,
      'success',
      1,
      '{"journals": 1}',
      'synthetic-alpha-digest',
      now()
    );

    insert into public.audit_events (
      user_id, action, entity_type, entity_id, result
    ) values (
      v_owner_a, 'CREATE', 'synthetic', 'alpha', 'success'
    );

    insert into public.idempotency_keys (
      user_id, key, operation, result_ref, expires_at
    ) values (
      v_owner_a,
      'synthetic-key-alpha-0001',
      'seed',
      '{"ok": true}',
      timestamptz '2030-01-02 00:00:00+00'
    );
  end if;

  if not exists (
    select 1 from public.idempotency_keys
    where user_id = v_owner_b and key = 'synthetic-key-beta-0001'
  ) then
    insert into public.profiles (user_id, display_name)
    values (v_owner_b, 'Synthetic Owner B');

    insert into public.goals (user_id, title, domain, status, priority)
    values (v_owner_b, 'Synthetic Goal Beta', 'test', 'active', 1);

    insert into public.journals (user_id, event_date, title, content)
    values (
      v_owner_b,
      date '2030-01-01',
      'Synthetic Beta',
      'beta payload'
    );

    insert into public.daily_checkins (
      user_id, checkin_date, sleep_quality, energy, mood, life_feeling
    ) values (v_owner_b, date '2030-01-01', 3, 3, 3, null);

    insert into public.weekly_reviews (user_id, week_start, content)
    values (
      v_owner_b,
      date '2029-12-31',
      'synthetic weekly beta'
    );

    insert into public.phase_reviews (
      user_id, period_start, period_end, content
    ) values (
      v_owner_b,
      date '2030-01-01',
      date '2030-01-07',
      'synthetic phase beta'
    );

    insert into public.health_days (
      user_id, health_date, summary, source_revision
    ) values (
      v_owner_b,
      date '2030-01-01',
      '{"steps": 2345}',
      'synthetic-b'
    ) returning id into v_owner_b_health_day;

    insert into public.health_segments (
      user_id, health_day_id, start_at, end_at, source, details
    ) values (
      v_owner_b,
      v_owner_b_health_day,
      timestamptz '2030-01-01 00:00:00+00',
      timestamptz '2030-01-01 01:00:00+00',
      'synthetic',
      '{"kind": "test"}'
    );

    insert into public.backup_runs (
      user_id,
      status,
      manifest_version,
      record_counts,
      content_digest,
      completed_at
    ) values (
      v_owner_b,
      'success',
      1,
      '{"journals": 1}',
      'synthetic-beta-digest',
      now()
    );

    insert into public.audit_events (
      user_id, action, entity_type, entity_id, result
    ) values (
      v_owner_b, 'CREATE', 'synthetic', 'beta', 'success'
    );

    insert into public.idempotency_keys (
      user_id, key, operation, result_ref, expires_at
    ) values (
      v_owner_b,
      'synthetic-key-beta-0001',
      'seed',
      '{"ok": true}',
      timestamptz '2030-01-02 00:00:00+00'
    );
  end if;
end
$$;
