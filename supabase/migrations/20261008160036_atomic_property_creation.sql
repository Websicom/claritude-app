begin;

-- Property provisioning is one transaction. Previously the Worker inserted the
-- property and then configured its monitor/audit page in separate requests. A
-- later failure could therefore report an error after the property had already
-- committed, and a retry would misleadingly report that the plan limit had
-- been reached.
create or replace function public.create_property_atomic(
  p_account_id uuid,
  p_workspace_id uuid,
  p_name text,
  p_url text,
  p_canonical_host text,
  p_tracking_id text,
  p_uptime_interval integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_account_id uuid;
  v_property_limit integer;
  v_property_count integer;
  v_duplicate_id uuid;
  v_property public.properties;
  v_monitor_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  select w.account_id
  into v_workspace_account_id
  from public.workspaces w
  join public.workspace_memberships wm on wm.workspace_id = w.id
  where w.id = p_workspace_id
    and wm.user_id = v_user_id
    and wm.role in ('owner', 'member');

  if v_workspace_account_id is null or v_workspace_account_id <> p_account_id then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception using errcode = '22023', message = 'property_name_required';
  end if;

  if p_uptime_interval not in (1, 2, 5, 10, 15, 30, 60) then
    raise exception using errcode = '22023', message = 'invalid_uptime_interval';
  end if;

  -- Serialize creation within an account so concurrent requests cannot both
  -- observe spare allowance and exceed the plan limit.
  perform pg_advisory_xact_lock(hashtextextended('property:' || p_account_id::text, 0));

  select least(r.properties_limit, 200)
  into v_property_limit
  from public.analytics_plan_rules r
  where r.package_key = private.analytics_package_key(p_account_id);

  if v_property_limit is null then
    raise exception using errcode = 'P0002', message = 'analytics_plan_rule_unavailable';
  end if;

  select count(*)::integer
  into v_property_count
  from public.properties p
  where p.account_id = p_account_id;

  if v_property_count >= v_property_limit then
    raise exception using errcode = 'P0001', message = 'property_limit_reached';
  end if;

  select p.id
  into v_duplicate_id
  from public.properties p
  where p.account_id = p_account_id
    and p.resource_identity = lower(trim(trailing '/' from p_url))
  limit 1;

  if v_duplicate_id is not null then
    raise exception using errcode = '23505', message = 'property_already_exists_in_account';
  end if;

  insert into public.properties (
    workspace_id,
    name,
    url,
    canonical_host,
    tracking_id
  ) values (
    p_workspace_id,
    left(trim(p_name), 100),
    p_url,
    p_canonical_host,
    p_tracking_id
  )
  returning * into v_property;

  -- The existing insert triggers create both the monitor and Homepage audit
  -- page inside this same transaction. Configure the new monitor before the
  -- transaction can commit.
  update public.uptime_monitors
  set interval_minutes = p_uptime_interval,
      next_check_at = now(),
      enabled = true
  where property_id = v_property.id
  returning id into v_monitor_id;

  if v_monitor_id is null then
    raise exception using errcode = 'P0002', message = 'property_monitor_missing';
  end if;

  insert into public.activity_log (
    account_id,
    actor_id,
    action,
    property_id,
    metadata
  ) values (
    p_account_id,
    v_user_id,
    'property.created',
    v_property.id,
    jsonb_build_object('workspaceId', p_workspace_id)
  );

  return jsonb_build_object(
    'property', to_jsonb(v_property),
    'monitorId', v_monitor_id
  );
end;
$$;

revoke all on function public.create_property_atomic(uuid,uuid,text,text,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.create_property_atomic(uuid,uuid,text,text,text,text,integer)
  to authenticated;

-- Direct authenticated inserts could bypass the account-wide allowance. All
-- user-driven property creation now goes through the transactional RPC.
revoke insert on public.properties from authenticated;

comment on function public.create_property_atomic(uuid,uuid,text,text,text,text,integer) is
  'Atomically enforces account property allowance and provisions the property, default uptime monitor, Homepage audit page and activity record.';

insert into private.app_migrations(version, name, checksum)
values ('20261008160036', 'atomic_property_creation', 'self')
on conflict(version) do nothing;

commit;
