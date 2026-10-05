begin;

-- Return a compact response-time series and exact window summary. The graph
-- never needs every five-minute check for a long reporting range, so medians
-- are calculated in Postgres before the payload reaches the Worker/browser.
create function public.uptime_response_window(
  p_monitor_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_time_zone text default 'UTC',
  p_bucket text default 'day'
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      coalesce(nullif(p_time_zone, ''), 'UTC') as time_zone,
      case when p_bucket in ('hour', 'day', 'month') then p_bucket else 'day' end as bucket_kind
  ), eligible as materialized (
    select c.checked_at, c.success, c.response_ms
    from public.uptime_checks c
    where c.monitor_id = p_monitor_id
      and c.checked_at >= p_from
      and c.checked_at <= p_to
      and not c.suppressed_by_maintenance
  ), response_rows as (
    select
      e.checked_at,
      e.response_ms,
      p.bucket_kind,
      p.time_zone,
      case p.bucket_kind
        when 'hour' then date_trunc('hour', timezone(p.time_zone, e.checked_at))
        when 'month' then date_trunc('month', timezone(p.time_zone, e.checked_at))
        else date_trunc('day', timezone(p.time_zone, e.checked_at))
      end as bucket_local
    from eligible e
    cross join params p
    where e.success and e.response_ms is not null
  ), bucket_rows as (
    select
      bucket_kind,
      time_zone,
      bucket_local,
      percentile_cont(0.5) within group (order by response_ms)::numeric as median_response_ms,
      count(*)::bigint as samples
    from response_rows
    group by bucket_kind, time_zone, bucket_local
  ), series as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'label', case bucket_kind
          when 'hour' then to_char(bucket_local at time zone time_zone, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          when 'month' then to_char(bucket_local, 'YYYY-MM-01')
          else to_char(bucket_local, 'YYYY-MM-DD')
        end,
        'value', round(median_response_ms),
        'samples', samples
      ) order by bucket_local
    ), '[]'::jsonb) as value
    from bucket_rows
  ), summary as (
    select
      count(*)::bigint as total,
      count(*) filter (where success)::bigint as successful,
      case when count(*) > 0
        then round((count(*) filter (where success))::numeric / count(*)::numeric * 100, 4)
        else null
      end as availability,
      round(avg(response_ms) filter (where success and response_ms is not null))::bigint as average_response_ms,
      round(percentile_cont(0.5) within group (order by response_ms)
        filter (where success and response_ms is not null))::bigint as median_response_ms,
      max(response_ms) filter (where success and response_ms is not null)::bigint as highest_response_ms
    from eligible
  )
  select jsonb_build_object(
    'bucket', p.bucket_kind,
    'series', s.value,
    'summary', jsonb_build_object(
      'total', m.total,
      'successful', m.successful,
      'availability', m.availability,
      'averageResponseMs', m.average_response_ms,
      'medianResponseMs', m.median_response_ms,
      'highestResponseMs', m.highest_response_ms
    )
  )
  from params p
  cross join series s
  cross join summary m;
$$;

revoke all on function public.uptime_response_window(uuid,timestamptz,timestamptz,text,text)
  from public, anon;
grant execute on function public.uptime_response_window(uuid,timestamptz,timestamptz,text,text)
  to authenticated, service_role;

comment on function public.uptime_response_window(uuid,timestamptz,timestamptz,text,text)
  is 'Compact uptime response medians and exact summary for one monitor window.';

commit;
