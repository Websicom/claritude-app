create table public.account_package_grants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  package_version_id uuid not null references public.package_versions(id) on delete restrict,
  arrangement text not null default 'complimentary' check (arrangement = 'complimentary'),
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  expiry_behavior text not null default 'return_to_standard' check (expiry_behavior = 'return_to_standard'),
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  created_by uuid references public.staff_members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.staff_members(user_id) on delete set null,
  revoked_reason text,
  check (expires_at is null or expires_at > starts_at),
  check ((status = 'active' and revoked_at is null) or status <> 'active')
);

create unique index account_package_grants_one_active_idx
  on public.account_package_grants(account_id)
  where status = 'active';
create index account_package_grants_effective_idx
  on public.account_package_grants(account_id, status, starts_at, expires_at);

alter table public.account_entitlement_overrides
  add column grant_id uuid references public.account_package_grants(id) on delete cascade,
  add column revoked_at timestamptz,
  add column revoked_by uuid references public.staff_members(user_id) on delete set null;

create index account_entitlement_overrides_grant_idx
  on public.account_entitlement_overrides(grant_id)
  where grant_id is not null;

create or replace function public.apply_complimentary_package_grant_internal(
  p_account_id uuid,
  p_package_version_id uuid,
  p_expires_at timestamptz,
  p_reason text,
  p_overrides jsonb,
  p_actor uuid
)
returns public.account_package_grants
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_grant public.account_package_grants;
  override_entry record;
begin
  perform 1 from public.accounts where id = p_account_id for update;
  if not found then raise exception 'account_not_found'; end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'reason_required'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'grant_expiry_must_be_future'; end if;
  if not exists (
    select 1 from public.package_versions
    where id = p_package_version_id and state = 'published' and effective_at <= now()
  ) then raise exception 'published_package_version_required'; end if;
  if coalesce(jsonb_typeof(p_overrides), 'object') <> 'object' then raise exception 'overrides_must_be_object'; end if;

  update public.account_package_grants
  set status = case when expires_at is not null and expires_at <= now() then 'expired' else 'revoked' end,
      revoked_at = now(), revoked_by = p_actor,
      revoked_reason = case when expires_at is not null and expires_at <= now() then 'Expired before replacement' else 'Replaced by a newer complimentary grant' end
  where account_id = p_account_id and status = 'active';

  update public.account_entitlement_overrides
  set revoked_at = now(), revoked_by = p_actor
  where account_id = p_account_id and grant_id is not null and revoked_at is null;

  insert into public.account_package_grants(
    account_id, package_version_id, expires_at, reason, created_by
  ) values (
    p_account_id, p_package_version_id, p_expires_at, trim(p_reason), p_actor
  ) returning * into created_grant;

  for override_entry in select key, value from jsonb_each(coalesce(p_overrides, '{}'::jsonb)) loop
    insert into public.account_entitlement_overrides(
      account_id, key, value, reason, expires_at, created_by, grant_id
    ) values (
      p_account_id, override_entry.key, override_entry.value,
      trim(p_reason), p_expires_at, p_actor, created_grant.id
    );
  end loop;

  if exists (select 1 from public.package_versions where id = p_package_version_id and package_key <> 'free') then
    delete from public.account_inactivity where account_id = p_account_id;
  end if;

  return created_grant;
end
$$;

create or replace function public.revoke_complimentary_package_grant_internal(
  p_account_id uuid,
  p_reason text,
  p_actor uuid
)
returns public.account_package_grants
language plpgsql
security definer
set search_path = ''
as $$
declare
  revoked_grant public.account_package_grants;
begin
  perform 1 from public.accounts where id = p_account_id for update;
  if not found then raise exception 'account_not_found'; end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'reason_required'; end if;

  update public.account_package_grants
  set status = 'revoked', revoked_at = now(), revoked_by = p_actor, revoked_reason = trim(p_reason)
  where account_id = p_account_id and status = 'active'
  returning * into revoked_grant;
  if revoked_grant.id is null then raise exception 'active_complimentary_grant_not_found'; end if;

  update public.account_entitlement_overrides
  set revoked_at = now(), revoked_by = p_actor
  where grant_id = revoked_grant.id and revoked_at is null;

  return revoked_grant;
end
$$;

alter table public.account_package_grants enable row level security;
revoke all on public.account_package_grants from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.account_package_grants to service_role;

revoke all on function public.apply_complimentary_package_grant_internal(uuid, uuid, timestamptz, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.revoke_complimentary_package_grant_internal(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_complimentary_package_grant_internal(uuid, uuid, timestamptz, text, jsonb, uuid) to service_role;
grant execute on function public.revoke_complimentary_package_grant_internal(uuid, text, uuid) to service_role;

comment on table public.account_package_grants is
  'Auditable complimentary package overlay. It never creates, changes or cancels a billing-provider subscription.';
