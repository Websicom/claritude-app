begin;

-- The product rules live in one server-owned table so ingestion, retention and
-- SuperAdmin all read the same values. Pageview limits are pooled per account.
create table public.analytics_plan_rules (
  package_key text primary key,
  display_name text not null,
  properties_limit integer not null check (properties_limit > 0),
  monthly_pageview_limit bigint not null check (monthly_pageview_limit > 0),
  grace_percent numeric(5,2) not null default 0 check (grace_percent between 0 and 100),
  detailed_days integer not null default 30 check (detailed_days > 0),
  hourly_days integer not null default 30 check (hourly_days > 0),
  daily_months integer not null check (daily_months > 0),
  monthly_months integer check (monthly_months is null or monthly_months > 0),
  yearly_lifetime boolean not null default true,
  cap_action text not null default 'pause_analytics' check (cap_action in ('pause_analytics')),
  updated_at timestamptz not null default now()
);

insert into public.analytics_plan_rules (
  package_key, display_name, properties_limit, monthly_pageview_limit,
  grace_percent, detailed_days, hourly_days, daily_months, monthly_months
) values
  ('free', 'Free', 2, 10000, 0, 30, 30, 13, 24),
  ('essentials', 'Essentials', 5, 100000, 5, 30, 30, 36, 60),
  ('scale', 'Scale', 50, 1000000, 5, 30, 30, 60, 84),
  ('pro', 'Pro', 200, 5000000, 5, 30, 30, 84, null)
on conflict (package_key) do update set
  display_name = excluded.display_name,
  properties_limit = excluded.properties_limit,
  monthly_pageview_limit = excluded.monthly_pageview_limit,
  grace_percent = excluded.grace_percent,
  detailed_days = excluded.detailed_days,
  hourly_days = excluded.hourly_days,
  daily_months = excluded.daily_months,
  monthly_months = excluded.monthly_months,
  yearly_lifetime = excluded.yearly_lifetime,
  cap_action = excluded.cap_action,
  updated_at = now();

update public.platform_settings
set value = jsonb_set(value, '{analyticsRawDays}', '30'::jsonb, true), updated_at = now()
where key = 'retention_policy';

-- Keep the package projection aligned for existing allocation screens. The
-- dedicated rules table remains authoritative for analytics enforcement.
update public.package_versions pv
set
  allowances = pv.allowances || jsonb_build_object(
    'trackedPageviewsPerMonth', r.monthly_pageview_limit,
    'analyticsGracePercent', r.grace_percent
  ),
  retention = pv.retention || jsonb_build_object(
    'analyticsDetailedDays', r.detailed_days,
    'analyticsHourlyDays', r.hourly_days,
    'analyticsDailyMonths', r.daily_months,
    'analyticsMonthlyMonths', r.monthly_months,
    'analyticsYearlyLifetime', r.yearly_lifetime
  ),
  hard_ceilings = pv.hard_ceilings || jsonb_build_object(
    'propertiesPerAccount', r.properties_limit,
    'trackedPageviewsPerMonth', r.monthly_pageview_limit
  )
from public.analytics_plan_rules r
where r.package_key = case when pv.package_key = 'pro_early_access' then 'pro' else pv.package_key end;

create table public.account_analytics_monthly_usage (
  account_id uuid not null references public.accounts on delete cascade,
  period_start date not null,
  accepted_pageviews bigint not null default 0 check (accepted_pageviews >= 0),
  rejected_pageviews bigint not null default 0 check (rejected_pageviews >= 0),
  updated_at timestamptz not null default now(),
  primary key (account_id, period_start),
  check (extract(day from period_start) = 1)
);

create table public.analytics_usage_warnings (
  account_id uuid not null references public.accounts on delete cascade,
  period_start date not null,
  threshold integer not null check (threshold in (70, 80, 90, 100, 101)),
  pageviews bigint not null,
  limit_pageviews bigint not null,
  state text not null default 'pending' check (state in ('pending', 'sent', 'skipped', 'failed')),
  attempted_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  primary key (account_id, period_start, threshold)
);

-- Long-term analytics contains one total row plus independent dimension rows.
-- It deliberately does not preserve the high-cardinality cross-product cube.
create table public.analytics_compact_totals (
  property_id uuid not null references public.properties on delete cascade,
  grain text not null check (grain in ('day', 'month', 'year')),
  period_start date not null,
  pageviews bigint not null default 0,
  events bigint not null default 0,
  key_events bigint not null default 0,
  sessions bigint not null default 0,
  eligible_views bigint not null default 0,
  engaged_views bigint not null default 0,
  active_seconds numeric not null default 0,
  scroll_25 bigint not null default 0,
  scroll_50 bigint not null default 0,
  scroll_75 bigint not null default 0,
  scroll_90 bigint not null default 0,
  generated_at timestamptz not null default now(),
  primary key (property_id, grain, period_start)
);

