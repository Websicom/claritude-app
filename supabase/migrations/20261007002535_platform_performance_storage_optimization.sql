begin;

-- One mutable row per tracked page view replaces high-frequency active-time,
-- scroll, visible-section, Web Vital and JavaScript-error event rows. The
-- immutable analytics_events table remains the source for pageviews and real
-- customer events that need occurrence drill-downs.
create table public.analytics_view_states (
  property_id uuid not null references public.properties(id) on delete cascade,
  view_id text not null check (char_length(view_id) between 1 and 200),
  session_id text not null default '' check (char_length(session_id) <= 200),
  occurred_at timestamptz not null,
  updated_at timestamptz not null default now(),
  checkpoint_sequence integer not null default 0 check (checkpoint_sequence between 0 and 1000000),
  path text not null check (char_length(path) <= 500),
  referrer_host text not null default '' check (char_length(referrer_host) <= 200),
  source text not null default '' check (char_length(source) <= 200),
  device text not null default '' check (char_length(device) <= 40),
  country_code text not null default '' check (char_length(country_code) <= 20),
  browser text not null default '' check (char_length(browser) <= 80),
  screen text not null default '' check (char_length(screen) <= 40),
  tracker_version text not null default '' check (char_length(tracker_version) <= 40),
  acquisition_source text not null default '' check (char_length(acquisition_source) <= 200),
  original_referrer text not null default '' check (char_length(original_referrer) <= 200),
  landing_page text not null default '' check (char_length(landing_page) <= 500),
  utm_source text not null default '' check (char_length(utm_source) <= 200),
  utm_medium text not null default '' check (char_length(utm_medium) <= 200),
  utm_campaign text not null default '' check (char_length(utm_campaign) <= 200),
  utm_content text not null default '' check (char_length(utm_content) <= 200),
  utm_term text not null default '' check (char_length(utm_term) <= 200),
  active_seconds numeric not null default 0 check (active_seconds between 0 and 600000),
  max_scroll numeric not null default 0 check (max_scroll between 0 and 100),
  key_event_counts jsonb not null default '{}'::jsonb,
  javascript_errors integer not null default 0 check (javascript_errors between 0 and 50),
  visible_sections text[] not null default '{}' check (cardinality(visible_sections) <= 50),
  vitals jsonb not null default '{}'::jsonb,
  primary key (property_id, view_id)
);

create index analytics_view_states_property_occurred_idx
  on public.analytics_view_states(property_id, occurred_at desc);
create index analytics_view_states_property_session_idx
  on public.analytics_view_states(property_id, session_id, occurred_at)
  where session_id <> '';

alter table public.analytics_view_states enable row level security;
revoke all on public.analytics_view_states from public, anon, authenticated;
grant select on public.analytics_view_states to authenticated;
grant select, insert, update, delete on public.analytics_view_states to service_role;
create policy analytics_view_states_select on public.analytics_view_states
  for select to authenticated
  using ((select private.can_access_property(property_id)));

comment on table public.analytics_view_states is
  'Compact current/raw-retention engagement state. One row is updated at bounded checkpoints for each anonymous page view.';

