begin;

-- Event drill-downs always scope by property, stable event name and time.
-- Keep this partial so high-volume behavioural signals do not enlarge it.
create index if not exists analytics_events_property_name_time_idx
  on public.analytics_events (property_id, name, occurred_at desc, id desc)
  where event_type in ('click', 'outbound', 'form_success');

create index if not exists analytics_hourly_property_name_bucket_idx
  on public.analytics_hourly (property_id, name, bucket_start desc)
  where event_type in ('click', 'outbound', 'form_success');

-- Occurrence context is correlated only through short-lived anonymous view and
-- tab-session identifiers already captured in metadata.
create index if not exists analytics_events_property_view_time_idx
  on public.analytics_events (property_id, ((metadata ->> 'view_id')), occurred_at)
  where nullif(metadata ->> 'view_id', '') is not null;

create index if not exists analytics_events_property_session_time_idx
  on public.analytics_events (property_id, ((metadata ->> 'session')), occurred_at)
  where nullif(metadata ->> 'session', '') is not null;

-- Return compact grouped facts for the selected event. Completed UTC days come
-- from hourly rollups; uncovered/current days come from raw events. Raw event
-- rows never leave Postgres through this summary function.
create or replace function public.analytics_event_summary_rows(
  p_property_id uuid,
  p_event_name text,
  p_from timestamptz,
  p_to timestamptz,
  p_path_mode text default null,
  p_path_value text default null,
  p_source text default null,
  p_country text default null,
  p_device text default null,
  p_browser text default null
)
returns table (
  event_type text,
  path text,
  source text,
  device text,
  country_code text,
  browser text,
  name text,
  occurred_at timestamptz,
  last_occurred_at timestamptz,
  event_count bigint,
  rolled_up boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with raw_normalized as (
    select
      e.event_type,
      e.path,
      case
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) in ('', 'direct', 'direct / unknown') then 'Direct / unknown'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) like '%google%' then 'Google'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) like '%linkedin%' then 'LinkedIn'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), '')) like '%instagram%' then 'Instagram'
        else 'Other referrals'
      end as source,
      coalesce(e.device, 'Unknown') as device,
      coalesce(e.country_code, 'Unknown') as country_code,
      coalesce(nullif(e.metadata ->> 'browser', ''), 'Unknown') as browser,
      e.name,
      e.occurred_at
    from public.analytics_events e
    where e.property_id = p_property_id
      and e.event_type in ('click', 'outbound', 'form_success')
      and e.name = p_event_name
      and e.occurred_at >= p_from
      and e.occurred_at <= p_to
      and not exists (
        select 1
        from public.analytics_rollup_days d
        where d.property_id = e.property_id
          and d.day = (e.occurred_at at time zone 'UTC')::date
      )
  ), combined as (
    select
      h.event_type,
      h.path,
      coalesce(nullif(h.source_category, ''), 'Direct / unknown') as source,
      coalesce(nullif(h.device, ''), 'Unknown') as device,
      coalesce(nullif(h.country_code, ''), 'Unknown') as country_code,
      coalesce(nullif(h.browser, ''), 'Unknown') as browser,
      h.name,
      h.bucket_start as occurred_at,
      h.bucket_start as last_occurred_at,
      h.event_count,
      true as rolled_up
    from public.analytics_hourly h
    where h.property_id = p_property_id
      and h.event_type in ('click', 'outbound', 'form_success')
      and h.name = p_event_name
      and h.bucket_start >= p_from
      and h.bucket_start <= p_to
      and exists (
        select 1
        from public.analytics_rollup_days d
        where d.property_id = h.property_id
          and d.day = (h.bucket_start at time zone 'UTC')::date
      )
    union all
    select
      r.event_type, r.path, r.source, r.device, r.country_code, r.browser,
      r.name, r.occurred_at, r.occurred_at, 1::bigint, false
    from raw_normalized r
  ), filtered as (
    select *
    from combined e
    where (
        p_path_value is null
        or (p_path_mode = 'exact' and e.path = p_path_value)
        or (p_path_mode = 'prefix' and e.path like rtrim(p_path_value, '/') || '%')
      )
      and (p_source is null or lower(e.source) = lower(p_source))
      and (p_country is null or lower(e.country_code) = lower(p_country))
      and (p_device is null or lower(e.device) = lower(p_device))
      and (p_browser is null or lower(e.browser) = lower(p_browser))
  )
  select
    e.event_type,
    e.path,
    e.source,
    e.device,
    e.country_code,
    e.browser,
    e.name,
    min(e.occurred_at) as occurred_at,
    max(e.last_occurred_at) as last_occurred_at,
    sum(e.event_count)::bigint as event_count,
    e.rolled_up
  from filtered e
  group by e.event_type, e.path, e.source, e.device, e.country_code,
    e.browser, e.name, date_trunc('hour', e.occurred_at), e.rolled_up
  order by occurred_at;
$$;

revoke all on function public.analytics_event_summary_rows(uuid,text,timestamptz,timestamptz,text,text,text,text,text,text)
  from public, anon;
grant execute on function public.analytics_event_summary_rows(uuid,text,timestamptz,timestamptz,text,text,text,text,text,text)
  to authenticated, service_role;

