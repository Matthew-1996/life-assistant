-- Migration tracking tables for private data import.
-- These tables are only accessible to the service_role for migration scripts.

create table public.migration_runs (
  id uuid primary key,
  manifest_digest text not null check (char_length(manifest_digest) = 64),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'rolled_back'))
);

create table public.migration_imports (
  id bigint generated always as identity primary key,
  migration_run_id uuid not null references public.migration_runs(id) on delete cascade,
  table_name text not null,
  source_stable_id text not null,
  imported_id bigint not null,
  imported_at timestamptz not null default now(),
  unique (migration_run_id, table_name, source_stable_id)
);

create index migration_runs_started_at_idx
  on public.migration_runs (started_at desc, id desc);
create index migration_imports_run_table_idx
  on public.migration_imports (migration_run_id, table_name, source_stable_id);

alter table public.migration_runs enable row level security;
alter table public.migration_imports enable row level security;

revoke all on public.migration_runs from anon, authenticated;
revoke all on public.migration_imports from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select, insert, update, delete on public.migration_runs to service_role;
grant select, insert, update, delete on public.migration_imports to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select, insert, update, delete on public.goals to service_role;
grant select, insert, update, delete on public.journals to service_role;
grant select, insert, update, delete on public.journal_revisions to service_role;
grant select, insert, update, delete on public.daily_checkins to service_role;
grant select, insert, update, delete on public.weekly_reviews to service_role;
grant select, insert, update, delete on public.phase_reviews to service_role;
grant select, insert, update, delete on public.health_days to service_role;
grant select, insert, update, delete on public.health_segments to service_role;
grant select, insert, update on public.profiles to service_role;
