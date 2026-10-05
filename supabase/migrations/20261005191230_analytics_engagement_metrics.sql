begin;

-- Extend the existing hybrid, server-paginated Pages query with a compact
-- active-time aggregate. Completed days continue to read one row per view from
-- analytics_view_daily; only uncovered/current ranges inspect raw events.
drop function if exists public.analytics_pages_page(
  uuid,timestamptz,timestamptz,integer,integer,text,text,text,text,text,text
);

create function public.analytics_pages_page(
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
  average_active_seconds numeric,
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
  ), rolled_counts as (
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
  ), rolled_active as (
    select
      v.path,
      sum(v.active_seconds)::numeric as active_seconds,
      count(*)::bigint as active_views
    from public.analytics_view_daily v
    join public.analytics_rollup_days d
      on d.property_id = v.property_id and d.day = v.day
    cross join boundary b
    where v.property_id = p_property_id
      and v.occurred_at >= p_from
      and v.occurred_at <= p_to
      and v.occurred_at >= b.full_start
      and v.occurred_at < b.full_end
      and v.view_key not like 'legacy:%'
      and (p_page_search is null or v.path ilike '%' || p_page_search || '%')
      and (
        p_path_value is null
        or (p_path_mode = 'exact' and v.path = p_path_value)
        or (p_path_mode = 'prefix' and v.path like rtrim(p_path_value, '/') || '%')
      )
      and (p_device is null or lower(coalesce(v.device, 'unknown')) = lower(p_device))
      and (p_source is null or lower(v.source_category) = lower(p_source))
      and (p_country is null or lower(coalesce(v.country_code, 'unknown')) = lower(p_country))
    group by v.path
  ), raw_rows as (
    select e.*
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
  ), current_raw_counts as (
    select
      e.path,
      count(*) filter (where e.event_type = 'pageview')::bigint as pageviews,
      count(*) filter (where e.event_type in ('click', 'outbound', 'form_success'))::bigint as events
    from raw_rows e
    group by e.path
  ), raw_signal_totals as (
    select
      e.metadata ->> 'view_id' as view_key,
      coalesce(sum(e.value) filter (where e.event_type = 'active_time'), 0)::numeric as active_seconds
    from public.analytics_events e
    where e.property_id = p_property_id
      and e.occurred_at >= p_from
      and e.occurred_at <= p_to + interval '6 hours'
      and e.event_type = 'active_time'
      and nullif(e.metadata ->> 'view_id', '') is not null
    group by e.metadata ->> 'view_id'
  ), current_raw_active as (
    select
      e.path,
      sum(coalesce(s.active_seconds, 0))::numeric as active_seconds,
      count(*)::bigint as active_views
    from raw_rows e
    left join raw_signal_totals s on s.view_key = e.metadata ->> 'view_id'
    where e.event_type = 'pageview'
      and nullif(e.metadata ->> 'view_id', '') is not null
    group by e.path
  ), combined_counts as (
    select path, coalesce(pageviews, 0) as pageviews, coalesce(events, 0) as events from rolled_counts
    union all
    select path, coalesce(pageviews, 0), coalesce(events, 0) from current_raw_counts
  ), grouped_counts as (
    select path, sum(pageviews)::bigint as pageviews, sum(events)::bigint as events
    from combined_counts
    group by path
    having sum(pageviews) > 0
  ), combined_active as (
    select path, active_seconds, active_views from rolled_active
    union all
    select path, active_seconds, active_views from current_raw_active
  ), grouped_active as (
    select path, sum(active_seconds)::numeric as active_seconds, sum(active_views)::bigint as active_views
    from combined_active
    group by path
  )
  select
    counts.path,
    counts.pageviews,
    counts.events,
    case
      when active.active_views > 0 then active.active_seconds / active.active_views
      else null
    end as average_active_seconds,
    count(*) over ()::bigint as total_rows
  from grouped_counts counts
  left join grouped_active active on active.path = counts.path
  order by counts.pageviews desc, counts.path asc
  offset greatest(0, p_offset)
  limit least(200, greatest(1, p_limit));
$$;

revoke all on function public.analytics_pages_page(
  uuid,timestamptz,timestamptz,integer,integer,text,text,text,text,text,text
) from public;
grant execute on function public.analytics_pages_page(
  uuid,timestamptz,timestamptz,integer,integer,text,text,text,text,text,text
) to authenticated;

insert into private.app_migrations(version, name, checksum)
values ('20261005191230', 'analytics_engagement_metrics', 'self')
on conflict (version) do nothing;

commit;
