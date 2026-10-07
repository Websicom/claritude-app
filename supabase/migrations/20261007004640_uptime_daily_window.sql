begin;

-- The 30-day uptime strip needs one compact record per local calendar day,
-- rather than every five-minute observation. PostgreSQL performs the grouping
-- so the Worker receives at most 30 rows for this UI.
create function public.uptime_daily_window(
  p_monitor_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_time_zone text default 'UTC'
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select coalesce(nullif(p_time_zone, ''), 'UTC') as time_zone
  ), grouped as (
    select
      date_trunc('day', timezone(p.time_zone, c.checked_at)) as day_local,
      count(*) filter (where not c.suppressed_by_maintenance)::bigint as total,
      count(*) filter (where not c.suppressed_by_maintenance and c.success)::bigint as successful,
      count(*) filter (where c.suppressed_by_maintenance)::bigint as suppressed,
      (array_agg(c.status_code order by c.checked_at desc)
        filter (where not c.suppressed_by_maintenance))[1] as status_code
    from public.uptime_checks c
    cross join params p
    where c.monitor_id = p_monitor_id
      and c.checked_at >= p_from
      and c.checked_at < p_to
    group by date_trunc('day', timezone(p.time_zone, c.checked_at))
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'day', to_char(day_local, 'YYYY-MM-DD'),
        'total', total,
        'successful', successful,
        'suppressed', suppressed,
        'statusCode', status_code
      )
      order by day_local
    ),
    '[]'::jsonb
  )
  from grouped;
$$;

revoke all on function public.uptime_daily_window(uuid,timestamptz,timestamptz,text)
  from public, anon;
grant execute on function public.uptime_daily_window(uuid,timestamptz,timestamptz,text)
  to authenticated, service_role;

comment on function public.uptime_daily_window(uuid,timestamptz,timestamptz,text)
  is 'Returns one compact uptime observation summary per local calendar day.';

commit;
