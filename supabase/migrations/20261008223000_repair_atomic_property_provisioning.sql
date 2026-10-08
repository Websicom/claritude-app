begin;

-- Restore the table-level invariant as a defence for every trusted insertion
-- path. Production was missing this older trigger even though the repository
-- contained it, which is what exposed the atomic creator's hidden dependency.
create or replace function public.create_property_uptime_monitor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.uptime_monitors(property_id)
  values (new.id)
  on conflict(property_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_property_uptime_monitor()
  from public, anon, authenticated;

drop trigger if exists property_uptime_monitor_created on public.properties;
create trigger property_uptime_monitor_created
after insert on public.properties
for each row execute function public.create_property_uptime_monitor();

insert into public.uptime_monitors(property_id)
select p.id
from public.properties p
left join public.uptime_monitors m on m.property_id = p.id
where m.id is null
on conflict(property_id) do nothing;

-- Keep property provisioning self-contained. The atomic creator must not rely
-- on separate table triggers having already materialised the related monitor
-- and Homepage audit page. ON CONFLICT keeps this compatible with deployments
-- where those defensive triggers are present.
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

  insert into public.uptime_monitors (
    property_id,
    interval_minutes,
    next_check_at,
    enabled
  ) values (
    v_property.id,
    p_uptime_interval,
    now(),
    true
  )
  on conflict(property_id) do update
  set interval_minutes = excluded.interval_minutes,
      next_check_at = excluded.next_check_at,
      enabled = excluded.enabled
  returning id into v_monitor_id;

  insert into public.property_audit_pages (
    property_id,
    name,
    path,
    created_by
  ) values (
    v_property.id,
    'Homepage',
    '/',
    v_user_id
  )
  on conflict(property_id, path) do nothing;

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

comment on function public.create_property_atomic(uuid,uuid,text,text,text,text,integer) is
  'Atomically enforces the account property allowance and explicitly provisions the property, uptime monitor, Homepage audit page and activity record.';

insert into private.app_migrations(version, name, checksum)
values ('20261008223000', 'repair_atomic_property_provisioning', 'self')
on conflict(version) do nothing;

commit;