create table public.analytics_compact_dimensions (
  property_id uuid not null references public.properties on delete cascade,
  grain text not null check (grain in ('day', 'month', 'year')),
  period_start date not null,
  dimension text not null check (dimension in ('page', 'source', 'country', 'device', 'browser', 'screen', 'campaign', 'event')),
  value text not null,
  pageviews bigint not null default 0,
  events bigint not null default 0,
  active_seconds numeric not null default 0,
  active_views bigint not null default 0,
  generated_at timestamptz not null default now(),
  primary key (property_id, grain, period_start, dimension, value)
);

create index analytics_compact_totals_property_period_idx
  on public.analytics_compact_totals (property_id, period_start, grain);
create index analytics_compact_dimensions_property_period_idx
  on public.analytics_compact_dimensions (property_id, period_start, grain, dimension);

create table public.analytics_storage_snapshots (
  snapshot_date date not null,
  scope_type text not null check (scope_type in ('account', 'property')),
  scope_id uuid not null,
  account_id uuid not null references public.accounts on delete cascade,
  property_id uuid references public.properties on delete cascade,
  detailed_bytes bigint not null default 0,
  rollup_bytes bigint not null default 0,
  total_bytes bigint not null default 0,
  measured_at timestamptz not null default now(),
  source text not null default 'postgres_logical_row_estimate',
  primary key (snapshot_date, scope_type, scope_id),
  check ((scope_type = 'property' and property_id = scope_id) or (scope_type = 'account' and property_id is null and account_id = scope_id))
);
create index analytics_storage_snapshots_account_idx on public.analytics_storage_snapshots(account_id, snapshot_date desc);
create index analytics_storage_snapshots_property_idx on public.analytics_storage_snapshots(property_id, snapshot_date desc) where property_id is not null;

alter table public.analytics_plan_rules enable row level security;
alter table public.account_analytics_monthly_usage enable row level security;
alter table public.analytics_usage_warnings enable row level security;
alter table public.analytics_compact_totals enable row level security;
alter table public.analytics_compact_dimensions enable row level security;
alter table public.analytics_storage_snapshots enable row level security;

revoke all on public.analytics_plan_rules, public.account_analytics_monthly_usage,
  public.analytics_usage_warnings, public.analytics_compact_totals,
  public.analytics_compact_dimensions, public.analytics_storage_snapshots
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.analytics_plan_rules,
  public.account_analytics_monthly_usage, public.analytics_usage_warnings,
  public.analytics_compact_totals, public.analytics_compact_dimensions,
  public.analytics_storage_snapshots to service_role;
grant select on public.analytics_compact_totals, public.analytics_compact_dimensions to authenticated;

create policy analytics_compact_totals_select on public.analytics_compact_totals
  for select to authenticated using ((select private.can_access_property(property_id)));
create policy analytics_compact_dimensions_select on public.analytics_compact_dimensions
  for select to authenticated using ((select private.can_access_property(property_id)));

create or replace function private.analytics_package_key(p_account_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_key text;
begin
  select coalesce(
    (select pv.package_key
     from public.account_package_grants g
     join public.package_versions pv on pv.id = g.package_version_id
     where g.account_id = p_account_id and g.status = 'active'
       and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now())
     order by g.created_at desc limit 1),
    (select pv.package_key
     from public.account_package_assignments a
     join public.package_versions pv on pv.id = a.package_version_id
     where a.account_id = p_account_id and a.starts_at <= now()
       and (a.ends_at is null or a.ends_at > now())
     order by a.starts_at desc limit 1),
    (select entitlement from public.accounts where id = p_account_id),
    'free'
  ) into v_key;
  v_key := regexp_replace(lower(v_key), '[^a-z0-9]+', '', 'g');
  if v_key like 'pro%' then return 'pro'; end if;
  if v_key like 'scale%' then return 'scale'; end if;
  if v_key like 'essentials%' then return 'essentials'; end if;
  return 'free';
end;
$$;
revoke all on function private.analytics_package_key(uuid) from public, anon, authenticated;
grant execute on function private.analytics_package_key(uuid) to service_role;

create or replace function public.aggregate_analytics_compact_day(p_day date)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_property_id uuid;
  v_total_rows bigint := 0;
  v_dimension_rows bigint := 0;
  v_inserted_dimensions bigint := 0;
