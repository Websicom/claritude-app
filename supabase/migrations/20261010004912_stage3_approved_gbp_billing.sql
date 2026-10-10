begin;

-- Stage 3 commercial policy: paid plans include editing seats and do not sell
-- seat overage. Existing catalogue rows remain available for historic records,
-- while non-GBP and seat rows are retired from all new sales paths.
update public.billing_catalogue_prices
set
  active = false,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'retiredReason', 'V2 Stage 3 GBP-only catalogue; additional seats are not sold',
    'retiredAt', now()
  ),
  updated_at = now()
where active
  and (currency <> 'gbp' or component = 'additional_editing_seat');

update public.package_versions
set
  allowances = jsonb_set(
    coalesce(allowances, '{}'::jsonb),
    '{editingSeats}',
    to_jsonb(case package_key
      when 'free' then 1
      when 'essentials' then 1
      when 'scale' then 2
      when 'pro' then 3
      else coalesce((allowances ->> 'editingSeats')::integer, 1)
    end),
    true
  ),
  features = coalesce(features, '{}'::jsonb)
    - 'billableAdditionalEditingSeats'
    - 'additionalEditingSeatPrice',
  unresolved_values = array_remove(
    array_remove(
      array_remove(coalesce(unresolved_values, '{}'::text[]), 'price'),
      'additionalEditingSeatPrice'
    ),
    'editingSeats'
  )
where package_key in ('free', 'essentials', 'scale', 'pro');

alter table public.billing_daily_finance
  add column if not exists revenue_excluding_tax_minor bigint not null default 0,
  add column if not exists tax_collected_minor bigint not null default 0;

create or replace function private.populate_billing_daily_tax_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select
    coalesce(sum(greatest(0, coalesce(invoice.total_minor, 0) - coalesce(invoice.tax_minor, 0))), 0),
    coalesce(sum(coalesce(invoice.tax_minor, 0)), 0)
  into new.revenue_excluding_tax_minor, new.tax_collected_minor
  from public.billing_invoices invoice
  where invoice.billing_environment = new.billing_environment
    and invoice.currency = new.currency
    and invoice.provider_created_at >= (new.day::timestamp at time zone 'UTC')
    and invoice.provider_created_at < ((new.day + 1)::timestamp at time zone 'UTC');
  return new;
end
$$;

revoke all on function private.populate_billing_daily_tax_totals() from public;
revoke all on function private.populate_billing_daily_tax_totals() from anon;
revoke all on function private.populate_billing_daily_tax_totals() from authenticated;

drop trigger if exists billing_daily_finance_tax_totals on public.billing_daily_finance;
create trigger billing_daily_finance_tax_totals
before insert or update of invoiced_minor on public.billing_daily_finance
for each row execute function private.populate_billing_daily_tax_totals();

-- Backfill existing daily rows through the same deterministic trigger.
update public.billing_daily_finance
set invoiced_minor = invoiced_minor;

comment on column public.billing_daily_finance.revenue_excluding_tax_minor is
  'Invoice totals excluding Stripe-calculated tax for this UTC day and currency.';
comment on column public.billing_daily_finance.tax_collected_minor is
  'Stripe-calculated invoice tax for this UTC day and currency, reported separately from revenue.';

insert into private.app_migrations(version, name, checksum)
values ('20261010004912', 'stage3_approved_gbp_billing', 'stage3-approved-gbp-billing-v1')
on conflict (version) do nothing;

commit;