create or replace function public.merge_analytics_view_state(
  p_property_id uuid,
  p_state jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare v_changed bigint;
begin
  insert into public.analytics_view_states (
    property_id, view_id, session_id, occurred_at, updated_at,
    checkpoint_sequence, path, referrer_host, source, device, country_code,
    browser, screen, tracker_version, acquisition_source, original_referrer,
    landing_page, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    active_seconds, max_scroll, key_event_counts, javascript_errors,
    visible_sections, vitals
  ) values (
    p_property_id,
    p_state ->> 'view_id',
    coalesce(p_state ->> 'session_id', ''),
    (p_state ->> 'occurred_at')::timestamptz,
    now(),
    coalesce((p_state ->> 'checkpoint_sequence')::integer, 0),
    p_state ->> 'path',
    coalesce(p_state ->> 'referrer_host', ''),
    coalesce(p_state ->> 'source', ''),
    coalesce(p_state ->> 'device', ''),
    coalesce(p_state ->> 'country_code', ''),
    coalesce(p_state ->> 'browser', ''),
    coalesce(p_state ->> 'screen', ''),
    coalesce(p_state ->> 'tracker_version', ''),
    coalesce(p_state ->> 'acquisition_source', ''),
    coalesce(p_state ->> 'original_referrer', ''),
    coalesce(p_state ->> 'landing_page', ''),
    coalesce(p_state ->> 'utm_source', ''),
    coalesce(p_state ->> 'utm_medium', ''),
    coalesce(p_state ->> 'utm_campaign', ''),
    coalesce(p_state ->> 'utm_content', ''),
    coalesce(p_state ->> 'utm_term', ''),
    coalesce((p_state ->> 'active_seconds')::numeric, 0),
    coalesce((p_state ->> 'max_scroll')::numeric, 0),
    coalesce(p_state -> 'key_event_counts', '{}'::jsonb),
    coalesce((p_state ->> 'javascript_errors')::integer, 0),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_state -> 'visible_sections', '[]'::jsonb))), '{}'),
    coalesce(p_state -> 'vitals', '{}'::jsonb)
  )
  on conflict (property_id, view_id) do update set
    session_id = excluded.session_id,
    updated_at = now(),
    checkpoint_sequence = excluded.checkpoint_sequence,
    path = excluded.path,
    referrer_host = excluded.referrer_host,
    source = excluded.source,
    device = excluded.device,
    country_code = excluded.country_code,
    browser = excluded.browser,
    screen = excluded.screen,
    tracker_version = excluded.tracker_version,
    acquisition_source = excluded.acquisition_source,
    original_referrer = excluded.original_referrer,
    landing_page = excluded.landing_page,
    utm_source = excluded.utm_source,
    utm_medium = excluded.utm_medium,
    utm_campaign = excluded.utm_campaign,
    utm_content = excluded.utm_content,
    utm_term = excluded.utm_term,
    active_seconds = greatest(public.analytics_view_states.active_seconds, excluded.active_seconds),
    max_scroll = greatest(public.analytics_view_states.max_scroll, excluded.max_scroll),
    key_event_counts = public.analytics_view_states.key_event_counts || excluded.key_event_counts,
    javascript_errors = greatest(public.analytics_view_states.javascript_errors, excluded.javascript_errors),
    visible_sections = (select coalesce(array_agg(distinct section order by section), '{}')
      from unnest(public.analytics_view_states.visible_sections || excluded.visible_sections) section),
    vitals = public.analytics_view_states.vitals || excluded.vitals
  where excluded.checkpoint_sequence >= public.analytics_view_states.checkpoint_sequence;
  get diagnostics v_changed = row_count;
  return v_changed > 0;
end;
$$;

