-- The ownership-leading query index is not a covering index for FK checks.
-- Add the exact child-side foreign-key index required by Postgres and the
-- Supabase performance advisor.

create index health_segments_health_day_id_idx
  on public.health_segments (health_day_id);
