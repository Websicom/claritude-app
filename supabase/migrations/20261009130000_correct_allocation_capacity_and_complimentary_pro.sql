begin;

update public.package_versions
set
  allowances = coalesce(allowances, '{}'::jsonb) || jsonb_build_object(
    'alertContactsPerProperty', case
      when package_key in ('pro', 'pro_early_access') then 10
      when package_key = 'scale' then 5
      when package_key = 'essentials' then 2
      else 1
    end
  ),
  unresolved_values = array_remove(
    array_remove(coalesce(unresolved_values, '{}'::text[]), 'alertContacts'),
    'alertContactsPerProperty'
  )
where package_key in ('free', 'essentials', 'scale', 'pro', 'pro_early_access')
  and state = 'published';

do $$
declare
  websi_account_id uuid;
  claritude_account_id uuid;
  target_package_id uuid;
  actor_id uuid;
  matched_accounts integer;
  created_grant public.account_package_grants;
begin
  select id into target_package_id
  from public.package_versions
  where package_key = 'pro' and state = 'published' and effective_at <= now()
  order by version desc
  limit 1;
  if target_package_id is null then raise exception 'Published standard Pro package not found'; end if;

  select staff.user_id into actor_id
  from public.staff_members staff
  join auth.users identity on identity.id = staff.user_id
  where lower(identity.email) = 'admin@claritude.io'
    and staff.role = 'owner'
    and staff.status = 'active'
  limit 1;
  if actor_id is null then raise exception 'Active Claritude owner not found'; end if;

  select count(*), (array_agg(account.id))[1]
  into matched_accounts, websi_account_id
  from public.accounts account
  where account.billing_environment = 'live'
    and lower(trim(account.name)) = 'websi'
    and exists (
      select 1 from public.workspaces workspace
      where workspace.account_id = account.id and lower(trim(workspace.name)) = 'websi agency'
    )
    and exists (
      select 1 from public.properties property
      where property.account_id = account.id and lower(property.canonical_host) in ('websi.com', 'www.websi.com')
    )
    and exists (
      select 1
      from public.account_memberships membership
      join auth.users identity on identity.id = membership.user_id
      where membership.account_id = account.id
        and lower(identity.email) in ('adam.jordan@websi.com', 'sales@websi.com')
    );
  if matched_accounts <> 1 or websi_account_id is null then
    raise exception 'Expected exactly one guarded live Websi account match; found %', matched_accounts;
  end if;

  select count(*), (array_agg(account.id))[1]
  into matched_accounts, claritude_account_id
  from public.accounts account
  where account.billing_environment = 'live'
    and exists (
      select 1 from public.properties property
      where property.account_id = account.id and lower(property.canonical_host) in ('claritude.io', 'www.claritude.io')
    )
    and exists (
      select 1
      from public.account_memberships membership
      join auth.users identity on identity.id = membership.user_id
      where membership.account_id = account.id
        and lower(identity.email) = 'admin@claritude.io'
    );
  if matched_accounts <> 1 or claritude_account_id is null then
    raise exception 'Expected exactly one guarded live Claritude account match; found %', matched_accounts;
  end if;
  if claritude_account_id = websi_account_id then
    raise exception 'Guarded Websi and Claritude matches must be different accounts';
  end if;

  select * into created_grant
  from public.apply_package_access_grant_internal(
    websi_account_id,
    target_package_id,
    'complimentary',
    null,
    'Permanent complimentary standard Pro access authorised for Websi; legacy 25-property override removed.',
    '{}'::jsonb,
    actor_id
  );

  insert into public.admin_activity_log(
    actor_staff_id, action, outcome, target_type, target_id, account_id, reason, new_values, metadata
  ) values (
    actor_id,
    'account.complimentary_package_granted',
    'success',
    'account',
    websi_account_id::text,
    websi_account_id,
    'Permanent complimentary standard Pro access authorised for Websi; legacy 25-property override removed.',
    jsonb_build_object('grantId', created_grant.id, 'packageVersionId', target_package_id, 'packageKey', 'pro', 'permanent', true, 'overrides', '{}'::jsonb),
    jsonb_build_object('source', 'guarded production migration', 'stripeUnaffected', true, 'customerDataPreserved', true)
  );

  select * into created_grant
  from public.apply_package_access_grant_internal(
    claritude_account_id,
    target_package_id,
    'complimentary',
    null,
    'Permanent complimentary standard Pro access authorised for Claritude.',
    '{}'::jsonb,
    actor_id
  );

  insert into public.admin_activity_log(
    actor_staff_id, action, outcome, target_type, target_id, account_id, reason, new_values, metadata
  ) values (
    actor_id,
    'account.complimentary_package_granted',
    'success',
    'account',
    claritude_account_id::text,
    claritude_account_id,
    'Permanent complimentary standard Pro access authorised for Claritude.',
    jsonb_build_object('grantId', created_grant.id, 'packageVersionId', target_package_id, 'packageKey', 'pro', 'permanent', true, 'overrides', '{}'::jsonb),
    jsonb_build_object('source', 'guarded production migration', 'stripeUnaffected', true, 'customerDataPreserved', true)
  );
end
$$;

commit;
