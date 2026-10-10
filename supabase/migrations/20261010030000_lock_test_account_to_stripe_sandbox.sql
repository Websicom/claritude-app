-- Bind the explicitly authorised Claritude test account to Stripe sandbox only.
-- This migration is fail-closed: it will not move an account that already has
-- live billing history or an identity that can manage another live account.
do $$
declare
  v_user_id uuid;
  v_account_id uuid;
  v_account_name text;
  v_owner_account_count integer;
  v_test_catalogue_count integer;
begin
  select id
  into v_user_id
  from auth.users
  where lower(trim(email)) = 'test@claritude.io';

  if v_user_id is null then
    raise exception 'test@claritude.io auth user not found';
  end if;

  select count(*), (array_agg(account.id))[1], (array_agg(account.name))[1]
  into v_owner_account_count, v_account_id, v_account_name
  from public.accounts account
  join public.account_memberships membership
    on membership.account_id = account.id
  where membership.user_id = v_user_id
    and membership.role = 'owner';

  if v_owner_account_count <> 1 or v_account_id is null then
    raise exception 'Expected exactly one account owned by test@claritude.io; found %', v_owner_account_count;
  end if;

  if exists (
    select 1
    from public.accounts account
    join public.account_memberships membership
      on membership.account_id = account.id
    where membership.user_id = v_user_id
      and membership.role = 'owner'
      and account.id <> v_account_id
      and account.billing_environment = 'live'
    union all
    select 1
    from public.accounts account
    join public.account_billing_memberships billing_membership
      on billing_membership.account_id = account.id
    where billing_membership.user_id = v_user_id
      and billing_membership.can_manage = true
      and account.id <> v_account_id
      and account.billing_environment = 'live'
  ) then
    raise exception 'test@claritude.io has management access to another live billing account';
  end if;

  if exists (
    select 1 from public.billing_customers
    where account_id = v_account_id and billing_environment = 'live'
    union all
    select 1 from public.billing_subscriptions
    where account_id = v_account_id and billing_environment = 'live'
    union all
    select 1 from public.billing_checkout_attempts
    where account_id = v_account_id and billing_environment = 'live'
    union all
    select 1 from public.billing_financial_operations
    where account_id = v_account_id and billing_environment = 'live'
  ) then
    raise exception 'Refusing to move test@claritude.io account because live billing records already exist';
  end if;

  if not exists (
    select 1
    from public.billing_environment_configurations
    where environment = 'test'
      and checkout_enabled = true
      and tax_enabled = true
      and tax_reviewed_at is not null
      and webhook_configured = true
      and portal_configuration_id is not null
  ) then
    raise exception 'Stripe sandbox configuration is not ready';
  end if;

  select count(*)
  into v_test_catalogue_count
  from public.billing_catalogue_prices price
  join public.package_versions package_version
    on package_version.id = price.package_version_id
  where price.billing_environment = 'test'
    and price.active = true
    and price.provider_livemode = false
    and price.currency = 'gbp'
    and price.component = 'base'
    and price.tax_behavior = 'exclusive'
    and coalesce(price.metadata ->> 'productTaxCode', '') <> ''
    and package_version.package_key in ('essentials', 'scale', 'pro')
    and price.interval in ('month', 'year');

  if v_test_catalogue_count <> 6 then
    raise exception 'Expected six approved sandbox prices; found %', v_test_catalogue_count;
  end if;

  update public.accounts
  set billing_environment = 'test',
      is_test_account = true,
      test_notification_recipients = array['test@claritude.io']::text[]
  where id = v_account_id;

  update public.billing_environment_configurations
  set sandbox_acceptance_evidence =
        coalesce(sandbox_acceptance_evidence, '{}'::jsonb)
        || jsonb_build_object(
          'dedicatedTestAccount',
          jsonb_build_object(
            'accountId', v_account_id,
            'accountName', v_account_name,
            'userEmail', 'test@claritude.io',
            'billingEnvironment', 'test',
            'sandboxOnly', true,
            'verifiedAt', clock_timestamp()
          )
        ),
      updated_at = clock_timestamp()
  where environment = 'test';

  raise notice 'CLARITUDE_TEST_ACCOUNT account_id=% account_name=% email=test@claritude.io environment=test sandbox_only=true',
    v_account_id, v_account_name;
end
$$;