begin
  for v_property_id in
    select distinct property_id from public.analytics_rollup_days where day = p_day
  loop
    insert into public.analytics_compact_totals (
      property_id, grain, period_start, pageviews, events, key_events, sessions,
      eligible_views, engaged_views, active_seconds, scroll_25, scroll_50,
      scroll_75, scroll_90, generated_at
    )
    select
      v_property_id, 'day', p_day,
      coalesce((select sum(event_count) from public.analytics_hourly where property_id = v_property_id and bucket_start >= p_day::timestamptz and bucket_start < (p_day + 1)::timestamptz and event_type = 'pageview'), 0),
      coalesce((select sum(event_count) from public.analytics_hourly where property_id = v_property_id and bucket_start >= p_day::timestamptz and bucket_start < (p_day + 1)::timestamptz), 0),
      coalesce((select sum(event_count) from public.analytics_hourly where property_id = v_property_id and bucket_start >= p_day::timestamptz and bucket_start < (p_day + 1)::timestamptz and event_type in ('click','outbound','form_success')), 0),
      coalesce((select count(distinct nullif(session_id, '')) from public.analytics_view_daily where property_id = v_property_id and day = p_day), 0),
      coalesce((select count(*) from public.analytics_view_daily where property_id = v_property_id and day = p_day), 0),
      coalesce((select count(*) from public.analytics_view_daily where property_id = v_property_id and day = p_day and (active_seconds >= 10 or max_scroll >= 50 or key_events > 0)), 0),
      coalesce((select sum(active_seconds) from public.analytics_view_daily where property_id = v_property_id and day = p_day), 0),
      coalesce((select count(*) from public.analytics_view_daily where property_id = v_property_id and day = p_day and max_scroll >= 25), 0),
      coalesce((select count(*) from public.analytics_view_daily where property_id = v_property_id and day = p_day and max_scroll >= 50), 0),
      coalesce((select count(*) from public.analytics_view_daily where property_id = v_property_id and day = p_day and max_scroll >= 75), 0),
      coalesce((select count(*) from public.analytics_view_daily where property_id = v_property_id and day = p_day and max_scroll >= 90), 0),
      now()
    on conflict (property_id, grain, period_start) do update set
      pageviews = excluded.pageviews, events = excluded.events,
      key_events = excluded.key_events, sessions = excluded.sessions,
      eligible_views = excluded.eligible_views, engaged_views = excluded.engaged_views,
      active_seconds = excluded.active_seconds, scroll_25 = excluded.scroll_25,
      scroll_50 = excluded.scroll_50, scroll_75 = excluded.scroll_75,
      scroll_90 = excluded.scroll_90, generated_at = now();
    v_total_rows := v_total_rows + 1;

    delete from public.analytics_compact_dimensions
    where property_id = v_property_id and grain = 'day' and period_start = p_day;

    with event_dimensions as (
      select 'page'::text dimension, path value,
        sum(event_count) filter (where event_type = 'pageview')::bigint pageviews,
        sum(event_count) filter (where event_type in ('click','outbound','form_success'))::bigint events
      from public.analytics_hourly where property_id = v_property_id and bucket_start >= p_day::timestamptz and bucket_start < (p_day + 1)::timestamptz group by path
      union all
      select 'source', source_category, sum(event_count) filter (where event_type = 'pageview')::bigint, sum(event_count) filter (where event_type in ('click','outbound','form_success'))::bigint
      from public.analytics_hourly where property_id = v_property_id and bucket_start >= p_day::timestamptz and bucket_start < (p_day + 1)::timestamptz group by source_category
      union all
      select 'country', coalesce(nullif(country_code,''),'Unknown'), sum(event_count) filter (where event_type = 'pageview')::bigint, 0
      from public.analytics_hourly where property_id = v_property_id and bucket_start >= p_day::timestamptz and bucket_start < (p_day + 1)::timestamptz group by coalesce(nullif(country_code,''),'Unknown')
      union all
      select 'device', coalesce(nullif(device,''),'Unknown'), sum(event_count) filter (where event_type = 'pageview')::bigint, 0
      from public.analytics_hourly where property_id = v_property_id and bucket_start >= p_day::timestamptz and bucket_start < (p_day + 1)::timestamptz group by coalesce(nullif(device,''),'Unknown')
      union all
      select 'browser', coalesce(nullif(browser,''),'Unknown'), sum(event_count) filter (where event_type = 'pageview')::bigint, 0
      from public.analytics_hourly where property_id = v_property_id and bucket_start >= p_day::timestamptz and bucket_start < (p_day + 1)::timestamptz group by coalesce(nullif(browser,''),'Unknown')
      union all
      select 'screen', coalesce(nullif(screen,''),'Unknown'), sum(event_count) filter (where event_type = 'pageview')::bigint, 0
      from public.analytics_hourly where property_id = v_property_id and bucket_start >= p_day::timestamptz and bucket_start < (p_day + 1)::timestamptz group by coalesce(nullif(screen,''),'Unknown')
      union all
      select 'campaign', utm_campaign, sum(event_count) filter (where event_type = 'pageview')::bigint, 0
      from public.analytics_hourly where property_id = v_property_id and bucket_start >= p_day::timestamptz and bucket_start < (p_day + 1)::timestamptz and utm_campaign <> '' group by utm_campaign
      union all
      select 'event', coalesce(nullif(name,''),event_type), 0, sum(event_count)::bigint
      from public.analytics_hourly where property_id = v_property_id and bucket_start >= p_day::timestamptz and bucket_start < (p_day + 1)::timestamptz and event_type in ('click','outbound','form_success') group by coalesce(nullif(name,''),event_type)
    ), view_pages as (
      select path, sum(active_seconds) active_seconds, count(*) active_views
      from public.analytics_view_daily where property_id = v_property_id and day = p_day group by path
    )
    insert into public.analytics_compact_dimensions (
      property_id, grain, period_start, dimension, value, pageviews, events,
      active_seconds, active_views, generated_at
    )
    select v_property_id, 'day', p_day, e.dimension, e.value,
      coalesce(e.pageviews,0), coalesce(e.events,0),
      case when e.dimension = 'page' then coalesce(v.active_seconds,0) else 0 end,
      case when e.dimension = 'page' then coalesce(v.active_views,0) else 0 end,
      now()
    from event_dimensions e
    left join view_pages v on e.dimension = 'page' and v.path = e.value
    where coalesce(e.pageviews,0) > 0 or coalesce(e.events,0) > 0;
    get diagnostics v_inserted_dimensions = row_count;
    v_dimension_rows := v_dimension_rows + v_inserted_dimensions;
  end loop;
  return jsonb_build_object('totals', v_total_rows, 'dimensions', v_dimension_rows);
