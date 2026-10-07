begin;

-- Consolidate each already-sanitised analytics delivery into one database
-- transaction. The Worker still performs the public tracking-key lookup and
-- origin check; this function re-checks every processing control and quota at
-- the write boundary.
create or replace function public.ingest_analytics_batch(
  p_property_id uuid,
  p_events jsonb,
  p_view_states jsonb,
  p_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property public.properties;
  v_account_state public.account_access_state;
  v_global_paused boolean;
  v_scoped_paused boolean;
  v_existing bigint;
  v_requested integer;
  v_inserted bigint := 0;
  v_states bigint := 0;
  v_state jsonb;
  v_key_event_counts jsonb;
begin
  if jsonb_typeof(coalesce(p_events, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_view_states, '[]'::jsonb)) <> 'array'
     or p_daily_limit < 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_batch');
  end if;

  select * into v_property
  from public.properties
  where id = p_property_id
  for update;
  if not found or not v_property.tracking_enabled then
    return jsonb_build_object('ok', false, 'error', 'unknown_property');
  end if;

  select access_state into v_account_state
  from public.accounts where id = v_property.account_id;
  select paused into v_global_paused
  from public.emergency_controls where key = 'analytics_ingestion';
  select paused into v_scoped_paused
  from public.account_service_controls
  where account_id = v_property.account_id and service = 'analytics';

  if v_global_paused is null then
    return jsonb_build_object('ok', false, 'error', 'safety_configuration_unavailable');
  elsif v_global_paused then
    return jsonb_build_object('ok', false, 'error', 'analytics_ingestion_paused');
  elsif v_account_state is distinct from 'active'::public.account_access_state then
    return jsonb_build_object('ok', false, 'error', 'account_processing_paused');
  elsif coalesce(v_scoped_paused, false) then
    return jsonb_build_object('ok', false, 'error', 'account_service_paused');
  elsif v_property.access_state is distinct from 'active'::public.resource_access_state then
    return jsonb_build_object('ok', false, 'error', 'property_processing_paused');
  end if;

  v_requested := jsonb_array_length(coalesce(p_events, '[]'::jsonb));
  select count(*) into v_existing
  from public.analytics_events
  where property_id = p_property_id
    and received_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  if v_existing + v_requested > p_daily_limit then
    return jsonb_build_object('ok', false, 'error', 'analytics_daily_limit_reached');
  end if;

  insert into public.analytics_events (
    property_id, event_type, path, referrer_host, source, device, country_code,
    name, value, metadata, occurred_at, received_at
  )
  select
    p_property_id,
    e ->> 'event_type',
    e ->> 'path',
    nullif(e ->> 'referrer_host', ''),
    nullif(e ->> 'source', ''),
    nullif(e ->> 'device', ''),
    nullif(e ->> 'country_code', ''),
    nullif(e ->> 'name', ''),
    nullif(e ->> 'value', '')::numeric,
    coalesce(e -> 'metadata', '{}'::jsonb),
    (e ->> 'occurred_at')::timestamptz,
    (e ->> 'received_at')::timestamptz
  from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) e
  where (e ->> 'event_type') not in ('click', 'form_success')
     or exists (
       select 1 from public.event_definitions d
       where d.property_id = p_property_id
         and d.enabled
         and d.event_type = e ->> 'event_type'
         and d.name = e ->> 'name'
     )
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  for v_state in
    select value from jsonb_array_elements(coalesce(p_view_states, '[]'::jsonb))
  loop
    select coalesce(jsonb_object_agg(filtered.name, filtered.event_count), '{}'::jsonb)
    into v_key_event_counts
    from (
      select
        substring(item.key from position(':' in item.key) + 1) as name,
        max(item.value::integer) as event_count
      from jsonb_each_text(coalesce(v_state -> 'key_event_counts', '{}'::jsonb)) item
      where position(':' in item.key) > 1
        and (
          split_part(item.key, ':', 1) = 'outbound'
          or exists (
            select 1 from public.event_definitions d
            where d.property_id = p_property_id
              and d.enabled
              and d.event_type = split_part(item.key, ':', 1)
              and d.name = substring(item.key from position(':' in item.key) + 1)
          )
        )
      group by substring(item.key from position(':' in item.key) + 1)
    ) filtered;
    v_state := jsonb_set(v_state, '{key_event_counts}', v_key_event_counts, true);
    if public.merge_analytics_view_state(p_property_id, v_state) then
      v_states := v_states + 1;
    end if;
  end loop;

  update public.properties set
    tracking_last_received_at = now(),
    verification_status = 'verified',
    verified_at = now()
  where id = p_property_id;

  return jsonb_build_object(
    'ok', true,
    'acceptedEvents', v_inserted,
    'acceptedViewStates', v_states
  );
