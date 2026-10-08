alter table public.account_package_grants
  drop constraint if exists account_package_grants_arrangement_check;

alter table public.account_package_grants
  add constraint account_package_grants_arrangement_check
  check (arrangement in ('complimentary', 'billing_unchanged'));

comment on column public.account_package_grants.arrangement is
  'complimentary grants free access; billing_unchanged grants temporary package access while the existing Stripe subscription and price continue unchanged.';

create or replace function public.apply_package_access_grant_internal(
  p_account_id uuid,
  p_package_version_id uuid,
  p_arrangement text,
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
  if p_arrangement not in ('complimentary', 'billing_unchanged') then raise exception 'valid_billing_treatment_required'; end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'reason_required'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'grant_expiry_must_be_future'; end if;
  if not exists (select 1 from public.package_versions where id = p_package_version_id and state = 'published' and effective_at <= now()) then raise exception 'published_package_version_required'; end if;
  if coalesce(jsonb_typeof(p_overrides), 'object') <> 'object' then raise exception 'overrides_must_be_object'; end if;

  update public.account_package_grants
  set status = case when expires_at is not null and expires_at <= now() then 'expired' else 'revoked' end,
      revoked_at = now(), revoked_by = p_actor,
      revoked_reason = case when expires_at is not null and expires_at <= now() then 'Expired before replacement' else 'Replaced by a newer package access grant' end
  where account_id = p_account_id and status = 'active';

  update public.account_entitlement_overrides
  set revoked_at = now(), revoked_by = p_actor
  where account_id = p_account_id and grant_id is not null and revoked_at is null;

  insert into public.account_package_grants(account_id, package_version_id, arrangement, expires_at, reason, created_by)
  values (p_account_id, p_package_version_id, p_arrangement, p_expires_at, trim(p_reason), p_actor)
  returning * into created_grant;

  for override_entry in select key, value from jsonb_each(coalesce(p_overrides, '{}'::jsonb)) loop
    insert into public.account_entitlement_overrides(account_id, key, value, reason, expires_at, created_by, grant_id)
    values (p_account_id, override_entry.key, override_entry.value, trim(p_reason), p_expires_at, p_actor, created_grant.id);
  end loop;

  if exists (select 1 from public.package_versions where id = p_package_version_id and package_key <> 'free') then
    delete from public.account_inactivity where account_id = p_account_id;
  end if;
  return created_grant;
end
$$;

revoke all on function public.apply_package_access_grant_internal(uuid, uuid, text, timestamptz, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.apply_package_access_grant_internal(uuid, uuid, text, timestamptz, text, jsonb, uuid) to service_role;
