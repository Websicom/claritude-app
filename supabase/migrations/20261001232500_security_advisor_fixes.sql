-- Remove the dashboard-created helper after it enabled RLS on the private ledger.
alter table private.app_migrations enable row level security;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
drop function if exists public.rls_auto_enable();

insert into private.app_migrations(version,name,checksum) values
  ('20261001232500','security_advisor_fixes','self')
on conflict(version) do nothing;

-- complete_onboarding is intentionally SECURITY DEFINER because it creates the
-- first account boundary. It is denied to PUBLIC/anon, granted only to
-- authenticated, checks auth.uid(), and rejects users already in an account.
