begin;

alter table public.profiles
  add column if not exists date_format text not null default 'DD/MM/YYYY'
  check (date_format in ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'));

alter table public.uptime_monitors
  alter column interval_minutes set default 10;

create or replace function public.delete_event_definition_with_data(
  p_property_id uuid,
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_event_type text;
  v_deleted_events bigint := 0;
begin
  if not exists (
    select 1
    from public.properties p
    where p.id = p_property_id
      and private.can_manage_workspace(p.workspace_id)
  ) then
    raise exception 'property_manage_access_required';
  end if;

  select name, event_type
    into v_name, v_event_type
  from public.event_definitions
  where id = p_event_id and property_id = p_property_id;

  if v_name is null then
    raise exception 'event_definition_not_found';
  end if;

  with impacted_views as (
    select e.metadata ->> 'view_id' as view_key, count(*)::bigint as event_count
    from public.analytics_events e
    where e.property_id = p_property_id
      and e.name = v_name
      and e.event_type = v_event_type
      and nullif(e.metadata ->> 'view_id', '') is not null
    group by e.metadata ->> 'view_id'
  )
  update public.analytics_view_daily v
  set key_events = greatest(0, v.key_events - impacted_views.event_count)
  from impacted_views
  where v.property_id = p_property_id and v.view_key = impacted_views.view_key;

  delete from public.analytics_events
  where property_id = p_property_id
    and name = v_name
    and event_type = v_event_type;
  get diagnostics v_deleted_events = row_count;

  delete from public.analytics_daily
  where property_id = p_property_id and name = v_name and event_type = v_event_type;

  delete from public.analytics_hourly
  where property_id = p_property_id and name = v_name and event_type = v_event_type;

  delete from public.event_definitions
  where id = p_event_id and property_id = p_property_id;

  return jsonb_build_object(
    'deleted', true,
    'name', v_name,
    'eventType', v_event_type,
    'deletedOccurrences', v_deleted_events
  );
end
$$;

revoke all on function public.delete_event_definition_with_data(uuid, uuid)
  from public, anon;
grant execute on function public.delete_event_definition_with_data(uuid, uuid)
  to authenticated, service_role;

comment on function public.delete_event_definition_with_data(uuid, uuid) is
  'Atomically deletes one configured custom event and its matching collected occurrences after workspace-management authorization.';

create or replace function public.reset_property_data(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_monitor_id uuid;
begin
  if not exists (
    select 1 from public.properties p
    where p.id = p_property_id and private.can_manage_workspace(p.workspace_id)
  ) then
    raise exception 'property_manage_access_required';
  end if;

  select id into v_monitor_id from public.uptime_monitors where property_id = p_property_id;
  if v_monitor_id is not null then
    delete from public.uptime_checks where monitor_id = v_monitor_id;
    delete from public.maintenance_windows where monitor_id = v_monitor_id;
  end if;
  delete from public.incidents where property_id = p_property_id;
  delete from public.analytics_events where property_id = p_property_id;
  delete from public.analytics_daily where property_id = p_property_id;
  delete from public.analytics_hourly where property_id = p_property_id;
  delete from public.analytics_view_daily where property_id = p_property_id;
  delete from public.analytics_rollup_days where property_id = p_property_id;
  delete from public.event_definitions where property_id = p_property_id;
  delete from public.audit_runs where property_id = p_property_id;
  delete from public.saved_reports where property_id = p_property_id;
  delete from public.notifications where property_id = p_property_id;

  update public.uptime_monitors
  set consecutive_failures = 0,
      last_status = case when enabled then 'pending' else 'paused' end,
      last_response_ms = null,
      last_checked_at = null,
      next_check_at = now()
  where property_id = p_property_id;

  update public.properties
  set verification_status = 'pending',
      tracking_last_received_at = null,
      updated_at = now()
  where id = p_property_id;

  return jsonb_build_object('reset', true, 'propertyId', p_property_id);
end
$$;

revoke all on function public.reset_property_data(uuid) from public, anon;
grant execute on function public.reset_property_data(uuid) to authenticated, service_role;

comment on function public.reset_property_data(uuid) is
  'Clears property analytics, uptime observations/incidents, audits, configured custom events, saved reports and property notifications while retaining the property, workspace/account membership, property viewers, monitor configuration, recipients and report schedules.';

insert into private.app_migrations(version, name, checksum)
values ('20261006000012', 'settings_profile_date_format_and_defaults', 'self')
on conflict (version) do nothing;

commit;
