-- Subscription capabilities remain disabled until the Owner explicitly rotates.
-- The HTTP controller generates 32 random bytes and supplies only their SHA256.
create role fitness_feed_reader nologin noinherit;
grant usage on schema life_console_private to fitness_feed_reader;
create unique index fitness_subscription_token_unique on life_console_private.fitness_calendar_subscription(token_hash) where token_hash is not null;

create function public.get_fitness_subscription() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid := life_console_private.fitness_require_owner(); v_result jsonb;
begin
 select jsonb_build_object('enabled',enabled,'includeNotes',include_notes,'revision',revision) into v_result
 from life_console_private.fitness_calendar_subscription where user_id=v_user;
 return coalesce(v_result,jsonb_build_object('enabled',false,'includeNotes',false,'revision',0));
end $$;

create function public.rotate_fitness_subscription(p_expected_revision integer,p_include_notes boolean,p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid := life_console_private.fitness_require_owner(); v_revision integer;
begin
 if p_expected_revision is null or p_include_notes is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='Invalid subscription settings';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fitness:'||v_user::text,0));
 select revision into v_revision from life_console_private.fitness_calendar_subscription where user_id=v_user for update;
 if coalesce(v_revision,0)<>p_expected_revision then raise exception using errcode='PT409',message='Subscription changed'; end if;
 insert into life_console_private.fitness_calendar_subscription(user_id,enabled,token_hash,include_notes,revision,feed_revision)
 values(v_user,true,p_token_hash,p_include_notes,1,1)
 on conflict(user_id) do update set enabled=true,token_hash=p_token_hash,include_notes=p_include_notes,
 revision=fitness_calendar_subscription.revision+1,feed_revision=fitness_calendar_subscription.feed_revision+1,updated_at=transaction_timestamp();
 return public.get_fitness_subscription();
end $$;

create function public.update_fitness_subscription(p_expected_revision integer,p_enabled boolean,p_include_notes boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid := life_console_private.fitness_require_owner(); v_row life_console_private.fitness_calendar_subscription%rowtype;
begin
 if p_expected_revision is null or p_enabled is null or p_include_notes is null then raise exception using errcode='22023',message='Invalid subscription settings'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fitness:'||v_user::text,0));
 select * into v_row from life_console_private.fitness_calendar_subscription where user_id=v_user for update;
 if not found or v_row.revision<>p_expected_revision then raise exception using errcode='PT409',message='Subscription changed'; end if;
 if p_enabled and (not v_row.enabled or v_row.token_hash is null) then raise exception using errcode='22023',message='Rotate to enable subscription'; end if;
 update life_console_private.fitness_calendar_subscription set enabled=p_enabled,
 token_hash=case when p_enabled then token_hash else null end,include_notes=p_include_notes,
 revision=revision+1,feed_revision=feed_revision+1,updated_at=transaction_timestamp() where user_id=v_user;
 return public.get_fitness_subscription();
end $$;

create function life_console_private.read_fitness_feed(p_token_hash text) returns jsonb
language sql stable security definer set search_path='' as $$
 with subscription as (
  select s.* from life_console_private.fitness_calendar_subscription s
  join life_console_private.fitness_owners o on o.user_id=s.user_id and o.enabled
  where s.enabled and s.token_hash=p_token_hash and p_token_hash ~ '^[0-9a-f]{64}$'
 ), events as not materialized (
  select a.start_at,a.id,jsonb_build_object('id',a.id,'title',a.title,'startAt',a.start_at,'endAt',a.end_at,
   'location',a.location,'updatedAt',a.updated_at) || case when s.include_notes then jsonb_build_object('notes',a.notes) else '{}'::jsonb end item
  from public.fitness_appointments a join subscription s on a.user_id=s.user_id
  where a.deleted_at is null order by a.start_at,a.id limit 10001
 )
 select case when (select count(*)>10000 or coalesce(sum(octet_length(item::text)+2),0)>5241856 from events)
  then jsonb_build_object('error','budget_exceeded')
  else jsonb_build_object('sequence',s.feed_revision,'updatedAt',s.updated_at,
   'events',coalesce((select jsonb_agg(item order by start_at,id) from events),'[]'::jsonb)) end
 from subscription s
$$;
-- Budget is checked before jsonb_agg/transport, with 1024 bytes reserved for metadata.
-- NOT MATERIALIZED avoids retaining large projected rows while measuring.
-- An over-budget snapshot is a tiny sentinel which the HTTP service maps to 503.
revoke all on function public.get_fitness_subscription(),public.rotate_fitness_subscription(integer,boolean,text),public.update_fitness_subscription(integer,boolean,boolean),life_console_private.read_fitness_feed(text) from public,anon,authenticated;
grant execute on function public.get_fitness_subscription(),public.rotate_fitness_subscription(integer,boolean,text),public.update_fitness_subscription(integer,boolean,boolean) to authenticated;
grant execute on function life_console_private.read_fitness_feed(text) to fitness_feed_reader;