end;
$$;

create or replace function public.aggregate_analytics_compact_period(p_grain text, p_period_start date)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_end date;
  v_totals bigint;
  v_dimensions bigint;
begin
  if p_grain not in ('month','year') then raise exception 'invalid compact grain'; end if;
  v_end := case when p_grain = 'month' then (p_period_start + interval '1 month')::date else (p_period_start + interval '1 year')::date end;
  delete from public.analytics_compact_totals where grain = p_grain and period_start = p_period_start;
  delete from public.analytics_compact_dimensions where grain = p_grain and period_start = p_period_start;
  insert into public.analytics_compact_totals (
    property_id, grain, period_start, pageviews, events, key_events, sessions,
    eligible_views, engaged_views, active_seconds, scroll_25, scroll_50,
    scroll_75, scroll_90, generated_at
  )
  select property_id, p_grain, p_period_start, sum(pageviews), sum(events),
    sum(key_events), sum(sessions), sum(eligible_views), sum(engaged_views),
    sum(active_seconds), sum(scroll_25), sum(scroll_50), sum(scroll_75),
    sum(scroll_90), now()
  from public.analytics_compact_totals
  where grain = 'day' and period_start >= p_period_start and period_start < v_end
  group by property_id;
  get diagnostics v_totals = row_count;
  insert into public.analytics_compact_dimensions (
    property_id, grain, period_start, dimension, value, pageviews, events,
    active_seconds, active_views, generated_at
  )
  select property_id, p_grain, p_period_start, dimension, value,
    sum(pageviews), sum(events), sum(active_seconds), sum(active_views), now()
  from public.analytics_compact_dimensions
  where grain = 'day' and period_start >= p_period_start and period_start < v_end
  group by property_id, dimension, value;
  get diagnostics v_dimensions = row_count;
  return jsonb_build_object('totals', v_totals, 'dimensions', v_dimensions);
end;
$$;

revoke all on function public.aggregate_analytics_compact_day(date), public.aggregate_analytics_compact_period(text,date)
  from public, anon, authenticated;
grant execute on function public.aggregate_analytics_compact_day(date), public.aggregate_analytics_compact_period(text,date)
  to service_role;

