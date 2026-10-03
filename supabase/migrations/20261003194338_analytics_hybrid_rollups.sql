begin;

-- Compact, mergeable analytics facts for completed UTC days. The raw event
-- table remains the source of truth for the current day and filtered drilldowns.
create table public.analytics_hourly (
  property_id uuid not null references public.properties on delete cascade,
  bucket_start timestamptz not null,
  dimension_key text not null,
  event_type text not null,
  path text not null,
  name text not null default '',
  device text not null default '',
  source text not null default '',
  source_category text not null default '',
  source_type text not null default '',
  referrer_host text not null default '',
  country_code text not null default '',
  browser text not null default '',
  screen text not null default '',
  utm_source text not null default '',
  utm_medium text not null default '',
  utm_campaign text not null default '',
  tracker_version text not null default '',
  event_count bigint not null check (event_count > 0),
  value_sum numeric,
  values_json jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  primary key (property_id, bucket_start, dimension_key)
);

create index analytics_hourly_property_bucket_idx
  on public.analytics_hourly (property_id, bucket_start);

create table public.analytics_view_daily (
  property_id uuid not null references public.properties on delete cascade,
  day date not null,
  view_key text not null,
  occurred_at timestamptz not null,
  path text not null,
  device text not null default '',
  source text not null default '',
  source_category text not null default '',
  source_type text not null default '',
  referrer_host text not null default '',
  country_code text not null default '',
  browser text not null default '',
  screen text not null default '',
  utm_source text not null default '',
  utm_medium text not null default '',
  utm_campaign text not null default '',
  tracker_version text not null default '',
  session_id text not null default '',
  active_seconds numeric not null default 0,
  max_scroll numeric not null default 0,
  key_events bigint not null default 0,
  javascript_errors bigint not null default 0,
  visible_sections text[] not null default '{}',
  vitals jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  primary key (property_id, day, view_key)
);

create index analytics_view_daily_property_day_path_idx
  on public.analytics_view_daily (property_id, day, path);

create table public.analytics_rollup_days (
  property_id uuid not null references public.properties on delete cascade,
  day date not null,
  raw_event_count bigint not null default 0,
  generated_at timestamptz not null default now(),
  primary key (property_id, day)
);

create index if not exists analytics_events_occurred_at_idx
  on public.analytics_events (occurred_at);

alter table public.analytics_hourly enable row level security;
alter table public.analytics_view_daily enable row level security;
alter table public.analytics_rollup_days enable row level security;

revoke all on public.analytics_hourly, public.analytics_view_daily, public.analytics_rollup_days
  from anon, authenticated;
grant select on public.analytics_hourly, public.analytics_view_daily, public.analytics_rollup_days
  to authenticated;

create policy analytics_hourly_select
  on public.analytics_hourly for select to authenticated
  using ((select private.can_access_property(property_id)));

create policy analytics_view_daily_select
  on public.analytics_view_daily for select to authenticated
  using ((select private.can_access_property(property_id)));

create policy analytics_rollup_days_select
  on public.analytics_rollup_days for select to authenticated
  using ((select private.can_access_property(property_id)));

create or replace function public.aggregate_analytics_day_v2(p_day date)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_start timestamptz := p_day::timestamptz;
  v_end timestamptz := (p_day + 1)::timestamptz;
  v_hourly bigint := 0;
  v_views bigint := 0;