end;
$$;

revoke all on function public.ingest_analytics_batch(uuid,jsonb,jsonb,integer)
  from public, anon, authenticated;
grant execute on function public.ingest_analytics_batch(uuid,jsonb,jsonb,integer)
  to service_role;

-- One preparation call replaces the monitor, global control, account control,
-- account state, property state and maintenance-window reads.
create or replace function public.prepare_uptime_check(p_monitor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_monitor public.uptime_monitors;
  v_property public.properties;
  v_account_state public.account_access_state;
  v_global_paused boolean;
  v_scoped_paused boolean;
  v_reason text;
  v_maintenance boolean;
begin
  select * into v_monitor from public.uptime_monitors where id = p_monitor_id;
  if not found or not v_monitor.enabled then
    return jsonb_build_object('run', false, 'reason', 'monitor_disabled');
  end if;
  select * into v_property from public.properties where id = v_monitor.property_id;
  select access_state into v_account_state from public.accounts where id = v_property.account_id;
  select paused into v_global_paused from public.emergency_controls where key = 'uptime_checks';
  select paused into v_scoped_paused from public.account_service_controls
  where account_id = v_property.account_id and service = 'uptime';

  v_reason := case
    when v_global_paused is null then 'safety_configuration_unavailable'
    when v_global_paused then 'uptime_checks_paused'
    when v_account_state is distinct from 'active'::public.account_access_state then 'account_processing_paused'
    when coalesce(v_scoped_paused, false) then 'account_service_paused'
    when v_property.access_state is distinct from 'active'::public.resource_access_state then 'property_processing_paused'
    else null
  end;
  if v_reason is not null then
    update public.uptime_monitors set
      last_status = 'monitoring_unavailable',
      next_check_at = now() + make_interval(mins => greatest(5, v_monitor.interval_minutes))
    where id = p_monitor_id;
    insert into public.operational_events (
      service, metric, value, unit, source, account_id, property_id, metadata
    ) values (
      'uptime', 'check_suppressed', 1, 'check', 'application_measured',
      v_property.account_id, v_property.id, jsonb_build_object('reason', v_reason)
    );
    return jsonb_build_object('run', false, 'reason', v_reason);
  end if;

  select exists (
    select 1 from public.maintenance_windows
    where monitor_id = p_monitor_id and starts_at <= now() and ends_at > now()
  ) into v_maintenance;

  return jsonb_build_object(
    'run', true,
    'id', v_monitor.id,
    'propertyId', v_monitor.property_id,
    'url', v_property.url,
    'timeoutMs', v_monitor.timeout_ms,
    'expectedStatusMin', v_monitor.expected_status_min,
    'expectedStatusMax', v_monitor.expected_status_max,
    'maintenance', v_maintenance
  );
end;
$$;

revoke all on function public.prepare_uptime_check(uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_uptime_check(uuid) to service_role;

-- One persistence call records the sample, advances monitor state, applies the
-- platform-failure guard and creates/resolves an incident atomically.
create or replace function public.persist_uptime_check(
  p_monitor_id uuid,
  p_checked_at timestamptz,
  p_success boolean,
  p_status_code integer,
  p_response_ms integer,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_monitor public.uptime_monitors;
  v_maintenance boolean;
  v_failures integer;
  v_status text;
  v_open public.incidents;
  v_incident public.incidents;
  v_distinct_failures integer := 0;
begin
  select * into v_monitor from public.uptime_monitors
  where id = p_monitor_id for update;
  if not found or not v_monitor.enabled then
    return jsonb_build_object('ok', false, 'error', 'monitor_disabled');
  end if;

  select exists (
    select 1 from public.maintenance_windows
    where monitor_id = p_monitor_id
      and starts_at <= p_checked_at and ends_at > p_checked_at
  ) into v_maintenance;

  insert into public.uptime_checks (
    monitor_id, checked_at, success, status_code, response_ms, error_code,
    suppressed_by_maintenance
  ) values (
    p_monitor_id, p_checked_at, p_success, p_status_code,
    greatest(0, p_response_ms), nullif(left(coalesce(p_error_code, ''), 1000), ''),
    v_maintenance
  );

  v_failures := case
    when v_maintenance then v_monitor.consecutive_failures
    when p_success then 0
    else v_monitor.consecutive_failures + 1
  end;
  v_status := case
    when p_success then 'online'
    when v_failures >= v_monitor.failure_threshold then 'offline'
    else 'suspected_down'
  end;
  update public.uptime_monitors set
    last_checked_at = p_checked_at,
    last_status = v_status,
    last_response_ms = greatest(0, p_response_ms),
    consecutive_failures = v_failures,
    next_check_at = p_checked_at + make_interval(mins => v_monitor.interval_minutes)
  where id = p_monitor_id;

  if v_maintenance then
    return jsonb_build_object('ok', true, 'transition', null, 'maintenance', true);
  end if;

  select * into v_open from public.incidents
  where monitor_id = p_monitor_id and resolved_at is null
  order by opened_at desc limit 1;

  if not p_success and v_failures >= v_monitor.failure_threshold then
    select count(distinct monitor_id)::integer into v_distinct_failures
    from public.uptime_checks
    where not success and checked_at >= p_checked_at - interval '3 minutes';
    if v_distinct_failures >= 5 then
      update public.uptime_monitors set last_status = 'monitoring_unavailable'
      where id = p_monitor_id;
      insert into public.platform_alerts(title, details) values (
        'Uptime monitoring failures span unrelated properties',
        jsonb_build_object(
          'distinctMonitors', v_distinct_failures,
          'windowMinutes', 3,
          'notificationSuppressedForProperty', v_monitor.property_id
        )
      );
      return jsonb_build_object('ok', true, 'transition', null, 'platformFailure', true);
    end if;
  end if;

  if not p_success and v_failures >= v_monitor.failure_threshold and v_open.id is null then
    insert into public.incidents(property_id, monitor_id, opened_at, cause)
    values (
      v_monitor.property_id, p_monitor_id, p_checked_at,
      coalesce(nullif(p_error_code, ''), 'HTTP ' || coalesce(p_status_code::text, 'unknown'))
    ) returning * into v_incident;
    return jsonb_build_object('ok', true, 'transition', 'down', 'incident', to_jsonb(v_incident));
  elsif p_success and v_open.id is not null then
    update public.incidents set resolved_at = p_checked_at
    where id = v_open.id returning * into v_incident;
    return jsonb_build_object('ok', true, 'transition', 'recovered', 'incident', to_jsonb(v_incident));
  end if;
  return jsonb_build_object('ok', true, 'transition', null);
end;
$$;

revoke all on function public.persist_uptime_check(uuid,timestamptz,boolean,integer,integer,text)
  from public, anon, authenticated;
grant execute on function public.persist_uptime_check(uuid,timestamptz,boolean,integer,integer,text)
  to service_role;

insert into private.app_migrations(version, name, checksum)
values ('20261007012144', 'consolidate_ingestion_and_uptime_persistence', 'self')
on conflict (version) do nothing;

commit;
