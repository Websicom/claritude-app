begin;

-- New self-serve accounts start on Free. Historical early-access accounts keep
-- their explicit package assignment or complimentary grant.
alter table public.accounts alter column entitlement set default 'free';

with orphaned_new_accounts as (
  select a.id
  from public.accounts a
  where a.entitlement = 'pro_early_access'
    and not exists (
      select 1 from public.account_package_assignments apa
      where apa.account_id = a.id and apa.ends_at is null
    )
    and not exists (
      select 1 from public.account_package_grants apg
      where apg.account_id = a.id
        and apg.status = 'active'
        and apg.starts_at <= now()
        and (apg.expires_at is null or apg.expires_at > now())
    )
)
update public.accounts a
set entitlement = 'free', entitlement_started_at = now()
from orphaned_new_accounts orphan
where a.id = orphan.id;

insert into public.account_package_assignments(
  account_id,
  package_version_id,
  price_grandfathered,
  allowances_grandfathered,
  complimentary,
  billing_state,
  starts_at
)
select
  a.id,
  pv.id,
  false,
  false,
  false,
  'unconfigured',
  coalesce(a.entitlement_started_at, now())
from public.accounts a
join lateral (
  select id
  from public.package_versions
  where package_key = 'free' and state = 'published'
  order by version desc
  limit 1
) pv on true
where a.entitlement = 'free'
  and not exists (
    select 1 from public.account_package_assignments apa
    where apa.account_id = a.id and apa.ends_at is null
  );

-- Uptime frequency is a plan entitlement. Free is intentionally the least
-- write-intensive tier; paid accounts may choose any slower interval too.
update public.package_versions
set
  allowances = jsonb_set(
    jsonb_set(
      allowances,
      '{uptimeIntervalMinutes}',
      to_jsonb(case
        when package_key in ('pro', 'pro_early_access') then 1
        when package_key = 'scale' then 2
        when package_key = 'essentials' then 5
        else 15
      end),
      true
    ),
    '{workspacesPerAccount}',
    case when package_key = 'free' then '1'::jsonb else coalesce(allowances->'workspacesPerAccount', 'null'::jsonb) end,
    true
  ),
  unresolved_values = array_remove(unresolved_values, 'uptimeIntervalMinutes')
where package_key in ('free', 'essentials', 'scale', 'pro', 'pro_early_access');

update public.package_versions
set unresolved_values = array_remove(unresolved_values, 'workspacesPerAccount')
where package_key = 'free';

alter table public.uptime_monitors
  drop constraint if exists uptime_monitors_interval_minutes_check;
alter table public.uptime_monitors
  add constraint uptime_monitors_interval_minutes_check
  check (interval_minutes in (1, 2, 5, 10, 15, 30, 60));
alter table public.uptime_monitors alter column interval_minutes set default 15;

-- Existing Free monitors cannot remain on a paid-tier frequency. Existing paid
-- monitors are deliberately not accelerated; customers may retain a slower
-- interval they selected themselves.
update public.uptime_monitors m
set interval_minutes = 15
from public.properties p
join public.workspaces w on w.id = p.workspace_id
join public.accounts a on a.id = w.account_id
where m.property_id = p.id
  and m.interval_minutes < 15
  and coalesce((
    select pv.package_key
    from public.account_package_grants apg
    join public.package_versions pv on pv.id = apg.package_version_id
    where apg.account_id = a.id
      and apg.status = 'active'
      and apg.starts_at <= now()
      and (apg.expires_at is null or apg.expires_at > now())
    order by apg.created_at desc
    limit 1
  ), (
    select pv.package_key
    from public.account_package_assignments apa
    join public.package_versions pv on pv.id = apa.package_version_id
    where apa.account_id = a.id and apa.ends_at is null
    order by apa.starts_at desc
    limit 1
  ), a.entitlement, 'free') = 'free';

-- Every property receives its primary audit page at creation time, regardless
-- of which trusted application path creates it.
create or replace function public.create_property_homepage_audit_page()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
begin
  select wm.user_id into actor_id
  from public.workspace_memberships wm
  where wm.workspace_id = new.workspace_id
    and wm.role in ('owner', 'member')
  order by case when wm.role = 'owner' then 0 else 1 end, wm.created_at
  limit 1;

  if actor_id is not null then
    insert into public.property_audit_pages(property_id, name, path, created_by)
    values (new.id, 'Homepage', '/', actor_id)
    on conflict(property_id, path) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.create_property_homepage_audit_page() from public, anon, authenticated;

drop trigger if exists property_homepage_audit_page_created on public.properties;
create trigger property_homepage_audit_page_created
after insert on public.properties
for each row execute function public.create_property_homepage_audit_page();

insert into public.property_audit_pages(property_id, name, path, created_by)
select p.id, 'Homepage', '/', actor.user_id
from public.properties p
join public.workspaces w on w.id = p.workspace_id
join lateral (
  select wm.user_id
  from public.workspace_memberships wm
  where wm.workspace_id = w.id and wm.role in ('owner', 'member')
  order by case when wm.role = 'owner' then 0 else 1 end, wm.created_at
  limit 1
) actor on true
where not exists (
  select 1 from public.property_audit_pages pap
  where pap.property_id = p.id and pap.path = '/'
)
on conflict(property_id, path) do nothing;