create or replace function public.analytics_compact_rollup_window(
  p_property_id uuid, p_from timestamptz, p_to timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select p_from::date from_day, p_to::date to_day
  ), chosen as (
    select t.* from public.analytics_compact_totals t, bounds b
    where t.property_id = p_property_id and t.grain = 'day'
      and t.period_start between b.from_day and b.to_day
    union all
    select t.* from public.analytics_compact_totals t, bounds b
    where t.property_id = p_property_id and t.grain = 'month'
      and t.period_start <= b.to_day and (t.period_start + interval '1 month')::date > b.from_day
      and not exists (
        select 1 from public.analytics_compact_totals d
        where d.property_id = t.property_id and d.grain = 'day'
          and date_trunc('month', d.period_start)::date = t.period_start
      )
    union all
    select t.* from public.analytics_compact_totals t, bounds b
    where t.property_id = p_property_id and t.grain = 'year'
      and t.period_start <= b.to_day and (t.period_start + interval '1 year')::date > b.from_day
      and not exists (
        select 1 from public.analytics_compact_totals d
        where d.property_id = t.property_id and d.grain in ('day','month')
          and date_trunc('year', d.period_start)::date = t.period_start
      )
  ), dimensions as (
    select d.* from public.analytics_compact_dimensions d
    join chosen c using (property_id, grain, period_start)
  )
  select jsonb_build_object(
    'totals', coalesce((select jsonb_agg(to_jsonb(c) order by period_start) from chosen c), '[]'::jsonb),
    'dimensions', coalesce((select jsonb_agg(to_jsonb(d) order by period_start, dimension, value) from dimensions d), '[]'::jsonb),
    'detailedFrom', (current_date - 30)::text
  );
