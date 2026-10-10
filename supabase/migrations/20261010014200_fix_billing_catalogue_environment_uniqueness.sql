begin;

-- PostgreSQL truncated the original generated unique-constraint name to
-- billing_catalogue_prices_package_version_id_currency_interv_key. The Stage 3
-- environment-isolation migration attempted to drop a longer inferred name, so
-- this legacy global uniqueness rule survived and prevented equivalent test and
-- live catalogue keys from coexisting.
alter table public.billing_catalogue_prices
  drop constraint if exists billing_catalogue_prices_package_version_id_currency_interv_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.billing_catalogue_prices'::regclass
      and conname = 'billing_catalogue_prices_environment_catalogue_key'
      and contype = 'u'
  ) then
    alter table public.billing_catalogue_prices
      add constraint billing_catalogue_prices_environment_catalogue_key
      unique (billing_environment, package_version_id, currency, interval, component);
  end if;
end
$$;

insert into private.app_migrations(version, name, checksum)
values (
  '20261010014200',
  'fix_billing_catalogue_environment_uniqueness',
  'fix-billing-catalogue-environment-uniqueness-v1'
)
on conflict (version) do nothing;

commit;
