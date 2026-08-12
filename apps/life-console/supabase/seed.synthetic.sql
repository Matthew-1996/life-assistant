-- Synthetic-only seed for local Life Console Supabase tests.
-- Never use this file for production or personal data.

insert into auth.users (id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

insert into public.profiles (user_id, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Synthetic Owner A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Synthetic Owner B');

insert into public.goals (user_id, title, domain, status, priority) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Synthetic Goal Alpha', 'test', 'active', 1),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Synthetic Goal Beta', 'test', 'active', 1);

insert into public.journals (user_id, event_date, title, content) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', date '2030-01-01', 'Synthetic Alpha', 'alpha payload'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', date '2030-01-01', 'Synthetic Beta', 'beta payload');

insert into public.journal_revisions (
  user_id,
  journal_id,
  revision,
  snapshot,
  reason
)
select
  user_id,
  id,
  revision,
  jsonb_build_object('title', title, 'content', content),
  'synthetic seed'
from public.journals;

insert into public.daily_checkins (
  user_id,
  checkin_date,
  sleep_quality,
  energy,
  mood,
  life_feeling
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', date '2030-01-01', 8.2, 7.1, null, 6.8),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', date '2030-01-01', 6.4, 6.2, 6.0, null);

insert into public.weekly_reviews (user_id, week_start, content) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', date '2029-12-31', 'synthetic weekly alpha'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', date '2029-12-31', 'synthetic weekly beta');

insert into public.phase_reviews (
  user_id,
  period_start,
  period_end,
  content
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', date '2030-01-01', date '2030-01-07', 'synthetic phase alpha'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', date '2030-01-01', date '2030-01-07', 'synthetic phase beta');

insert into public.health_days (
  user_id,
  health_date,
  summary,
  source_revision
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', date '2030-01-01', '{"steps": 1234}', 'synthetic-a'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', date '2030-01-01', '{"steps": 2345}', 'synthetic-b');

insert into public.health_segments (
  user_id,
  health_day_id,
  start_at,
  end_at,
  source,
  details
)
select
  user_id,
  id,
  timestamptz '2030-01-01 00:00:00+00',
  timestamptz '2030-01-01 01:00:00+00',
  'synthetic',
  '{"kind": "test"}'
from public.health_days;

insert into public.idempotency_keys (
  user_id,
  key,
  operation,
  result_ref,
  expires_at
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'synthetic-key-alpha-0001', 'seed', '{"ok": true}', timestamptz '2030-01-02 00:00:00+00'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'synthetic-key-beta-0001', 'seed', '{"ok": true}', timestamptz '2030-01-02 00:00:00+00');

insert into public.backup_runs (
  user_id,
  status,
  manifest_version,
  record_counts,
  content_digest,
  completed_at
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'success', 1, '{"journals": 1}', 'synthetic-alpha-digest', now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'success', 1, '{"journals": 1}', 'synthetic-beta-digest', now());

insert into public.audit_events (
  user_id,
  action,
  entity_type,
  entity_id,
  result
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'CREATE', 'synthetic', 'alpha', 'success'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'CREATE', 'synthetic', 'beta', 'success');
