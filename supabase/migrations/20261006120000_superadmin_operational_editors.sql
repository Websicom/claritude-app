-- Read-only database measurements for the privileged SuperAdmin operations desk.
-- The function remains unavailable to browser roles and executes with the
-- caller's permissions; the Worker service role is the only granted caller.

create or replace function public.superadmin_database_metrics()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'databaseSizeBytes', pg_database_size(current_database()),
    'activeConnections', (select count(*) from pg_stat_activity where datname = current_database()),
    'maxConnections', current_setting('max_connections')::integer,
    'accountsTableBytes', pg_total_relation_size('public.accounts'::regclass),
    'propertiesTableBytes', pg_total_relation_size('public.properties'::regclass),
    'analyticsTableBytes', pg_total_relation_size('public.analytics_events'::regclass),
    'auditTableBytes', pg_total_relation_size('public.audit_runs'::regclass),
    'measuredAt', now(),
    'source', 'postgres_reported'
  );
$$;

revoke all on function public.superadmin_database_metrics() from public, anon, authenticated;
grant execute on function public.superadmin_database_metrics() to service_role;
comment on function public.superadmin_database_metrics() is 'Bounded PostgreSQL-reported capacity metrics for the server-side SuperAdmin desk.';
