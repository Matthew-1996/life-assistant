-- Preserve date-only semantics for Shanghai all-day appointments.
create or replace function life_console_private.read_fitness_feed(p_token_hash text) returns jsonb
language sql stable security definer set search_path='' as $$
 with subscription as (
  select s.* from life_console_private.fitness_calendar_subscription s
  join life_console_private.fitness_owners o on o.user_id=s.user_id and o.enabled
  where s.enabled and s.token_hash=p_token_hash and p_token_hash ~ '^[0-9a-f]{64}$'
 ), events as not materialized (
  select a.start_at,a.id,jsonb_build_object('id',a.id,'title',a.title,'startAt',a.start_at,'endAt',a.end_at,
   'location',a.location,'updatedAt',a.updated_at,'timeKind',a.time_kind) || case when a.time_kind='all_day' then jsonb_build_object('startDate',(a.start_at at time zone 'Asia/Shanghai')::date,'endDate',(a.end_at at time zone 'Asia/Shanghai')::date) else '{}'::jsonb end || case when s.include_notes then jsonb_build_object('notes',a.notes) else '{}'::jsonb end item
  from public.fitness_appointments a join subscription s on a.user_id=s.user_id
  where a.deleted_at is null order by a.start_at,a.id limit 10001
 )
 select case when (select count(*)>10000 or coalesce(sum(octet_length(item::text)+2),0)>5241856 from events)
  then jsonb_build_object('error','budget_exceeded')
  else jsonb_build_object('sequence',s.feed_revision,'updatedAt',s.updated_at,
   'events',coalesce((select jsonb_agg(item order by start_at,id) from events),'[]'::jsonb)) end
 from subscription s
$$;

-- CREATE OR REPLACE retains the restricted feed-reader ACL.
