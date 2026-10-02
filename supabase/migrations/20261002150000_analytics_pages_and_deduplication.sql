-- Analytics page listing and ingestion integrity.
-- The function remains SECURITY INVOKER so existing analytics_events RLS applies.

create unique index if not exists analytics_events_property_event_id_idx
  on public.analytics_events (property_id, ((metadata ->> 'event_id')))
  where metadata ? 'event_id' and length(metadata ->> 'event_id') > 0;

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
  with filtered as (
    select
      e.path,
      e.event_type,
      case
        when lower(coalesce(e.source, e.metadata ->> 'utm_source', e.referrer_host, '')) in ('', 'direct', 'direct / unknown') then 'direct / unknown'
        when lower(coalesce(e.source, e.metadata ->> 'utm_source', e.referrer_host, '')) like '%google%' then 'google'
        when lower(coalesce(e.source, e.metadata ->> 'utm_source', e.referrer_host, '')) like '%linkedin%' then 'linkedin'
        when lower(coalesce(e.source, e.metadata ->> 'utm_source', e.referrer_host, '')) like '%instagram%' then 'instagram'
        else 'other referrals'
      end as source_category
    from public.analytics_events e
    where e.property_id = p_property_id
      and e.occurred_at >= p_from
      and e.occurred_at <= p_to
      and (p_page_search is null or e.path ilike '%' || p_page_search || '%')
      and (
        p_path_value is null
        or (p_path_mode = 'exact' and e.path = p_path_value)
        or (p_path_mode = 'prefix' and e.path like rtrim(p_path_value, '/') || '%')
      )
      and (p_device is null or lower(coalesce(e.device, 'unknown')) = lower(p_device))
      and (p_country is null or lower(coalesce(e.country_code, 'unknown')) = lower(p_country))
  ), source_filtered as (
    select * from filtered
    where p_source is null or source_category = lower(p_source)
  ), grouped as (
    select
      path,
      count(*) filter (where event_type = 'pageview')::bigint as pageviews,
      count(*) filter (where event_type in ('click', 'outbound', 'form_success'))::bigint as events
    from source_filtered
    group by path
    having count(*) filter (where event_type = 'pageview') > 0
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

revoke all on function public.analytics_pages_page(uuid,timestamptz,timestamptz,integer,integer,text,text,text,text,text,text) from public;
grant execute on function public.analytics_pages_page(uuid,timestamptz,timestamptz,integer,integer,text,text,text,text,text,text) to authenticated;

comment on function public.analytics_pages_page(uuid,timestamptz,timestamptz,integer,integer,text,text,text,text,text,text)
  is 'RLS-scoped, stably sorted server-side page analytics pagination.';

insert into private.app_migrations(version, name, checksum)
values ('20261002150000', 'analytics_pages_and_deduplication', 'self')
on conflict (version) do nothing;