create or replace function public.analytics_event_occurrences_page(
  p_property_id uuid,
  p_event_name text,
  p_from timestamptz,
  p_to timestamptz,
  p_offset integer default 0,
  p_limit integer default 20,
  p_path_mode text default null,
  p_path_value text default null,
  p_source text default null,
  p_country text default null,
  p_device text default null,
  p_browser text default null
)
returns table (
  id bigint,
  event_type text,
  occurred_at timestamptz,
  received_at timestamptz,
  path text,
  source text,
  source_detail text,
  referrer_host text,
  country_code text,
  device text,
  browser text,
  screen text,
  language text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  active_seconds numeric,
  unique_sessions bigint,
  total_rows bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with prepared as (
    select
      e.*,
      coalesce(
        nullif(trim(e.source), ''),
        nullif(trim(e.metadata ->> 'utm_source'), ''),
        nullif(trim(page_context.source), ''),
        nullif(trim(page_context.metadata ->> 'utm_source'), ''),
        nullif(trim(page_context.referrer_host), ''),
        nullif(trim(e.referrer_host), ''),
        'Direct / unknown'
      ) as resolved_source,
      case
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(page_context.source), ''), nullif(trim(page_context.metadata ->> 'utm_source'), ''), nullif(trim(page_context.referrer_host), ''), nullif(trim(e.referrer_host), ''), '')) in ('', 'direct', 'direct / unknown') then 'Direct / unknown'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(page_context.source), ''), nullif(trim(page_context.metadata ->> 'utm_source'), ''), nullif(trim(page_context.referrer_host), ''), nullif(trim(e.referrer_host), ''), '')) like '%google%' then 'Google'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(page_context.source), ''), nullif(trim(page_context.metadata ->> 'utm_source'), ''), nullif(trim(page_context.referrer_host), ''), nullif(trim(e.referrer_host), ''), '')) like '%linkedin%' then 'LinkedIn'
        when lower(coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(page_context.source), ''), nullif(trim(page_context.metadata ->> 'utm_source'), ''), nullif(trim(page_context.referrer_host), ''), nullif(trim(e.referrer_host), ''), '')) like '%instagram%' then 'Instagram'
        else 'Other referrals'
      end as source_category,
      coalesce(page_context.referrer_host, e.referrer_host) as context_referrer,
      coalesce(view_context.active_seconds, 0) as active_seconds
    from public.analytics_events e
    left join lateral (
      select page.source, page.referrer_host, page.metadata
      from public.analytics_events page
      where page.property_id = e.property_id
        and page.event_type = 'pageview'
        and nullif(e.metadata ->> 'view_id', '') is not null
        and page.metadata ->> 'view_id' = e.metadata ->> 'view_id'
      order by page.occurred_at asc
      limit 1
    ) page_context on true
    left join lateral (
      select coalesce(sum(signal.value) filter (where signal.event_type = 'active_time'), 0) as active_seconds
      from public.analytics_events signal
      where signal.property_id = e.property_id
        and nullif(e.metadata ->> 'view_id', '') is not null
        and signal.metadata ->> 'view_id' = e.metadata ->> 'view_id'
    ) view_context on true
    where e.property_id = p_property_id
      and e.event_type in ('click', 'outbound', 'form_success')
      and e.name = p_event_name
      and e.occurred_at >= p_from
      and e.occurred_at <= p_to
  ), filtered as (
    select *
    from prepared e
    where (
        p_path_value is null
        or (p_path_mode = 'exact' and e.path = p_path_value)
        or (p_path_mode = 'prefix' and e.path like rtrim(p_path_value, '/') || '%')
      )
      and (
        p_source is null
        or lower(e.source_category) = lower(p_source)
        or lower(e.resolved_source) = lower(p_source)
      )
      and (p_country is null or lower(coalesce(e.country_code, 'unknown')) = lower(p_country))
      and (p_device is null or lower(coalesce(e.device, 'unknown')) = lower(p_device))
      and (p_browser is null or lower(coalesce(e.metadata ->> 'browser', 'unknown')) = lower(p_browser))
  )
  select
    e.id,
    e.event_type,
    e.occurred_at,
    e.received_at,
    e.path,
    e.source_category as source,
    e.resolved_source as source_detail,
    e.context_referrer as referrer_host,
    e.country_code,
    e.device,
    nullif(e.metadata ->> 'browser', '') as browser,
    nullif(e.metadata ->> 'screen', '') as screen,
    nullif(e.metadata ->> 'language', '') as language,
    nullif(e.metadata ->> 'utm_source', '') as utm_source,
    nullif(e.metadata ->> 'utm_medium', '') as utm_medium,
    nullif(e.metadata ->> 'utm_campaign', '') as utm_campaign,
    nullif(e.metadata ->> 'utm_content', '') as utm_content,
    nullif(e.metadata ->> 'utm_term', '') as utm_term,
    e.active_seconds,
    (select count(distinct nullif(session_row.metadata ->> 'session', '')) from filtered session_row)::bigint as unique_sessions,
    count(*) over ()::bigint as total_rows
  from filtered e
  order by e.occurred_at desc, e.id desc
  offset greatest(0, p_offset)
  limit least(100, greatest(1, p_limit));
$$;

revoke all on function public.analytics_event_occurrences_page(uuid,text,timestamptz,timestamptz,integer,integer,text,text,text,text,text,text)
  from public, anon;
grant execute on function public.analytics_event_occurrences_page(uuid,text,timestamptz,timestamptz,integer,integer,text,text,text,text,text,text)
  to authenticated, service_role;

insert into private.app_migrations(version, name, checksum)
values ('20261005030210', 'analytics_event_drilldown', 'self')
on conflict (version) do nothing;

commit;