create or replace function public.complete_onboarding(
  p_account_name text,
  p_workspace_name text,
  p_property_name text default null,
  p_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  aid uuid;
  wid uuid;
  pid uuid;
  host text;
  free_package_id uuid;
begin
  if uid is null then raise exception 'authentication required'; end if;
  if exists(select 1 from public.account_memberships where user_id = uid) then
    raise exception 'onboarding already complete';
  end if;
  if nullif(trim(p_account_name), '') is null or char_length(trim(p_account_name)) > 100 then
    raise exception 'valid account name required';
  end if;
  if nullif(trim(p_workspace_name), '') is null or char_length(trim(p_workspace_name)) > 100 then
    raise exception 'valid workspace name required';
  end if;

  select id into free_package_id
  from public.package_versions
  where package_key = 'free' and state = 'published'
  order by version desc
  limit 1;
  if free_package_id is null then raise exception 'free_package_unavailable'; end if;

  insert into public.accounts(name, entitlement)
  values(trim(p_account_name), 'free')
  returning id into aid;

  insert into public.account_memberships(account_id, user_id, role)
  values(aid, uid, 'owner');

  insert into public.account_package_assignments(
    account_id, package_version_id, billing_state, starts_at
  ) values (aid, free_package_id, 'unconfigured', now());

  insert into public.workspaces(account_id, name)
  values(aid, trim(p_workspace_name))
  returning id into wid;

  insert into public.workspace_memberships(workspace_id, user_id, role)
  values(wid, uid, 'owner');

  update public.profiles
  set full_name = trim(p_workspace_name), updated_at = now()
  where id = uid
    and (full_name is null or nullif(trim(full_name), '') is null or lower(trim(full_name)) = 'claritude user');

  if nullif(trim(p_property_name), '') is not null and nullif(trim(p_url), '') is not null then
    host := lower(regexp_replace(p_url, '^https?://([^/]+).*$', '\1', 'i'));
    insert into public.properties(workspace_id, name, url, canonical_host, tracking_id)
    values(wid, trim(p_property_name), trim(p_url), host, 'cl_' || replace(gen_random_uuid()::text, '-', ''))
    returning id into pid;

    update public.uptime_monitors
    set interval_minutes = 15, next_check_at = now(), enabled = true
    where property_id = pid;
  end if;

  insert into public.activity_log(account_id, actor_id, action, property_id)
  values(aid, uid, 'onboarding.completed', pid);

  return jsonb_build_object('accountId', aid, 'workspaceId', wid, 'propertyId', pid);
end;
$$;

revoke all on function public.complete_onboarding(text, text, text, text) from public, anon;
grant execute on function public.complete_onboarding(text, text, text, text) to authenticated;

create or replace function public.create_workspace(p_account_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  wid uuid;
  workspace_limit integer;
  override_limit integer;
  workspace_count integer;
begin
  if uid is null then raise exception 'authentication required'; end if;
  if nullif(trim(p_name), '') is null or char_length(trim(p_name)) > 100 then
    raise exception 'valid workspace name required';
  end if;
  if not exists(
    select 1 from public.account_memberships
    where account_id = p_account_id and user_id = uid and role in ('owner', 'member')
  ) then raise exception 'workspace access denied'; end if;

  perform pg_advisory_xact_lock(hashtextextended('workspace-limit:' || p_account_id::text, 0));

  select coalesce(
    (
      select nullif(pv.allowances->>'workspacesPerAccount', '')::integer
      from public.account_package_grants apg
      join public.package_versions pv on pv.id = apg.package_version_id
      where apg.account_id = p_account_id
        and apg.status = 'active'
        and apg.starts_at <= now()
        and (apg.expires_at is null or apg.expires_at > now())
      order by apg.created_at desc
      limit 1
    ),
    (
      select nullif(pv.allowances->>'workspacesPerAccount', '')::integer
      from public.account_package_assignments apa
      join public.package_versions pv on pv.id = apa.package_version_id
      where apa.account_id = p_account_id and apa.ends_at is null
      order by apa.starts_at desc
      limit 1
    ),
    case when a.entitlement = 'free' then 1 else null end
  ) into workspace_limit
  from public.accounts a
  where a.id = p_account_id;

  select (override_row.value #>> '{}')::integer
  into override_limit
  from (
    select aeo.value
    from public.account_entitlement_overrides aeo
    where aeo.account_id = p_account_id
      and aeo.key = 'workspacesPerAccount'
      and aeo.revoked_at is null
      and aeo.starts_at <= now()
      and (aeo.expires_at is null or aeo.expires_at > now())
    order by aeo.starts_at desc
    limit 1
  ) override_row;
  if override_limit is not null then workspace_limit := greatest(0, override_limit); end if;

  select count(*) into workspace_count
  from public.workspaces where account_id = p_account_id;
  if workspace_limit is not null and workspace_count >= workspace_limit then
    raise exception 'workspace_limit_reached';
  end if;

  insert into public.workspaces(account_id, name)
  values (p_account_id, trim(p_name)) returning id into wid;
  insert into public.workspace_memberships(workspace_id, user_id, role)
  values (wid, uid, 'owner');
  insert into public.activity_log(account_id, actor_id, action, metadata)
  values (p_account_id, uid, 'workspace.created', jsonb_build_object('workspace_id', wid));
  return jsonb_build_object('workspaceId', wid);
end;
$$;

revoke all on function public.create_workspace(uuid, text) from public, anon;
grant execute on function public.create_workspace(uuid, text) to authenticated;

insert into private.app_migrations(version, name, checksum)
values ('20261008152841', 'fix_free_account_provisioning', 'self')
on conflict(version) do nothing;

commit;