begin
  delete from public.analytics_hourly
  where bucket_start >= v_start and bucket_start < v_end;

  with normalized as (
    select
      e.property_id,
      date_trunc('hour', e.occurred_at) as bucket_start,
      e.event_type,
      e.path,
      coalesce(e.name, '') as name,
      coalesce(e.device, '') as device,
      coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), 'Direct / unknown') as source,
      case
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) in ('', 'direct', 'direct / unknown') then 'Direct / unknown'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) like '%google%' then 'Google'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) like '%linkedin%' then 'LinkedIn'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) like '%instagram%' then 'Instagram'
        else 'Other referrals'
      end as source_category,
      case
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) in ('', 'direct', 'direct / unknown') then 'Direct'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) like '%google%' then 'Search'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) like '%linkedin%'
          or lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) like '%instagram%' then 'Social'
        else coalesce(nullif(e.metadata ->> 'utm_medium', ''), 'Referral')
      end as source_type,
      coalesce(e.referrer_host, '') as referrer_host,
      coalesce(e.country_code, '') as country_code,
      coalesce(e.metadata ->> 'browser', '') as browser,
      coalesce(e.metadata ->> 'screen', '') as screen,
      coalesce(e.metadata ->> 'utm_source', '') as utm_source,
      coalesce(e.metadata ->> 'utm_medium', '') as utm_medium,
      coalesce(e.metadata ->> 'utm_campaign', '') as utm_campaign,
      coalesce(e.metadata ->> 'tracker_version', '') as tracker_version,
      e.value,
      e.occurred_at
    from public.analytics_events e
    where e.occurred_at >= v_start and e.occurred_at < v_end
  )
  insert into public.analytics_hourly (
    property_id, bucket_start, dimension_key, event_type, path, name, device, source,
    source_category, source_type, referrer_host, country_code, browser, screen,
    utm_source, utm_medium, utm_campaign, tracker_version, event_count,
    value_sum, values_json, generated_at
  )
  select
    property_id,
    bucket_start,
    md5(jsonb_build_array(
      event_type, path, name, device, source, source_category, source_type,
      referrer_host, country_code, browser, screen, utm_source, utm_medium,
      utm_campaign, tracker_version
    )::text),
    event_type, path, name, device, source,
    source_category, source_type, referrer_host, country_code, browser, screen,
    utm_source, utm_medium, utm_campaign, tracker_version,
    count(*)::bigint,
    sum(value),
    case
      when event_type = 'web_vital'
        then coalesce(jsonb_agg(value order by occurred_at) filter (where value is not null), '[]'::jsonb)
      else '[]'::jsonb
    end,
    now()
  from normalized
  group by
    property_id, bucket_start, event_type, path, name, device, source,
    source_category, source_type, referrer_host, country_code, browser, screen,
    utm_source, utm_medium, utm_campaign, tracker_version;

  get diagnostics v_hourly = row_count;

  delete from public.analytics_view_daily where day = p_day;

  with pageview_base as (
    select
      e.id,
      e.property_id,
      p_day as day,
      coalesce(nullif(e.metadata ->> 'view_id', ''), 'legacy:' || e.id::text) as view_key,
      nullif(e.metadata ->> 'view_id', '') as signal_view_id,
      e.occurred_at,
      e.path,
      coalesce(e.device, '') as device,
      coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), 'Direct / unknown') as source,
      case
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) in ('', 'direct', 'direct / unknown') then 'Direct / unknown'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) like '%google%' then 'Google'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) like '%linkedin%' then 'LinkedIn'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) like '%instagram%' then 'Instagram'
        else 'Other referrals'
      end as source_category,
      case
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) in ('', 'direct', 'direct / unknown') then 'Direct'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) like '%google%' then 'Search'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) like '%linkedin%'
          or lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) like '%instagram%' then 'Social'
        else coalesce(nullif(e.metadata ->> 'utm_medium', ''), 'Referral')
      end as source_type,
      coalesce(e.referrer_host, '') as referrer_host,
      coalesce(e.country_code, '') as country_code,
      coalesce(e.metadata ->> 'browser', '') as browser,
      coalesce(e.metadata ->> 'screen', '') as screen,
      coalesce(e.metadata ->> 'utm_source', '') as utm_source,
      coalesce(e.metadata ->> 'utm_medium', '') as utm_medium,
      coalesce(e.metadata ->> 'utm_campaign', '') as utm_campaign,
      coalesce(e.metadata ->> 'tracker_version', '') as tracker_version,
      coalesce(e.metadata ->> 'session', '') as session_id
    from public.analytics_events e
    where e.event_type = 'pageview'
      and e.occurred_at >= v_start and e.occurred_at < v_end
  ), pageviews as (
    select distinct on (property_id, view_key) *
    from pageview_base
    order by property_id, view_key, occurred_at, id
  ), signal_totals as (
    select
      e.property_id,
      e.metadata ->> 'view_id' as view_key,
      coalesce(sum(e.value) filter (where e.event_type = 'active_time'), 0) as active_seconds,
      coalesce(max(e.value) filter (where e.event_type = 'scroll'), 0) as max_scroll,
      count(*) filter (where e.event_type in ('click', 'outbound', 'form_success'))::bigint as key_events,
      count(*) filter (where e.event_type = 'js_error')::bigint as javascript_errors
    from public.analytics_events e
    where e.occurred_at >= v_start and e.occurred_at < v_end + interval '6 hours'
      and nullif(e.metadata ->> 'view_id', '') is not null
    group by e.property_id, e.metadata ->> 'view_id'
  ), visible as (
    select
      e.property_id,
      e.metadata ->> 'view_id' as view_key,
      array_agg(distinct e.name order by e.name) filter (where e.name is not null) as visible_sections
    from public.analytics_events e
    where e.event_type = 'visible_section'
      and e.occurred_at >= v_start and e.occurred_at < v_end + interval '6 hours'
      and nullif(e.metadata ->> 'view_id', '') is not null
    group by e.property_id, e.metadata ->> 'view_id'
  ), vital_values as (
    select
      e.property_id,
      e.metadata ->> 'view_id' as view_key,
      upper(e.name) as metric,
      jsonb_agg(e.value order by e.occurred_at) filter (where e.value is not null) as values_json
    from public.analytics_events e
    where e.event_type = 'web_vital'
      and e.occurred_at >= v_start and e.occurred_at < v_end + interval '6 hours'
      and nullif(e.metadata ->> 'view_id', '') is not null
      and e.name is not null
    group by e.property_id, e.metadata ->> 'view_id', upper(e.name)
  ), vital_objects as (
    select property_id, view_key, jsonb_object_agg(metric, values_json) as vitals
    from vital_values
    group by property_id, view_key
  )
  insert into public.analytics_view_daily (
    property_id, day, view_key, occurred_at, path, device, source,
    source_category, source_type, referrer_host, country_code, browser, screen,
    utm_source, utm_medium, utm_campaign, tracker_version, session_id,
    active_seconds, max_scroll, key_events, javascript_errors,
    visible_sections, vitals, generated_at
  )
  select
    p.property_id, p.day, p.view_key, p.occurred_at, p.path, p.device, p.source,
    p.source_category, p.source_type, p.referrer_host, p.country_code, p.browser, p.screen,
    p.utm_source, p.utm_medium, p.utm_campaign, p.tracker_version, p.session_id,
    coalesce(s.active_seconds, 0), coalesce(s.max_scroll, 0), coalesce(s.key_events, 0),
    coalesce(s.javascript_errors, 0), coalesce(v.visible_sections, '{}'),
    coalesce(vo.vitals, '{}'::jsonb), now()
  from pageviews p
  left join signal_totals s
    on s.property_id = p.property_id and s.view_key = p.signal_view_id
  left join visible v
    on v.property_id = p.property_id and v.view_key = p.signal_view_id
  left join vital_objects vo
    on vo.property_id = p.property_id and vo.view_key = p.signal_view_id;

  get diagnostics v_views = row_count;

  insert into public.analytics_rollup_days (property_id, day, raw_event_count, generated_at)
  select
    p.id,
    p_day,
    count(e.id)::bigint,
    now()
  from public.properties p
  left join public.analytics_events e
    on e.property_id = p.id and e.occurred_at >= v_start and e.occurred_at < v_end
  group by p.id
  on conflict (property_id, day) do update
    set raw_event_count = excluded.raw_event_count,
        generated_at = excluded.generated_at;

  perform public.aggregate_analytics_day(p_day);

  return jsonb_build_object('day', p_day, 'hourlyRows', v_hourly, 'viewRows', v_views);
