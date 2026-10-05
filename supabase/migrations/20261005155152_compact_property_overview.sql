begin;

-- Property Overview needs a compact summary, not the raw per-view evidence used
-- by the Analytics drill-down. Completed UTC days come from the existing
-- rollups; partial/current days come from raw events so figures remain exact.
create or replace function public.analytics_property_overview(
  p_property_id uuid,
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
    select
      p_from as from_at,
      p_to as to_at,
      coalesce(nullif(p_time_zone, ''), 'UTC') as time_zone
  ), rolled_days as (
    select d.day
    from public.analytics_rollup_days d, params p
    where d.property_id = p_property_id
      and (d.day::timestamp at time zone 'UTC') >= p.from_at
      and ((d.day + 1)::timestamp at time zone 'UTC') <= p.to_at + interval '1 millisecond'
  ), compact_events as materialized (
    select
      h.bucket_start as occurred_at,
      h.event_type,
      h.path,
      h.name,
      h.device,
      h.tracker_version,
      h.event_count,
      h.values_json
    from public.analytics_hourly h, params p
    where h.property_id = p_property_id
      and h.bucket_start >= p.from_at
      and h.bucket_start <= p.to_at
      and exists (select 1 from rolled_days d where d.day = h.bucket_start::date)

    union all

    select
      e.occurred_at,
      e.event_type,
      e.path,
      coalesce(e.name, ''),
      coalesce(e.device, ''),
      coalesce(e.metadata ->> 'tracker_version', ''),
      1::bigint,
      case
        when e.event_type = 'web_vital' and e.value is not null then jsonb_build_array(e.value)
        else '[]'::jsonb
      end
    from public.analytics_events e, params p
    where e.property_id = p_property_id
      and e.occurred_at >= p.from_at
      and e.occurred_at <= p.to_at
      and not exists (select 1 from rolled_days d where d.day = e.occurred_at::date)
  ), session_observations as materialized (
    select v.occurred_at, nullif(v.session_id, '') as session_id
    from public.analytics_view_daily v, params p
    where v.property_id = p_property_id
      and v.occurred_at >= p.from_at
      and v.occurred_at <= p.to_at
      and v.tracker_version in ('2.0.0', '2.1.0', '2.1.1', '2.1.2', '2.1.3', '2.1.4', '2.1.5')
      and exists (select 1 from rolled_days d where d.day = v.day)

    union all

    select e.occurred_at, nullif(e.metadata ->> 'session', '')
    from public.analytics_events e, params p
    where e.property_id = p_property_id
      and e.event_type = 'pageview'
      and e.occurred_at >= p.from_at
      and e.occurred_at <= p.to_at
      and not exists (select 1 from rolled_days d where d.day = e.occurred_at::date)
  ), totals as (
    select
      coalesce(sum(event_count) filter (where event_type = 'pageview'), 0)::bigint as pageviews,
      coalesce(sum(event_count) filter (where event_type in ('click', 'outbound', 'form_success')), 0)::bigint as key_events
    from compact_events
  ), event_series as (
    select
      timezone(p.time_zone, e.occurred_at)::date as day,
      coalesce(sum(e.event_count) filter (where e.event_type = 'pageview'), 0)::bigint as pageviews,
      coalesce(sum(e.event_count) filter (where e.event_type in ('click', 'outbound', 'form_success')), 0)::bigint as events
    from compact_events e, params p
    group by timezone(p.time_zone, e.occurred_at)::date
  ), session_series as (
    select
      timezone(p.time_zone, s.occurred_at)::date as day,
      count(distinct s.session_id) filter (where s.session_id is not null)::bigint as visitors
    from session_observations s, params p
    group by timezone(p.time_zone, s.occurred_at)::date
  ), calendar as (
    select generate_series(
      timezone(p.time_zone, p.from_at)::date,
      timezone(p.time_zone, p.to_at)::date,
      interval '1 day'
    )::date as day
    from params p
  ), series as (
    select jsonb_agg(
      jsonb_build_object(
        'day', c.day,
        'pageviews', coalesce(e.pageviews, 0),
        'events', coalesce(e.events, 0),
        'dailyVisitors', coalesce(s.visitors, 0)
      ) order by c.day
    ) as value
    from calendar c
    left join event_series e using (day)
    left join session_series s using (day)
  ), page_rows as (
    select
      coalesce(nullif(path, ''), '/') as path,
      sum(event_count) filter (where event_type = 'pageview')::bigint as pageviews,
      coalesce(sum(event_count) filter (where event_type in ('click', 'outbound', 'form_success')), 0)::bigint as events
    from compact_events
    where event_type = 'pageview' or event_type in ('click', 'outbound', 'form_success')
    group by coalesce(nullif(path, ''), '/')
  ), pages as (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.pageviews desc, r.path), '[]'::jsonb) as value
    from (
      select path, pageviews, events
      from page_rows
      where pageviews > 0
      order by pageviews desc, path
      limit 5
    ) r
  ), vital_values as (
    select
      upper(e.name) as name,
      lower(coalesce(nullif(e.device, ''), 'unknown')) as device,
      (sample.value #>> '{}')::numeric as value
    from compact_events e
    cross join lateral jsonb_array_elements(e.values_json) sample(value)
    where e.event_type = 'web_vital'
      and e.name <> ''
      and e.tracker_version in ('2.0.0', '2.1.0', '2.1.1', '2.1.2', '2.1.3', '2.1.4', '2.1.5')
      and jsonb_typeof(sample.value) = 'number'
  ), vital_rows as (
    select
      name,
      percentile_disc(0.75) within group (order by value) as value,
      count(*)::bigint as samples
    from vital_values
    group by name
  ), vitals as (
    select coalesce(jsonb_agg(
      jsonb_build_object('name', name, 'value', value, 'samples', samples, 'percentile', 75)
      order by name
    ), '[]'::jsonb) as value
    from vital_rows
  ), device_vital_rows as (
    select
      device,
      name,
      percentile_disc(0.75) within group (order by value) as value,
      count(*)::bigint as samples
    from vital_values
    group by device, name
  ), device_groups as (
    select
      device,
      jsonb_build_object(
        'vitals', jsonb_agg(
          jsonb_build_object('name', name, 'value', value, 'samples', samples, 'percentile', 75)
          order by name
        ),
        'minimumSamples', 1,
        'method', 'p75',
        'collectionStatus', 'available',
        'trackerVersion', '2.1.5'
      ) as payload
    from device_vital_rows
    group by device
  ), performance_by_device as (
    select coalesce(jsonb_object_agg(device, payload), '{}'::jsonb) as value
    from device_groups
  )
  select jsonb_build_object(
    'from', p.from_at,
    'to', p.to_at,
    'timeZone', p.time_zone,
    'pageviews', t.pageviews,
    'keyEvents', t.key_events,
    'sessions', (select count(distinct session_id) from session_observations where session_id is not null),
    'series', coalesce(s.value, '[]'::jsonb),
    'pages', pg.value,
    'vitals', v.value,
    'performanceByDevice', pd.value
  )
  from params p
  cross join totals t
  cross join series s
  cross join pages pg
  cross join vitals v
  cross join performance_by_device pd;
$$;

create index if not exists analytics_view_daily_property_day_overview_idx
  on public.analytics_view_daily (property_id, day)
  include (occurred_at, session_id, tracker_version);

revoke all on function public.analytics_property_overview(uuid,timestamptz,timestamptz,text)
  from public, anon;
grant execute on function public.analytics_property_overview(uuid,timestamptz,timestamptz,text)
  to authenticated, service_role;

commit;
