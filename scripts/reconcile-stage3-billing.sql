\set ON_ERROR_STOP on
begin;

-- Operational provider reconciliation for the approved V2 Stage 3 catalogue.
-- Stripe Product and Price IDs are public provider references, not credentials.
-- This script is idempotent and intentionally keeps live checkout disabled.

do $$
declare
  package_count integer;
begin
  select count(distinct package_key)
  into package_count
  from public.package_versions
  where package_key in ('essentials', 'scale', 'pro');

  if package_count <> 3 then
    raise exception 'Expected Essentials, Scale and Pro package versions; found %', package_count;
  end if;
end
$$;

-- Retire every previous paid-plan mapping before enabling exactly the approved
-- six GBP base prices per environment. Historical rows remain available.
update public.billing_catalogue_prices price
set
  active = false,
  metadata = coalesce(price.metadata, '{}'::jsonb) || jsonb_build_object(
    'retiredReason', 'Superseded by V2 Stage 3 approved GBP catalogue',
    'retiredAt', now()
  ),
  updated_at = now()
from public.package_versions package
where package.id = price.package_version_id
  and package.package_key in ('essentials', 'scale', 'pro')
  and price.billing_environment in ('test', 'live')
  and price.active;

with latest_packages as (
  select distinct on (package_key)
    id,
    package_key
  from public.package_versions
  where package_key in ('essentials', 'scale', 'pro')
  order by package_key, version desc
),
approved(environment, package_key, provider_product_id, provider_price_id, interval, unit_amount_minor, provider_livemode) as (
  values
    ('test', 'essentials', 'prod_VOO9u3CFeQkGRA', 'price_1UOp9T0N1c5vQhviR52IU799', 'month', 1500::bigint, false),
    ('test', 'essentials', 'prod_VOO9u3CFeQkGRA', 'price_1UOp9X0N1c5vQhvirzsliJpd', 'year', 10800::bigint, false),
    ('test', 'scale', 'prod_VOOA92ndwQtdih', 'price_1UOp9Z0N1c5vQhvieCOBM9Ve', 'month', 4900::bigint, false),
    ('test', 'scale', 'prod_VOOA92ndwQtdih', 'price_1UOp9b0N1c5vQhvilC3fYHmB', 'year', 46800::bigint, false),
    ('test', 'pro', 'prod_VOOAJpBfnK01Y6', 'price_1UOp9d0N1c5vQhviruMj5Ms5', 'month', 12900::bigint, false),
    ('test', 'pro', 'prod_VOOAJpBfnK01Y6', 'price_1UOp9f0N1c5vQhviPdouyQzK', 'year', 118800::bigint, false),
    ('live', 'essentials', 'prod_VPeJHlcoqq0TGi', 'price_1UOp19P3P2wne7LSQKc8QF7u', 'month', 1500::bigint, true),
    ('live', 'essentials', 'prod_VPeJHlcoqq0TGi', 'price_1UOp1CP3P2wne7LSNR0VuBCy', 'year', 10800::bigint, true),
    ('live', 'scale', 'prod_VPeJbSzOYdiieh', 'price_1UOp1IP3P2wne7LSa4s9Upwy', 'month', 4900::bigint, true),
    ('live', 'scale', 'prod_VPeJbSzOYdiieh', 'price_1UOp1LP3P2wne7LSXWmLBJCv', 'year', 46800::bigint, true),
    ('live', 'pro', 'prod_VPeK2OObU9EtoP', 'price_1UOp1SP3P2wne7LS6sHpSF3x', 'month', 12900::bigint, true),
    ('live', 'pro', 'prod_VPeK2OObU9EtoP', 'price_1UOp1WP3P2wne7LSp01m189G', 'year', 118800::bigint, true)
)
insert into public.billing_catalogue_prices (
  billing_environment,
  package_version_id,
  provider_product_id,
  provider_price_id,
  currency,
  interval,
  component,
  unit_amount_minor,
  tax_behavior,
  active,
  provider_livemode,
  metadata,
  verified_at,
  verified_by,
  updated_at
)
select
  approved.environment,
  latest_packages.id,
  approved.provider_product_id,
  approved.provider_price_id,
  'gbp',
  approved.interval,
  'base',
  approved.unit_amount_minor,
  'exclusive',
  true,
  approved.provider_livemode,
  jsonb_build_object(
    'productName', 'Claritude ' || initcap(approved.package_key),
    'productTaxCode', 'txcd_10103001',
    'recurringUsageType', 'licensed',
    'pricingApproval', 'V2 Stage 3'
  ),
  now(),
  null,
  now()
from approved
join latest_packages using (package_key)
on conflict (billing_environment, package_version_id, currency, interval, component)
do update set
  provider_product_id = excluded.provider_product_id,
  provider_price_id = excluded.provider_price_id,
  unit_amount_minor = excluded.unit_amount_minor,
  tax_behavior = excluded.tax_behavior,
  active = excluded.active,
  provider_livemode = excluded.provider_livemode,
  metadata = excluded.metadata,
  verified_at = excluded.verified_at,
  updated_at = excluded.updated_at;

insert into public.billing_environment_configurations(environment)
values ('test'), ('live')
on conflict (environment) do nothing;

update public.billing_environment_configurations
set
  portal_configuration_id = case environment
    when 'test' then 'bpc_1UNbGa0N1c5vQhvimkvR8FyN'
    when 'live' then 'bpc_1UOp1gP3P2wne7LSdcQWgd0G'
  end,
  webhook_configured = true,
  tax_enabled = true,
  tax_reviewed_at = coalesce(tax_reviewed_at, now()),
  checkout_enabled = case when environment = 'live' then false else checkout_enabled end,
  updated_at = now()
where environment in ('test', 'live');

do $$
declare
  environment_name text;
  mapping_count integer;
  invalid_count integer;
begin
  foreach environment_name in array array['test', 'live'] loop
    select
      count(*),
      count(*) filter (
        where price.currency <> 'gbp'
          or price.component <> 'base'
          or price.tax_behavior <> 'exclusive'
          or price.provider_livemode <> (environment_name = 'live')
          or price.metadata ->> 'productTaxCode' <> 'txcd_10103001'
      )
    into mapping_count, invalid_count
    from public.billing_catalogue_prices price
    join public.package_versions package on package.id = price.package_version_id
    where price.billing_environment = environment_name
      and package.package_key in ('essentials', 'scale', 'pro')
      and price.active;

    if mapping_count <> 6 or invalid_count <> 0 then
      raise exception 'Stage 3 % catalogue reconciliation failed: mappings %, invalid %',
        environment_name, mapping_count, invalid_count;
    end if;
  end loop;

  if (select checkout_enabled from public.billing_environment_configurations where environment = 'live') then
    raise exception 'Live checkout must remain disabled';
  end if;
end
$$;

commit;

select
  configuration.environment,
  configuration.checkout_enabled,
  configuration.tax_enabled,
  configuration.webhook_configured,
  configuration.portal_configuration_id,
  count(price.id) filter (where price.active) as active_approved_prices
from public.billing_environment_configurations configuration
left join public.billing_catalogue_prices price
  on price.billing_environment = configuration.environment
left join public.package_versions package
  on package.id = price.package_version_id
  and package.package_key in ('essentials', 'scale', 'pro')
where configuration.environment in ('test', 'live')
group by configuration.environment, configuration.checkout_enabled,
  configuration.tax_enabled, configuration.webhook_configured,
  configuration.portal_configuration_id
order by configuration.environment;
