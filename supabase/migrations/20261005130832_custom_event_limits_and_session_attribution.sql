begin;

create or replace function private.custom_event_limit(p_entitlement text)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when regexp_replace(lower(coalesce(p_entitlement, '')), '[^a-z0-9]+', '', 'g') in ('pro', 'proearlyaccess') then null
    when regexp_replace(lower(coalesce(p_entitlement, '')), '[^a-z0-9]+', '', 'g') like 'pro%' then null
    when regexp_replace(lower(coalesce(p_entitlement, '')), '[^a-z0-9]+', '', 'g') like 'scale%' then 20
    when regexp_replace(lower(coalesce(p_entitlement, '')), '[^a-z0-9]+', '', 'g') like 'essentials%' then 5
    else 2
  end;
$$;

revoke all on function private.custom_event_limit(text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.custom_event_limit(text) to service_role;

-- Event definitions are commercial configuration, not analytics observations.
-- Keep the plan check and insert in one short transaction so concurrent creates
-- cannot both pass the same allowance check.
create or replace function public.create_event_definition_limited(
  p_property_id uuid,
  p_name text,
  p_event_type text,
  p_description text default null,
  p_match_settings jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entitlement text;
  v_limit integer;
  v_used integer;
  v_created public.event_definitions;
begin
  if p_name is null or p_name !~ '^[a-z0-9_-]{1,80}$' then
    raise exception using errcode = '22023', message = 'event_name_required';
  end if;
  if p_event_type not in ('click', 'pageview', 'form_success') then
    raise exception using errcode = '22023', message = 'unsupported_event_type';
  end if;
  if p_match_settings is null or jsonb_typeof(p_match_settings) <> 'object' then
    raise exception using errcode = '22023', message = 'valid_event_match_settings_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text, 0));

  select a.entitlement
  into v_entitlement
  from public.properties p
  join public.workspaces w on w.id = p.workspace_id
  join public.accounts a on a.id = w.account_id
  where p.id = p_property_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'property_not_found';
  end if;

  v_limit := private.custom_event_limit(v_entitlement);
  select count(*)::integer
  into v_used
  from public.event_definitions d
  where d.property_id = p_property_id;

  if v_limit is not null and v_used >= v_limit then
    raise exception using
      errcode = 'P0001',
      message = 'custom_event_plan_limit_reached',
      detail = json_build_object('used', v_used, 'limit', v_limit)::text;
  end if;

  insert into public.event_definitions (
    property_id,
    name,
    event_type,
    description,
    match_settings
  ) values (
    p_property_id,
    p_name,
    p_event_type,
    nullif(trim(p_description), ''),
    p_match_settings
  )
  returning * into v_created;

  return to_jsonb(v_created);
end;
$$;

revoke all on function public.create_event_definition_limited(uuid,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_event_definition_limited(uuid,text,text,text,jsonb)
  to service_role;

-- Authenticated clients retain read/update access for the existing management
-- UI, but all creates must pass through the Worker and the atomic RPC above.
revoke insert on public.event_definitions from authenticated;

comment on function public.create_event_definition_limited(uuid,text,text,text,jsonb) is
  'Atomically enforces the property account plan allowance before creating a configured custom event. Built-in analytics observations are stored separately and never count here.';

insert into private.app_migrations(version, name, checksum)
values ('20261005130832', 'custom_event_limits_and_session_attribution', 'self')
on conflict (version) do nothing;

commit;
