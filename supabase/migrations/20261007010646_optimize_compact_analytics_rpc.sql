begin;

-- Keep the same internal RPC contract while using a narrow materialized working
-- set and positional rows. The Worker expands these rows before running the
-- existing customer-facing summary builders.
create or replace function public.analytics_compact_window(
  p_property_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_use_rollups boolean default true
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with raw_events as materialized (
    select
      e.id,
      e.occurred_at,
      e.event_type,
      e.path,
      coalesce(e.name, '') as name,
      e.value,
      coalesce(e.device, '') as device,
      coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), 'Direct / unknown') as source,
      coalesce(e.referrer_host, '') as referrer_host,
      coalesce(e.country_code, '') as country_code,
      coalesce(e.metadata ->> 'view_id', '') as view_key,
      coalesce(e.metadata ->> 'browser', '') as browser,
      coalesce(e.metadata ->> 'screen', '') as screen,
      coalesce(e.metadata ->> 'utm_source', '') as utm_source,
      coalesce(e.metadata ->> 'utm_medium', '') as utm_medium,
      coalesce(e.metadata ->> 'utm_campaign', '') as utm_campaign,
      coalesce(e.metadata ->> 'tracker_version', '') as tracker_version,
      coalesce(e.metadata ->> 'session', '') as session_id
    from public.analytics_events e
    where e.property_id = p_property_id
      and e.occurred_at >= p_from
      and e.occurred_at <= p_to
      and (
        not p_use_rollups
        or not exists (
          select 1 from public.analytics_rollup_days d
          where d.property_id = e.property_id
            and d.day = (e.occurred_at at time zone 'UTC')::date
        )
      )
  ), raw_groups as materialized (
    select
      date_trunc('hour', e.occurred_at) as bucket_start,
      e.event_type, e.path, e.name, e.device, e.source, e.referrer_host,
      e.country_code, e.browser, e.screen, e.utm_source, e.utm_medium,
      e.utm_campaign, e.tracker_version,
      count(*)::bigint as event_count,
      sum(e.value) as value_sum,
      case when e.event_type = 'web_vital'
        then coalesce(jsonb_agg(e.value order by e.occurred_at) filter (where e.value is not null), '[]'::jsonb)
        else '[]'::jsonb end as values_json
    from raw_events e
    group by date_trunc('hour', e.occurred_at), e.event_type, e.path, e.name,
      e.device, e.source, e.referrer_host, e.country_code, e.browser, e.screen,
      e.utm_source, e.utm_medium, e.utm_campaign, e.tracker_version
  ), rolled_groups as materialized (
    select h.bucket_start, h.event_type, h.path, h.name, h.device, h.source,
      h.referrer_host, h.country_code, h.browser, h.screen, h.utm_source,
      h.utm_medium, h.utm_campaign, h.tracker_version, h.event_count,
      h.value_sum, h.values_json
    from public.analytics_hourly h
    where p_use_rollups
      and h.property_id = p_property_id
      and h.bucket_start >= p_from
      and h.bucket_start <= p_to
      and exists (
        select 1 from public.analytics_rollup_days d
        where d.property_id = h.property_id
          and d.day = (h.bucket_start at time zone 'UTC')::date
      )
  ), event_groups as materialized (
    select * from rolled_groups
    union all
    select * from raw_groups
  ), raw_pageviews as materialized (
    select distinct on (e.view_key)
      e.view_key, e.occurred_at, e.path, e.device, e.source, e.referrer_host,
      e.country_code, e.browser, e.screen, e.utm_source, e.utm_medium,
      e.utm_campaign, e.tracker_version, e.session_id
    from raw_events e
    where e.event_type = 'pageview' and e.view_key <> ''
    order by e.view_key, e.occurred_at, e.id
  ), raw_signal_totals as materialized (
    select e.view_key,
      coalesce(sum(e.value) filter (where e.event_type = 'active_time'), 0) as active_seconds,
      coalesce(max(e.value) filter (where e.event_type = 'scroll'), 0) as max_scroll,
      count(*) filter (where e.event_type = 'js_error')::integer as javascript_errors
    from raw_events e
    where e.view_key <> ''
    group by e.view_key
  ), raw_key_event_names as materialized (
    select e.view_key, coalesce(nullif(e.name, ''), e.event_type) as event_name,
      count(*)::bigint as event_count
    from raw_events e
    where e.event_type in ('click','outbound','form_success') and e.view_key <> ''
    group by e.view_key, coalesce(nullif(e.name, ''), e.event_type)
  ), raw_key_event_counts as materialized (
    select view_key, sum(event_count)::bigint as key_events,
      jsonb_object_agg(event_name, event_count) as key_event_counts
    from raw_key_event_names
    group by view_key
  ), raw_visible as materialized (
    select e.view_key,
      array_agg(distinct e.name order by e.name) filter (where e.name <> '') as visible_sections
    from raw_events e
    where e.event_type = 'visible_section' and e.view_key <> ''
    group by e.view_key
  ), raw_vital_values as materialized (
    select e.view_key, upper(e.name) as metric,
      jsonb_agg(e.value order by e.occurred_at) filter (where e.value is not null) as values_json
    from raw_events e
    where e.event_type = 'web_vital' and e.name <> '' and e.view_key <> ''
    group by e.view_key, upper(e.name)
  ), raw_vitals as materialized (
    select view_key, jsonb_object_agg(metric, values_json) as vitals
    from raw_vital_values
    group by view_key
  ), raw_views as materialized (
    select p.view_key, p.occurred_at, p.path, p.device, p.source,
      p.referrer_host, p.country_code, p.browser, p.screen, p.utm_source,
      p.utm_medium, p.utm_campaign, p.tracker_version, p.session_id,
      greatest(coalesce(s.active_seconds, 0), coalesce(vs.active_seconds, 0)) as active_seconds,
      greatest(coalesce(s.max_scroll, 0), coalesce(vs.max_scroll, 0)) as max_scroll,
      greatest(coalesce(k.key_events, 0), coalesce((select sum(value::bigint) from jsonb_each_text(vs.key_event_counts)), 0))::bigint as key_events,
      greatest(coalesce(s.javascript_errors, 0), coalesce(vs.javascript_errors, 0))::integer as javascript_errors,
      (select coalesce(array_agg(distinct section order by section), '{}')
        from unnest(coalesce(vis.visible_sections, '{}') || coalesce(vs.visible_sections, '{}')) section) as visible_sections,
      coalesce(vit.vitals, '{}'::jsonb) || coalesce(vs.vitals, '{}'::jsonb) as vitals,
      coalesce(k.key_event_counts, '{}'::jsonb) || coalesce(vs.key_event_counts, '{}'::jsonb) as key_event_counts
    from raw_pageviews p
    left join raw_signal_totals s on s.view_key = p.view_key
    left join raw_key_event_counts k on k.view_key = p.view_key
    left join raw_visible vis on vis.view_key = p.view_key
    left join raw_vitals vit on vit.view_key = p.view_key
    left join public.analytics_view_states vs
      on vs.property_id = p_property_id and vs.view_id = p.view_key
  ), rolled_views as materialized (
    select v.view_key, v.occurred_at, v.path, v.device, v.source,
      v.referrer_host, v.country_code, v.browser, v.screen, v.utm_source,
      v.utm_medium, v.utm_campaign, v.tracker_version, v.session_id,
      v.active_seconds, v.max_scroll, v.key_events, v.javascript_errors,
      v.visible_sections, v.vitals, '{}'::jsonb as key_event_counts
    from public.analytics_view_daily v
    where p_use_rollups
      and v.property_id = p_property_id
      and v.occurred_at >= p_from and v.occurred_at <= p_to
      and exists (
        select 1 from public.analytics_rollup_days d
        where d.property_id = v.property_id and d.day = v.day
      )
  ), all_views as materialized (
    select * from rolled_views
    union all
    select * from raw_views
  )
  select jsonb_build_object(
    'formatVersion', 2,
    'events', coalesce((select jsonb_agg(jsonb_build_array(
      g.bucket_start, g.event_type, g.path, g.name, g.device, g.source,
      g.referrer_host, g.country_code, g.browser, g.screen, g.utm_source,
      g.utm_medium, g.utm_campaign, g.tracker_version, g.event_count,
      g.value_sum, g.values_json
    ) order by g.bucket_start) from event_groups g), '[]'::jsonb),
    'views', coalesce((select jsonb_agg(jsonb_build_array(
      v.view_key, v.occurred_at, v.path, v.device, v.source, v.referrer_host,
      v.country_code, v.browser, v.screen, v.utm_source, v.utm_medium,
      v.utm_campaign, v.tracker_version, v.session_id, v.active_seconds,
      v.max_scroll, v.key_events, v.javascript_errors, v.visible_sections,
      v.vitals, v.key_event_counts
    ) order by v.occurred_at) from all_views v), '[]'::jsonb),
    'sourceRows', (select count(*) from raw_events) + (select count(*) from rolled_groups),
    'logicalEvents', coalesce((select sum(event_count) from event_groups), 0),
    'eventRows', (select count(*) from event_groups),
    'viewRows', (select count(*) from all_views),
    'truncated', false
  );
$$;

revoke all on function public.analytics_compact_window(uuid,timestamptz,timestamptz,boolean)
  from public, anon;
grant execute on function public.analytics_compact_window(uuid,timestamptz,timestamptz,boolean)
  to authenticated, service_role;

update private.app_migrations
set version = '20261007010100'
where version = '20261007002535'
  and name = 'platform_performance_storage_optimization';

insert into private.app_migrations(version, name, checksum)
values ('20261007010646', 'optimize_compact_analytics_rpc', 'self')
on conflict (version) do nothing;

commit;