revoke all on function public.merge_analytics_view_state(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.merge_analytics_view_state(uuid,jsonb) to service_role;

-- Return mergeable event groups plus one compact row per view. This function
-- deliberately performs raw-event grouping inside Postgres so the Worker never
-- has to materialise the previous 50,000-row analytics window. Existing
-- JavaScript summary logic remains responsible for presentation semantics.
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
    select e.*
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
      e.event_type,
      e.path,
      coalesce(e.name, '') as name,
      coalesce(e.device, '') as device,
      coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), 'Direct / unknown') as source,
      coalesce(e.referrer_host, '') as referrer_host,
      coalesce(e.country_code, '') as country_code,
      coalesce(e.metadata ->> 'browser', '') as browser,
      coalesce(e.metadata ->> 'screen', '') as screen,
      coalesce(e.metadata ->> 'utm_source', '') as utm_source,
      coalesce(e.metadata ->> 'utm_medium', '') as utm_medium,
      coalesce(e.metadata ->> 'utm_campaign', '') as utm_campaign,
      coalesce(e.metadata ->> 'tracker_version', '') as tracker_version,
      count(*)::bigint as event_count,
      sum(e.value) as value_sum,
      case when e.event_type = 'web_vital'
        then coalesce(jsonb_agg(e.value order by e.occurred_at) filter (where e.value is not null), '[]'::jsonb)
        else '[]'::jsonb end as values_json
    from raw_events e
    group by date_trunc('hour', e.occurred_at), e.event_type, e.path,
      coalesce(e.name, ''), coalesce(e.device, ''),
      coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), 'Direct / unknown'),
      coalesce(e.referrer_host, ''), coalesce(e.country_code, ''),
      coalesce(e.metadata ->> 'browser', ''), coalesce(e.metadata ->> 'screen', ''),
      coalesce(e.metadata ->> 'utm_source', ''), coalesce(e.metadata ->> 'utm_medium', ''),
      coalesce(e.metadata ->> 'utm_campaign', ''), coalesce(e.metadata ->> 'tracker_version', '')
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
    select distinct on (e.metadata ->> 'view_id')
      e.metadata ->> 'view_id' as view_key,
      e.occurred_at,
      e.path,
      coalesce(e.device, '') as device,
      coalesce(nullif(trim(e.source), ''), nullif(trim(e.metadata ->> 'utm_source'), ''), nullif(trim(e.referrer_host), ''), 'Direct / unknown') as source,
      coalesce(e.referrer_host, '') as referrer_host,
      coalesce(e.country_code, '') as country_code,
      coalesce(e.metadata ->> 'browser', '') as browser,
      coalesce(e.metadata ->> 'screen', '') as screen,
      coalesce(e.metadata ->> 'utm_source', '') as utm_source,
      coalesce(e.metadata ->> 'utm_medium', '') as utm_medium,
      coalesce(e.metadata ->> 'utm_campaign', '') as utm_campaign,
      coalesce(e.metadata ->> 'tracker_version', '') as tracker_version,
      coalesce(e.metadata ->> 'session', '') as session_id
    from raw_events e
    where e.event_type = 'pageview'
      and nullif(e.metadata ->> 'view_id', '') is not null
    order by e.metadata ->> 'view_id', e.occurred_at, e.id
  ), raw_signal_totals as materialized (
    select
      e.metadata ->> 'view_id' as view_key,
      coalesce(sum(e.value) filter (where e.event_type = 'active_time'), 0) as active_seconds,
      coalesce(max(e.value) filter (where e.event_type = 'scroll'), 0) as max_scroll,
      count(*) filter (where e.event_type = 'js_error')::integer as javascript_errors
    from raw_events e
    where nullif(e.metadata ->> 'view_id', '') is not null
    group by e.metadata ->> 'view_id'
  ), raw_key_event_names as materialized (
    select
      e.metadata ->> 'view_id' as view_key,
      coalesce(nullif(e.name, ''), e.event_type) as event_name,
      count(*)::bigint as event_count
    from raw_events e
    where e.event_type in ('click','outbound','form_success')
      and nullif(e.metadata ->> 'view_id', '') is not null
    group by e.metadata ->> 'view_id', coalesce(nullif(e.name, ''), e.event_type)
  ), raw_key_event_counts as materialized (
    select
      view_key,
      sum(event_count)::bigint as key_events,
      jsonb_object_agg(event_name, event_count) as key_event_counts
    from raw_key_event_names
    group by view_key
  ), raw_visible as materialized (
    select e.metadata ->> 'view_id' as view_key,
      array_agg(distinct e.name order by e.name) filter (where e.name is not null) as visible_sections
    from raw_events e
    where e.event_type = 'visible_section'
      and nullif(e.metadata ->> 'view_id', '') is not null
    group by e.metadata ->> 'view_id'
  ), raw_vital_values as materialized (
    select e.metadata ->> 'view_id' as view_key, upper(e.name) as metric,
      jsonb_agg(e.value order by e.occurred_at) filter (where e.value is not null) as values_json
    from raw_events e
    where e.event_type = 'web_vital' and e.name is not null
      and nullif(e.metadata ->> 'view_id', '') is not null
    group by e.metadata ->> 'view_id', upper(e.name)
  ), raw_vitals as materialized (
    select view_key, jsonb_object_agg(metric, values_json) as vitals
    from raw_vital_values group by view_key
  ), raw_views as materialized (
    select
      p.view_key,
      p.occurred_at,
      p.path,
      p.device,
      p.source,
      p.referrer_host,
      p.country_code,
      p.browser,
      p.screen,
      p.utm_source,
      p.utm_medium,
      p.utm_campaign,
      p.tracker_version,
      p.session_id,
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
    'events', coalesce((select jsonb_agg(to_jsonb(g) order by g.bucket_start) from event_groups g), '[]'::jsonb),
    'views', coalesce((select jsonb_agg(to_jsonb(v) order by v.occurred_at) from all_views v), '[]'::jsonb),
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

create or replace function public.analytics_event_definition_counts(
  p_property_id uuid,
  p_from timestamptz
)
returns table(event_type text, name text, received bigint, last_received_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.event_type, e.name, count(*)::bigint, max(e.occurred_at)
  from public.analytics_events e
  where e.property_id = p_property_id
    and e.occurred_at >= p_from
    and e.name is not null
  group by e.event_type, e.name;
$$;

revoke all on function public.analytics_event_definition_counts(uuid,timestamptz)
  from public, anon;
grant execute on function public.analytics_event_definition_counts(uuid,timestamptz)
  to authenticated, service_role;

-- Merge checkpoint state into the established daily view rollup after the
-- existing event aggregation has processed a completed UTC day.
create or replace function public.aggregate_analytics_view_states_day(p_day date)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare v_rows bigint;
begin
  insert into public.analytics_view_daily (
    property_id, day, view_key, occurred_at, path, device, source,
    source_category, source_type, referrer_host, country_code, browser, screen,
    utm_source, utm_medium, utm_campaign, tracker_version, session_id,
    active_seconds, max_scroll, key_events, javascript_errors,
    visible_sections, vitals, generated_at
  )
  select
    s.property_id, p_day, s.view_id, s.occurred_at, s.path, s.device,
    coalesce(nullif(s.source, ''), nullif(s.utm_source, ''), nullif(s.referrer_host, ''), 'Direct / unknown'),
    case
      when lower(coalesce(nullif(s.source, ''), nullif(s.utm_source, ''), nullif(s.referrer_host, ''), '')) in ('', 'direct', 'direct / unknown') then 'Direct / unknown'
      when lower(coalesce(nullif(s.source, ''), nullif(s.utm_source, ''), nullif(s.referrer_host, ''), '')) like '%google%' then 'Google'
      when lower(coalesce(nullif(s.source, ''), nullif(s.utm_source, ''), nullif(s.referrer_host, ''), '')) like '%linkedin%' then 'LinkedIn'
      when lower(coalesce(nullif(s.source, ''), nullif(s.utm_source, ''), nullif(s.referrer_host, ''), '')) like '%instagram%' then 'Instagram'
      else 'Other referrals' end,
    case
      when lower(coalesce(nullif(s.source, ''), nullif(s.utm_source, ''), nullif(s.referrer_host, ''), '')) in ('', 'direct', 'direct / unknown') then 'Direct'
      when lower(coalesce(nullif(s.source, ''), nullif(s.utm_source, ''), nullif(s.referrer_host, ''), '')) like '%google%' then 'Search'
      when lower(coalesce(nullif(s.source, ''), nullif(s.utm_source, ''), nullif(s.referrer_host, ''), '')) like '%linkedin%'
        or lower(coalesce(nullif(s.source, ''), nullif(s.utm_source, ''), nullif(s.referrer_host, ''), '')) like '%instagram%' then 'Social'
      else coalesce(nullif(s.utm_medium, ''), 'Referral') end,
    s.referrer_host, s.country_code, s.browser, s.screen, s.utm_source,
    s.utm_medium, s.utm_campaign, s.tracker_version, s.session_id,
    s.active_seconds, s.max_scroll,
    coalesce((select sum(value::bigint) from jsonb_each_text(s.key_event_counts)), 0),
    s.javascript_errors, s.visible_sections,
    (select coalesce(jsonb_object_agg(key, jsonb_build_array(value)), '{}'::jsonb)
      from jsonb_each(s.vitals)), now()
  from public.analytics_view_states s
  where s.occurred_at >= p_day::timestamptz
    and s.occurred_at < (p_day + 1)::timestamptz
  on conflict (property_id, day, view_key) do update set
    active_seconds = greatest(public.analytics_view_daily.active_seconds, excluded.active_seconds),
    max_scroll = greatest(public.analytics_view_daily.max_scroll, excluded.max_scroll),
    key_events = greatest(public.analytics_view_daily.key_events, excluded.key_events),
    javascript_errors = greatest(public.analytics_view_daily.javascript_errors, excluded.javascript_errors),
    visible_sections = excluded.visible_sections,
    vitals = public.analytics_view_daily.vitals || excluded.vitals,
    generated_at = now();
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.aggregate_analytics_view_states_day(date) from public, anon, authenticated;
grant execute on function public.aggregate_analytics_view_states_day(date) to service_role;

create or replace function public.prune_analytics_view_states(
  p_before timestamptz,
  p_limit integer default 10000
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare v_deleted bigint;
begin
  with doomed as (
    select property_id, view_id from public.analytics_view_states
    where occurred_at < p_before
    order by occurred_at
    limit least(50000, greatest(1, p_limit))
  )
  delete from public.analytics_view_states s using doomed d
  where s.property_id = d.property_id and s.view_id = d.view_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_analytics_view_states(timestamptz,integer)
  from public, anon, authenticated;
grant execute on function public.prune_analytics_view_states(timestamptz,integer) to service_role;

-- Free-plan detailed expiry must archive a KPI summary before deleting the
-- latest evidence-bearing run. Compact comparison history is governed by the
-- separate auditResultsDays policy, never by freeAuditExpiryDays.
create or replace function public.expire_free_audit_details(
  p_property_ids uuid[],
  p_before timestamptz
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare old_run public.audit_runs;
declare v_deleted bigint := 0;
begin
  for old_run in
    select * from public.audit_runs
    where property_id = any(p_property_ids)
      and created_at < p_before
      and status not in ('queued','running')
    order by created_at
  loop
    perform private.archive_audit_run(old_run);
    delete from public.audit_runs where id = old_run.id;
    v_deleted := v_deleted + 1;
  end loop;
  return v_deleted;
end;
$$;

revoke all on function public.expire_free_audit_details(uuid[],timestamptz)
  from public, anon, authenticated;
grant execute on function public.expire_free_audit_details(uuid[],timestamptz) to service_role;

create or replace function public.prune_audit_summaries(p_before timestamptz)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare v_deleted bigint;
begin
  delete from public.audit_run_summaries where created_at < p_before;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_audit_summaries(timestamptz)
  from public, anon, authenticated;
grant execute on function public.prune_audit_summaries(timestamptz) to service_role;

update public.platform_settings
set value = value || jsonb_build_object('auditSummaryDays', coalesce((value ->> 'auditResultsDays')::integer, 730)),
    description = 'Retention controls. Free detailed audits can expire independently; compact audit comparison history uses auditSummaryDays.'
where key = 'retention_policy';

-- Expand the existing privileged measurement RPC so production reporting can
-- distinguish logical row bytes from PostgreSQL heap/index allocation.
create or replace function public.superadmin_database_metrics()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with relations(name, relation) as (values
    ('analytics_events', 'public.analytics_events'::regclass),
    ('analytics_view_states', 'public.analytics_view_states'::regclass),
    ('analytics_hourly', 'public.analytics_hourly'::regclass),
    ('analytics_view_daily', 'public.analytics_view_daily'::regclass),
    ('analytics_daily', 'public.analytics_daily'::regclass),
    ('analytics_rollup_days', 'public.analytics_rollup_days'::regclass),
    ('audit_runs', 'public.audit_runs'::regclass),
    ('audit_results', 'public.audit_results'::regclass),
    ('audit_run_evidence', 'public.audit_run_evidence'::regclass),
    ('audit_run_summaries', 'public.audit_run_summaries'::regclass)
  ), physical as (
    select name,
      pg_relation_size(relation)::bigint as heap_bytes,
      pg_indexes_size(relation)::bigint as index_bytes,
      pg_total_relation_size(relation)::bigint as total_bytes
    from relations
  ), logical as (
    select 'analytics_events' name, count(*)::bigint rows, coalesce(sum(pg_column_size(t)),0)::bigint logical_bytes from public.analytics_events t
    union all select 'analytics_view_states', count(*), coalesce(sum(pg_column_size(t)),0) from public.analytics_view_states t
    union all select 'analytics_hourly', count(*), coalesce(sum(pg_column_size(t)),0) from public.analytics_hourly t
    union all select 'analytics_view_daily', count(*), coalesce(sum(pg_column_size(t)),0) from public.analytics_view_daily t
    union all select 'analytics_daily', count(*), coalesce(sum(pg_column_size(t)),0) from public.analytics_daily t
    union all select 'analytics_rollup_days', count(*), coalesce(sum(pg_column_size(t)),0) from public.analytics_rollup_days t
    union all select 'audit_runs', count(*), coalesce(sum(pg_column_size(t)),0) from public.audit_runs t
    union all select 'audit_results', count(*), coalesce(sum(pg_column_size(t)),0) from public.audit_results t
    union all select 'audit_run_evidence', count(*), coalesce(sum(pg_column_size(t)),0) from public.audit_run_evidence t
    union all select 'audit_run_summaries', count(*), coalesce(sum(pg_column_size(t)),0) from public.audit_run_summaries t
  )
  select jsonb_build_object(
    'databaseSizeBytes', pg_database_size(current_database()),
    'activeConnections', (select count(*) from pg_stat_activity where datname = current_database()),
    'maxConnections', current_setting('max_connections')::integer,
    'accountsTableBytes', pg_total_relation_size('public.accounts'::regclass),
    'propertiesTableBytes', pg_total_relation_size('public.properties'::regclass),
    'analyticsTableBytes', pg_total_relation_size('public.analytics_events'::regclass),
    'auditTableBytes', pg_total_relation_size('public.audit_runs'::regclass),
    'relations', (select jsonb_object_agg(p.name, jsonb_build_object(
      'rows', l.rows, 'logicalBytes', l.logical_bytes, 'heapBytes', p.heap_bytes,
      'indexBytes', p.index_bytes, 'totalBytes', p.total_bytes
    )) from physical p join logical l using(name)),
    'measuredAt', now(),
    'source', 'postgres_reported'
  );
$$;

revoke all on function public.superadmin_database_metrics() from public, anon, authenticated;
grant execute on function public.superadmin_database_metrics() to service_role;

insert into private.app_migrations(version, name, checksum)
values ('20261007002535', 'platform_performance_storage_optimization', 'self')
on conflict (version) do nothing;

commit;
