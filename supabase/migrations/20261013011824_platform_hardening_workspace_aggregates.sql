begin;

-- Free sign-up admission is deliberately separate from the processing controls:
-- existing accounts continue to work while new free registrations are paused.
alter table public.emergency_controls
  drop constraint if exists emergency_controls_key_check;
alter table public.emergency_controls
  add constraint emergency_controls_key_check check (key in (
    'new_audits', 'scheduled_audits', 'browser_collection', 'uptime_checks',
    'uptime_notifications', 'analytics_ingestion', 'reports', 'campaigns',
    'free_signups'
  ));
insert into public.emergency_controls(key)
values ('free_signups')
on conflict (key) do nothing;

-- Workspace charts previously made one analytics request per property. This
-- compact RPC reads the existing daily aggregate layer once and returns only
-- the values needed by the workspace UI. It creates no duplicate storage.
create or replace function public.workspace_traffic_summary(
  p_workspace_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with permitted_properties as (
    select p.id
    from public.properties p
    where p.workspace_id = p_workspace_id
  ), daily as (
    select
      t.property_id,
      t.period_start as day,
      sum(t.pageviews)::bigint as pageviews,
      sum(t.sessions)::bigint as sessions,
      sum(t.key_events)::bigint as events
    from public.analytics_compact_totals t
    join permitted_properties p on p.id = t.property_id
    where t.grain = 'day'
      and t.period_start between p_from and p_to
    group by t.property_id, t.period_start
  ), analytics_by_property as (
    select
      property_id,
      sum(pageviews)::bigint as pageviews,
      sum(sessions)::bigint as sessions,
      sum(events)::bigint as events
    from daily
    group by property_id
  ), uptime_by_property as (
    select
      m.property_id,
      round(avg(case when c.success then 100.0 else 0.0 end), 2) as availability
    from public.uptime_monitors m
    join permitted_properties p on p.id = m.property_id
    join public.uptime_checks c on c.monitor_id = m.id
    where c.checked_at >= p_from::timestamptz
      and c.checked_at < (p_to + 1)::timestamptz
    group by m.property_id
  ), by_property as (
    select
      p.id as property_id,
      coalesce(a.pageviews, 0)::bigint as pageviews,
      coalesce(a.sessions, 0)::bigint as sessions,
      coalesce(a.events, 0)::bigint as events,
      u.availability
    from permitted_properties p
    left join analytics_by_property a on a.property_id = p.id
    left join uptime_by_property u on u.property_id = p.id
  ), by_day as (
    select
      day,
      sum(pageviews)::bigint as pageviews,
      sum(sessions)::bigint as sessions,
      sum(events)::bigint as events
    from daily
    group by day
  )
  select jsonb_build_object(
    'properties', coalesce((
      select jsonb_object_agg(property_id::text, jsonb_build_object(
        'pageviews', pageviews,
        'dailyVisitors', sessions,
        'events', events,
        'availability', availability
      )) from by_property
    ), '{}'::jsonb),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', day,
        'pageviews', pageviews,
        'dailyVisitors', sessions,
        'events', events
      ) order by day) from by_day
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.workspace_traffic_summary(uuid, date, date)
  from public, anon;
grant execute on function public.workspace_traffic_summary(uuid, date, date)
  to authenticated;

-- Operational measurements are property-scoped diagnostics, not an account
-- limit ledger. Purge them with the property; account_usage_periods and audit
-- credit reservations remain account-scoped and preserve billable usage.
alter table public.operational_events
  drop constraint if exists operational_events_property_id_fkey;
alter table public.operational_events
  add constraint operational_events_property_id_fkey
  foreign key (property_id) references public.properties(id) on delete cascade;

-- The notification centre filters by unread/archive state plus account or
-- property. Small partial indexes avoid scanning a user's complete history.
create index if not exists notifications_active_account_idx
  on public.notifications (user_id, account_id, created_at desc)
  where read_at is null;
create index if not exists notifications_active_property_idx
  on public.notifications (user_id, property_id, created_at desc)
  where read_at is null;
create index if not exists notifications_archived_user_idx
  on public.notifications (user_id, created_at desc)
  where read_at is not null;

-- Avoid overlapping permissive SELECT policies. Management remains explicit
-- per command while read access continues to include property viewers.
drop policy if exists workspace_member_select on public.workspaces;
drop policy if exists workspace_property_viewer_select on public.workspaces;
create policy workspace_access_select on public.workspaces
  for select to authenticated
  using (
    (select private.is_workspace_member(id)) or exists (
      select 1 from public.properties p
      join public.property_memberships pm on pm.property_id = p.id
      where p.workspace_id = workspaces.id and pm.user_id = (select auth.uid())
    )
  );

drop policy if exists property_membership_manage on public.property_memberships;
create policy property_membership_manage_insert on public.property_memberships for insert to authenticated
  with check ((select private.can_manage_property(property_id)));
create policy property_membership_manage_update on public.property_memberships for update to authenticated
  using ((select private.can_manage_property(property_id))) with check ((select private.can_manage_property(property_id)));
create policy property_membership_manage_delete on public.property_memberships for delete to authenticated
  using ((select private.can_manage_property(property_id)));

drop policy if exists property_audit_pages_manage on public.property_audit_pages;
create policy property_audit_pages_manage_insert on public.property_audit_pages for insert to authenticated
  with check ((select private.can_manage_property(property_id)));
create policy property_audit_pages_manage_update on public.property_audit_pages for update to authenticated
  using ((select private.can_manage_property(property_id))) with check ((select private.can_manage_property(property_id)));
create policy property_audit_pages_manage_delete on public.property_audit_pages for delete to authenticated
  using ((select private.can_manage_property(property_id)));

do $$
declare
  item record;
begin
  for item in select * from (values
    ('alert_recipients', 'recipients_manage'),
    ('event_definitions', 'event_definition_manage'),
    ('saved_reports', 'saved_report_manage'),
    ('report_schedules', 'schedule_manage')
  ) as policies(table_name, policy_name)
  loop
    execute format('drop policy if exists %I on public.%I', item.policy_name, item.table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.can_manage_property(property_id)))', item.policy_name || '_insert', item.table_name);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.can_manage_property(property_id))) with check ((select private.can_manage_property(property_id)))', item.policy_name || '_update', item.table_name);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.can_manage_property(property_id)))', item.policy_name || '_delete', item.table_name);
  end loop;
end $$;

commit;
