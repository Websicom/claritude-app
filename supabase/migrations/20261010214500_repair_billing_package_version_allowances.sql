begin;

-- Repair the allowance configuration used by the active Stripe catalogue.
-- A previous reconciliation selected the highest version regardless of state,
-- so a draft could receive a verified price while published-only allowance
-- corrections did not update that draft.
with catalogue_or_current_versions as (
  select package_version_id as id
  from public.billing_catalogue_prices
  where active
    and billing_environment in ('test', 'live')
  union
  select latest.id
  from (
    select distinct on (package_key) id, package_key
    from public.package_versions
    where package_key in ('free', 'essentials', 'scale', 'pro')
      and state = 'published'
      and effective_at is not null
      and effective_at <= now()
    order by package_key, version desc
  ) latest
)
update public.package_versions package
set
  allowances = coalesce(package.allowances, '{}'::jsonb) || jsonb_build_object(
    'workspacesPerAccount', case
      when package.package_key = 'free' then 1
      when package.package_key = 'essentials' then 3
      else null
    end,
    'editingSeats', case
      when package.package_key = 'pro' then 3
      when package.package_key = 'scale' then 2
      else 1
    end,
    'auditPagesPerProperty', case
      when package.package_key = 'pro' then 25
      when package.package_key = 'scale' then 15
      when package.package_key = 'essentials' then 5
      else 2
    end,
    'auditCreditsPerWeek', case
      when package.package_key = 'pro' then 250
      when package.package_key = 'scale' then 100
      when package.package_key = 'essentials' then 25
      else 10
    end,
    'customEventsPerProperty', case
      when package.package_key = 'pro' then 25
      when package.package_key = 'scale' then 10
      when package.package_key = 'essentials' then 5
      else 2
    end,
    'uptimeIntervalMinutes', case
      when package.package_key = 'pro' then 1
      when package.package_key = 'scale' then 2
      when package.package_key = 'essentials' then 5
      else 15
    end,
    'alertContactsPerProperty', case
      when package.package_key = 'pro' then 10
      when package.package_key = 'scale' then 5
      when package.package_key = 'essentials' then 2
      else 1
    end,
    'propertyViewersPerProperty', case
      when package.package_key = 'pro' then 5
      when package.package_key = 'scale' then 3
      when package.package_key = 'essentials' then 2
      else 1
    end,
    'analyticsEventsPerMonth', case
      when package.package_key = 'pro' then 25000000
      when package.package_key = 'scale' then 5000000
      when package.package_key = 'essentials' then 500000
      else 20000
    end
  ),
  hard_ceilings = coalesce(package.hard_ceilings, '{}'::jsonb) || jsonb_build_object(
    'propertiesPerAccount', case
      when package.package_key = 'pro' then 200
      when package.package_key = 'scale' then 50
      when package.package_key = 'essentials' then 5
      else 2
    end
  ),
  unresolved_values = array_remove(
    array_remove(
      array_remove(
        array_remove(
          array_remove(coalesce(package.unresolved_values, '{}'::text[]), 'customEventsPerProperty'),
          'propertyViewers'
        ),
        'analyticsEvents'
      ),
      'alertContacts'
    ),
    'workspacesPerAccount'
  )
where package.id in (select id from catalogue_or_current_versions)
  and package.package_key in ('free', 'essentials', 'scale', 'pro');

do $$
declare
  invalid_count integer;
begin
  select count(*)
  into invalid_count
  from public.billing_catalogue_prices price
  join public.package_versions package on package.id = price.package_version_id
  where price.active
    and price.billing_environment in ('test', 'live')
    and package.package_key in ('essentials', 'scale', 'pro')
    and (
      (package.package_key = 'essentials' and (package.allowances ->> 'customEventsPerProperty')::integer <> 5)
      or (package.package_key = 'scale' and (package.allowances ->> 'customEventsPerProperty')::integer <> 10)
      or (package.package_key = 'pro' and (package.allowances ->> 'customEventsPerProperty')::integer <> 25)
    );

  if invalid_count <> 0 then
    raise exception 'Active paid catalogue contains % package versions with invalid custom-event allowances', invalid_count;
  end if;
end
$$;

insert into private.app_migrations(version, name, checksum)
values (
  '20261010214500',
  'repair_billing_package_version_allowances',
  'repair-billing-package-version-allowances-v1'
)
on conflict (version) do nothing;

commit;
