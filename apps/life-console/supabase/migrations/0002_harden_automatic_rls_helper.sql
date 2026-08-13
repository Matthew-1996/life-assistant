-- The optional Supabase automatic-RLS setting creates this trigger helper in
-- public. Triggers do not require API roles to execute the function directly,
-- so remove its Data API execution surface when the helper is present.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute
      'revoke all on function public.rls_auto_enable() '
      'from public, anon, authenticated';
  end if;
end
$$;
