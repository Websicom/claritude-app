do $$
declare
  target_account_id uuid;
  target_package_id uuid;
  actor_id uuid;
  matched_accounts integer;
  created_grant public.account_package_grants;
begin
  select count(*), (array_agg(account.id))[1]
  into matched_accounts, target_account_id
  from public.accounts account
  where lower(trim(account.name)) = 'websi'
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
      left join public.profiles profile on profile.id = membership.user_id
      where membership.account_id = account.id
        and (
          lower(identity.email) in ('adam.jordan@websi.com', 'sales@websi.com')
          or lower(coalesce(profile.full_name, '')) = 'adam jordan'
        )
    );

  if matched_accounts <> 1 or target_account_id is null then
    raise exception 'Expected exactly one guarded Websi account match; found %', matched_accounts;
  end if;

  select id into target_package_id
  from public.package_versions
  where package_key = 'pro_early_access' and state = 'published' and effective_at <= now()
  order by version desc
  limit 1;
  if target_package_id is null then raise exception 'Published Pro package not found'; end if;

  select staff.user_id into actor_id
  from public.staff_members staff
  join auth.users identity on identity.id = staff.user_id
  where lower(identity.email) = 'admin@claritude.io' and staff.role = 'owner' and staff.status = 'active'
  limit 1;
  if actor_id is null then raise exception 'Active Claritude owner not found'; end if;

  select * into created_grant
  from public.apply_complimentary_package_grant_internal(
    target_account_id,
    target_package_id,
    null,
    'Permanent complimentary Pro access authorised for the Websi partner account.',
    '{"propertiesPerAccount":25}'::jsonb,
    actor_id
  );

  insert into public.admin_activity_log(
    actor_staff_id, action, outcome, target_type, target_id, account_id, reason, new_values, metadata
  ) values (
    actor_id,
    'account.complimentary_package_granted',
    'success',
    'account',
    target_account_id::text,
    target_account_id,
    'Permanent complimentary Pro access authorised for the Websi partner account.',
    jsonb_build_object('grantId', created_grant.id, 'packageVersionId', target_package_id, 'permanent', true, 'overrides', jsonb_build_object('propertiesPerAccount', 25)),
    jsonb_build_object('source', 'guarded production migration', 'stripeUnaffected', true, 'customerDataPreserved', true)
  );
end
$$;