$$;
revoke all on function public.analytics_compact_rollup_window(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.analytics_compact_rollup_window(uuid,timestamptz,timestamptz) to authenticated, service_role;

create or replace function public.prune_analytics_retention(p_limit integer default 50000)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_events bigint := 0; v_states bigint := 0; v_hourly bigint := 0;
  v_views bigint := 0; v_legacy bigint := 0; v_daily bigint := 0; v_monthly bigint := 0;
begin
  delete from public.analytics_storage_snapshots where snapshot_date < current_date - 90;
  delete from public.analytics_usage_warnings where created_at < now() - interval '2 years';
  -- Detail is deleted only when the replacement daily summary exists.
  with targets as (
    select e.ctid from public.analytics_events e
    where e.occurred_at < (current_date - 30)::timestamptz
      and exists (select 1 from public.analytics_compact_totals t where t.property_id=e.property_id and t.grain='day' and t.period_start=e.occurred_at::date)
    limit greatest(1,p_limit)
  ) delete from public.analytics_events e using targets t where e.ctid=t.ctid;
  get diagnostics v_events = row_count;
  with targets as (
    select s.ctid from public.analytics_view_states s
    where s.occurred_at < (current_date - 30)::timestamptz
      and exists (select 1 from public.analytics_compact_totals t where t.property_id=s.property_id and t.grain='day' and t.period_start=s.occurred_at::date)
    limit greatest(1,p_limit)
  ) delete from public.analytics_view_states s using targets t where s.ctid=t.ctid;
  get diagnostics v_states = row_count;
  with targets as (
    select h.ctid from public.analytics_hourly h
    where h.bucket_start < (current_date - 30)::timestamptz
      and exists (select 1 from public.analytics_compact_totals t where t.property_id=h.property_id and t.grain='day' and t.period_start=h.bucket_start::date)
    limit greatest(1,p_limit)
  ) delete from public.analytics_hourly h using targets t where h.ctid=t.ctid;
  get diagnostics v_hourly = row_count;
  with targets as (
    select v.ctid from public.analytics_view_daily v
    where v.day < current_date - 30
      and exists (select 1 from public.analytics_compact_totals t where t.property_id=v.property_id and t.grain='day' and t.period_start=v.day)
    limit greatest(1,p_limit)
  ) delete from public.analytics_view_daily v using targets t where v.ctid=t.ctid;
  get diagnostics v_views = row_count;
  with targets as (
    select d.ctid from public.analytics_daily d
    where d.day < current_date - 30
      and exists (select 1 from public.analytics_compact_totals t where t.property_id=d.property_id and t.grain='day' and t.period_start=d.day)
    limit greatest(1,p_limit)
  ) delete from public.analytics_daily d using targets t where d.ctid=t.ctid;
  get diagnostics v_legacy = row_count;
  delete from public.analytics_rollup_days r
  where r.day < current_date - 30
    and exists (select 1 from public.analytics_compact_totals t where t.property_id=r.property_id and t.grain='day' and t.period_start=r.day);

  with expired as (
    select t.property_id, t.period_start
    from public.analytics_compact_totals t
    join public.properties p on p.id=t.property_id
    join public.analytics_plan_rules r on r.package_key=private.analytics_package_key(p.account_id)
    where t.grain='day' and t.period_start < date_trunc('month', current_date - make_interval(months => r.daily_months))::date
    limit greatest(1,p_limit)
  ), dims as (
    delete from public.analytics_compact_dimensions d using expired e
    where d.property_id=e.property_id and d.grain='day' and d.period_start=e.period_start returning 1
  ) delete from public.analytics_compact_totals t using expired e
    where t.property_id=e.property_id and t.grain='day' and t.period_start=e.period_start;
  get diagnostics v_daily = row_count;

  with expired as (
    select t.property_id, t.period_start
    from public.analytics_compact_totals t
    join public.properties p on p.id=t.property_id
    join public.analytics_plan_rules r on r.package_key=private.analytics_package_key(p.account_id)
    where t.grain='month' and r.monthly_months is not null
      and t.period_start < date_trunc('year', current_date - make_interval(months => r.monthly_months))::date
    limit greatest(1,p_limit)
  ), dims as (
    delete from public.analytics_compact_dimensions d using expired e
    where d.property_id=e.property_id and d.grain='month' and d.period_start=e.period_start returning 1
  ) delete from public.analytics_compact_totals t using expired e
    where t.property_id=e.property_id and t.grain='month' and t.period_start=e.period_start;
  get diagnostics v_monthly = row_count;
  return jsonb_build_object('events',v_events,'viewStates',v_states,'hourly',v_hourly,'viewDaily',v_views,'legacyDaily',v_legacy,'dailyPeriods',v_daily,'monthlyPeriods',v_monthly);
end;
$$;
revoke all on function public.prune_analytics_retention(integer) from public, anon, authenticated;
grant execute on function public.prune_analytics_retention(integer) to service_role;

create or replace function public.refresh_analytics_storage_snapshots()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare v_properties bigint; v_accounts bigint;
begin
  delete from public.analytics_storage_snapshots where snapshot_date = current_date;
  with sizes as (
    select property_id, sum(bytes)::bigint detailed_bytes, 0::bigint rollup_bytes from (
      select property_id, pg_column_size(e.*)::bigint bytes from public.analytics_events e
      union all select property_id, pg_column_size(s.*)::bigint from public.analytics_view_states s
      union all select property_id, pg_column_size(h.*)::bigint from public.analytics_hourly h
      union all select property_id, pg_column_size(v.*)::bigint from public.analytics_view_daily v
    ) x group by property_id
    union all
    select property_id, 0, sum(bytes)::bigint from (
      select property_id, pg_column_size(t.*)::bigint bytes from public.analytics_compact_totals t
      union all select property_id, pg_column_size(d.*)::bigint from public.analytics_compact_dimensions d
    ) x group by property_id
  ), combined as (
    select p.id property_id, p.account_id, coalesce(sum(s.detailed_bytes),0)::bigint detailed_bytes,
      coalesce(sum(s.rollup_bytes),0)::bigint rollup_bytes
    from public.properties p left join sizes s on s.property_id=p.id group by p.id,p.account_id
  )
  insert into public.analytics_storage_snapshots(snapshot_date,scope_type,scope_id,account_id,property_id,detailed_bytes,rollup_bytes,total_bytes,measured_at)
  select current_date,'property',property_id,account_id,property_id,detailed_bytes,rollup_bytes,detailed_bytes+rollup_bytes,now() from combined;
  get diagnostics v_properties = row_count;
  insert into public.analytics_storage_snapshots(snapshot_date,scope_type,scope_id,account_id,property_id,detailed_bytes,rollup_bytes,total_bytes,measured_at)
  select current_date,'account',account_id,account_id,null,sum(detailed_bytes),sum(rollup_bytes),sum(total_bytes),now()
  from public.analytics_storage_snapshots where snapshot_date=current_date and scope_type='property' group by account_id;
  get diagnostics v_accounts = row_count;
  return jsonb_build_object('properties',v_properties,'accounts',v_accounts,'measuredAt',now(),'source','postgres_logical_row_estimate');
end;
$$;
revoke all on function public.refresh_analytics_storage_snapshots() from public, anon, authenticated;
grant execute on function public.refresh_analytics_storage_snapshots() to service_role;

-- Enforce the pooled monthly quota in the same transaction as insertion.
create or replace function public.ingest_analytics_batch(
  p_property_id uuid, p_events jsonb, p_view_states jsonb, p_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property public.properties; v_account_state public.account_access_state;
  v_global_paused boolean; v_scoped_paused boolean; v_existing bigint;
  v_requested integer; v_inserted bigint := 0; v_inserted_pageviews bigint := 0;
  v_states bigint := 0; v_state jsonb; v_key_event_counts jsonb;
  v_rule public.analytics_plan_rules; v_usage public.account_analytics_monthly_usage;
  v_period date := date_trunc('month', current_date)::date; v_hard_limit bigint;
  v_requested_pageviews bigint; v_before_percent numeric; v_after_percent numeric;
  v_threshold integer;
begin
  if jsonb_typeof(coalesce(p_events,'[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_view_states,'[]'::jsonb)) <> 'array' or p_daily_limit < 1 then
    return jsonb_build_object('ok',false,'error','invalid_batch');
  end if;
  select * into v_property from public.properties where id=p_property_id for update;
  if not found or not v_property.tracking_enabled then return jsonb_build_object('ok',false,'error','unknown_property'); end if;
  select access_state into v_account_state from public.accounts where id=v_property.account_id;
  select paused into v_global_paused from public.emergency_controls where key='analytics_ingestion';
  select paused into v_scoped_paused from public.account_service_controls where account_id=v_property.account_id and service='analytics';
  if v_global_paused is null then return jsonb_build_object('ok',false,'error','safety_configuration_unavailable');
  elsif v_global_paused then return jsonb_build_object('ok',false,'error','analytics_ingestion_paused');
  elsif v_account_state is distinct from 'active'::public.account_access_state then return jsonb_build_object('ok',false,'error','account_processing_paused');
  elsif coalesce(v_scoped_paused,false) then return jsonb_build_object('ok',false,'error','account_service_paused');
  elsif v_property.access_state is distinct from 'active'::public.resource_access_state then return jsonb_build_object('ok',false,'error','property_processing_paused'); end if;

  select * into v_rule from public.analytics_plan_rules where package_key=private.analytics_package_key(v_property.account_id);
  if not found then return jsonb_build_object('ok',false,'error','analytics_plan_rule_unavailable'); end if;
  insert into public.account_analytics_monthly_usage(account_id,period_start) values(v_property.account_id,v_period) on conflict do nothing;
  select * into v_usage from public.account_analytics_monthly_usage where account_id=v_property.account_id and period_start=v_period for update;
  v_hard_limit := floor(v_rule.monthly_pageview_limit * (1 + v_rule.grace_percent / 100));
  select count(*) into v_requested_pageviews
  from jsonb_array_elements(coalesce(p_events,'[]'::jsonb)) e
  where e->>'event_type'='pageview'
    and (
      nullif(e->'metadata'->>'event_id','') is null
      or not exists (
        select 1 from public.analytics_events existing
        where existing.property_id=p_property_id
          and existing.metadata->>'event_id'=e->'metadata'->>'event_id'
      )
    );
  if v_usage.accepted_pageviews + v_requested_pageviews > v_hard_limit then
    update public.account_analytics_monthly_usage set rejected_pageviews=rejected_pageviews+v_requested_pageviews,updated_at=now() where account_id=v_property.account_id and period_start=v_period;
    insert into public.analytics_usage_warnings(account_id,period_start,threshold,pageviews,limit_pageviews)
      values(v_property.account_id,v_period,101,v_usage.accepted_pageviews,v_rule.monthly_pageview_limit) on conflict do nothing;
    return jsonb_build_object('ok',false,'error','analytics_monthly_pageview_limit_reached','used',v_usage.accepted_pageviews,'limit',v_rule.monthly_pageview_limit,'hardLimit',v_hard_limit,'resetAt',(v_period+interval '1 month'));
  end if;
  v_requested := jsonb_array_length(coalesce(p_events,'[]'::jsonb));
  select count(*) into v_existing from public.analytics_events where property_id=p_property_id and received_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  if v_existing+v_requested > p_daily_limit then return jsonb_build_object('ok',false,'error','analytics_daily_limit_reached'); end if;

  with inserted as (
    insert into public.analytics_events(property_id,event_type,path,referrer_host,source,device,country_code,name,value,metadata,occurred_at,received_at)
    select p_property_id,e->>'event_type',e->>'path',nullif(e->>'referrer_host',''),nullif(e->>'source',''),nullif(e->>'device',''),nullif(e->>'country_code',''),nullif(e->>'name',''),nullif(e->>'value','')::numeric,coalesce(e->'metadata','{}'::jsonb),(e->>'occurred_at')::timestamptz,(e->>'received_at')::timestamptz
    from jsonb_array_elements(coalesce(p_events,'[]'::jsonb)) e
    where (e->>'event_type') not in ('click','form_success') or exists(select 1 from public.event_definitions d where d.property_id=p_property_id and d.enabled and d.event_type=e->>'event_type' and d.name=e->>'name')
    on conflict do nothing returning event_type
  ) select count(*),count(*) filter(where event_type='pageview') into v_inserted,v_inserted_pageviews from inserted;
  v_before_percent := case when v_rule.monthly_pageview_limit > 0 then v_usage.accepted_pageviews * 100.0 / v_rule.monthly_pageview_limit else 0 end;
  update public.account_analytics_monthly_usage set accepted_pageviews=accepted_pageviews+v_inserted_pageviews,updated_at=now() where account_id=v_property.account_id and period_start=v_period returning * into v_usage;
  v_after_percent := v_usage.accepted_pageviews * 100.0 / v_rule.monthly_pageview_limit;
  foreach v_threshold in array array[70,80,90,100] loop
    if v_before_percent < v_threshold and v_after_percent >= v_threshold then
      insert into public.analytics_usage_warnings(account_id,period_start,threshold,pageviews,limit_pageviews)
      values(v_property.account_id,v_period,v_threshold,v_usage.accepted_pageviews,v_rule.monthly_pageview_limit) on conflict do nothing;
    end if;
  end loop;
  if v_usage.accepted_pageviews - v_inserted_pageviews < v_hard_limit
     and v_usage.accepted_pageviews >= v_hard_limit then
    insert into public.analytics_usage_warnings(account_id,period_start,threshold,pageviews,limit_pageviews)
    values(v_property.account_id,v_period,101,v_usage.accepted_pageviews,v_rule.monthly_pageview_limit)
    on conflict do nothing;
  end if;
  for v_state in select value from jsonb_array_elements(coalesce(p_view_states,'[]'::jsonb)) loop
    select coalesce(jsonb_object_agg(filtered.name,filtered.event_count),'{}'::jsonb) into v_key_event_counts from (
      select substring(item.key from position(':' in item.key)+1) name,max(item.value::integer) event_count
      from jsonb_each_text(coalesce(v_state->'key_event_counts','{}'::jsonb)) item
      where position(':' in item.key)>1 and (split_part(item.key,':',1)='outbound' or exists(select 1 from public.event_definitions d where d.property_id=p_property_id and d.enabled and d.event_type=split_part(item.key,':',1) and d.name=substring(item.key from position(':' in item.key)+1)))
      group by substring(item.key from position(':' in item.key)+1)
    ) filtered;
    v_state := jsonb_set(v_state,'{key_event_counts}',v_key_event_counts,true);
    if public.merge_analytics_view_state(p_property_id,v_state) then v_states:=v_states+1; end if;
  end loop;
  update public.properties set tracking_last_received_at=now(),verification_status='verified',verified_at=now() where id=p_property_id;
  return jsonb_build_object('ok',true,'acceptedEvents',v_inserted,'acceptedViewStates',v_states,'monthlyPageviews',v_usage.accepted_pageviews,'monthlyLimit',v_rule.monthly_pageview_limit,'hardLimit',v_hard_limit);
end;
$$;
revoke all on function public.ingest_analytics_batch(uuid,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.ingest_analytics_batch(uuid,jsonb,jsonb,integer) to service_role;

-- Backfill every already completed rollup day before the new cleanup is used.
do $$ declare v_day date; begin
  for v_day in select distinct day from public.analytics_rollup_days order by day loop
    perform public.aggregate_analytics_compact_day(v_day);
  end loop;
  for v_day in select distinct date_trunc('month',period_start)::date from public.analytics_compact_totals where grain='day' loop
    perform public.aggregate_analytics_compact_period('month',v_day);
  end loop;
  for v_day in select distinct date_trunc('year',period_start)::date from public.analytics_compact_totals where grain='day' loop
    perform public.aggregate_analytics_compact_period('year',v_day);
  end loop;
end $$;

comment on table public.analytics_plan_rules is 'Authoritative account-wide analytics quotas and tiered retention rules displayed in SuperAdmin.';
comment on table public.analytics_compact_dimensions is 'Lossless per-dimension long-term summaries; canonical pages are never collapsed into Other.';
comment on table public.analytics_storage_snapshots is 'Cached logical row-size estimates by property/account; excludes shared indexes and provider overhead.';

commit;