end;
$$;

revoke all on function public.aggregate_analytics_day_v2(date) from public, anon, authenticated;
grant execute on function public.aggregate_analytics_day_v2(date) to service_role;
grant execute on function public.aggregate_analytics_day(date) to service_role;

create or replace function public.analytics_rollup_window(
  p_property_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(to_jsonb(h) - 'property_id' - 'generated_at' - 'dimension_key' order by h.bucket_start)
      from public.analytics_hourly h
      where h.property_id = p_property_id
        and h.bucket_start >= p_from
        and h.bucket_start < p_to
    ), '[]'::jsonb),
    'views', coalesce((
      select jsonb_agg(to_jsonb(v) - 'property_id' - 'generated_at' order by v.occurred_at)
      from public.analytics_view_daily v
      where v.property_id = p_property_id
        and v.day >= p_from::date
        and v.day < p_to::date
    ), '[]'::jsonb),
    'coveredDays', coalesce((
      select jsonb_agg(d.day order by d.day)
      from public.analytics_rollup_days d
      where d.property_id = p_property_id
        and d.day >= p_from::date
        and d.day < p_to::date
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.analytics_rollup_window(uuid,timestamptz,timestamptz)
  from public, anon;
grant execute on function public.analytics_rollup_window(uuid,timestamptz,timestamptz)
  to authenticated, service_role;

create or replace function public.analytics_raw_window(
  p_property_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(e) - 'property_id' order by e.occurred_at), '[]'::jsonb)
  from (
    select
      property_id,
      event_type,
      path,
      referrer_host,
      source,
      device,
      country_code,
      name,
      value,
      metadata,
      occurred_at
    from public.analytics_events
    where property_id = p_property_id
      and occurred_at >= p_from
      and occurred_at <= p_to
    order by occurred_at
    limit 50000
  ) e;
$$;

revoke all on function public.analytics_raw_window(uuid,timestamptz,timestamptz)
  from public, anon;
grant execute on function public.analytics_raw_window(uuid,timestamptz,timestamptz)
  to authenticated, service_role;

create or replace function public.prune_analytics_raw(
  p_before timestamptz,
  p_limit integer default 10000
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  with doomed as (
    select id
    from public.analytics_events
    where occurred_at < p_before
    order by occurred_at
    limit least(50000, greatest(1, p_limit))
  )
  delete from public.analytics_events e
  using doomed d
  where e.id = d.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_analytics_raw(timestamptz,integer)
  from public, anon, authenticated;
grant execute on function public.prune_analytics_raw(timestamptz,integer) to service_role;

-- Keep the server-side page listing on the same hybrid data path. This function
-- remains SECURITY INVOKER so both raw and rollup RLS policies are enforced.
create or replace function public.analytics_pages_page(
  p_property_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_offset integer default 0,
  p_limit integer default 20,
  p_page_search text default null,
  p_path_mode text default null,
  p_path_value text default null,
  p_device text default null,
  p_source text default null,
  p_country text default null
)
returns table (
  path text,
  pageviews bigint,
  events bigint,
  total_rows bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with boundary as (
    select
      case
        when p_from = date_trunc('day', p_from) then p_from
        else date_trunc('day', p_from) + interval '1 day'
      end as full_start,
      date_trunc('day', p_to + interval '1 millisecond') as full_end
  ), rolled as (
    select
      h.path,
      sum(h.event_count) filter (where h.event_type = 'pageview')::bigint as pageviews,
      sum(h.event_count) filter (where h.event_type in ('click', 'outbound', 'form_success'))::bigint as events
    from public.analytics_hourly h
    join public.analytics_rollup_days d
      on d.property_id = h.property_id and d.day = h.bucket_start::date
    cross join boundary b
    where h.property_id = p_property_id
      and h.bucket_start >= p_from
      and h.bucket_start <= p_to
      and h.bucket_start >= b.full_start
      and h.bucket_start < b.full_end
      and (p_page_search is null or h.path ilike '%' || p_page_search || '%')
      and (
        p_path_value is null
        or (p_path_mode = 'exact' and h.path = p_path_value)
        or (p_path_mode = 'prefix' and h.path like rtrim(p_path_value, '/') || '%')
      )
      and (p_device is null or lower(coalesce(h.device, 'unknown')) = lower(p_device))
      and (p_source is null or lower(h.source_category) = lower(p_source))
      and (p_country is null or lower(coalesce(h.country_code, 'unknown')) = lower(p_country))
    group by h.path
  ), current_raw as (
    select
      e.path,
      count(*) filter (where e.event_type = 'pageview')::bigint as pageviews,
      count(*) filter (where e.event_type in ('click', 'outbound', 'form_success'))::bigint as events
    from public.analytics_events e, boundary b
    where e.property_id = p_property_id
      and e.occurred_at >= p_from
      and e.occurred_at <= p_to
      and (
        e.occurred_at < b.full_start
        or e.occurred_at >= b.full_end
        or not exists (
          select 1
          from public.analytics_rollup_days d
          where d.property_id = e.property_id and d.day = e.occurred_at::date
        )
      )
      and (p_page_search is null or e.path ilike '%' || p_page_search || '%')
      and (
        p_path_value is null
        or (p_path_mode = 'exact' and e.path = p_path_value)
        or (p_path_mode = 'prefix' and e.path like rtrim(p_path_value, '/') || '%')
      )
      and (p_device is null or lower(coalesce(e.device, 'unknown')) = lower(p_device))
      and (p_country is null or lower(coalesce(e.country_code, 'unknown')) = lower(p_country))
      and (
        p_source is null
        or lower(case
          when lower(coalesce(e.source, e.metadata ->> 'utm_source', e.referrer_host, '')) in ('', 'direct', 'direct / unknown') then 'direct / unknown'
          when lower(coalesce(e.source, e.metadata ->> 'utm_source', e.referrer_host, '')) like '%google%' then 'google'
          when lower(coalesce(e.source, e.metadata ->> 'utm_source', e.referrer_host, '')) like '%linkedin%' then 'linkedin'
          when lower(coalesce(e.source, e.metadata ->> 'utm_source', e.referrer_host, '')) like '%instagram%' then 'instagram'
          else 'other referrals'
        end) = lower(p_source)
      )
    group by e.path
  ), combined as (
    select path, coalesce(pageviews, 0) as pageviews, coalesce(events, 0) as events from rolled
    union all
    select path, coalesce(pageviews, 0), coalesce(events, 0) from current_raw
  ), grouped as (
    select path, sum(pageviews)::bigint as pageviews, sum(events)::bigint as events
    from combined
    group by path
    having sum(pageviews) > 0
  )
  select
    grouped.path,
    grouped.pageviews,
    grouped.events,
    count(*) over ()::bigint as total_rows
  from grouped
  order by grouped.pageviews desc, grouped.path asc
  offset greatest(0, p_offset)
  limit least(200, greatest(1, p_limit));
$$;

revoke all on function public.analytics_pages_page(uuid,timestamptz,timestamptz,integer,integer,text,text,text,text,text,text)
  from public;
grant execute on function public.analytics_pages_page(uuid,timestamptz,timestamptz,integer,integer,text,text,text,text,text,text)
  to authenticated;

-- The current project contains only a small amount of analytics data, so a
-- transactional backfill is safe and makes the cutover immediately complete.
do $$
declare
  v_day date;
begin
  for v_day in
    select distinct occurred_at::date
    from public.analytics_events
    order by 1
  loop
    perform public.aggregate_analytics_day_v2(v_day);
  end loop;
end;
$$;

insert into private.app_migrations(version, name, checksum)
values ('20261003194338', 'analytics_hybrid_rollups', 'self')
on conflict (version) do nothing;

commit;
