-- Stage 3 billing control plane. Stripe is the commercial source of truth;
-- these tables are queryable projections and configuration mappings only.
create table public.billing_configuration (
  id boolean primary key default true check (id),
  mode text not null default 'sandbox' check (mode in ('sandbox', 'live')),
  checkout_enabled boolean not null default false,
  tax_enabled boolean not null default false,
  tax_reviewed_at timestamptz,
  tax_reviewed_by uuid references public.staff_members(user_id) on delete set null,
  portal_configuration_id text,
  statement_descriptor text,
  default_trial_days integer check (default_trial_days between 0 and 365),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_members(user_id) on delete set null,
  check (not tax_enabled or tax_reviewed_at is not null)
);

insert into public.billing_configuration(id) values (true) on conflict (id) do nothing;

insert into public.package_versions(package_key, version, display_name, state, allowances, features, retention, hard_ceilings, unresolved_values)
values ('pro', 1, 'Pro', 'draft', '{"customEventsPerProperty":null}'::jsonb, '{}'::jsonb, '{}'::jsonb,
  '{"propertiesPerAccount":25}'::jsonb,
  array['price','auditCreditsPerWeek','editingSeats','propertyViewers','uptimeIntervalMinutes','retention'])
on conflict (package_key, version) do nothing;

create table public.billing_catalogue_prices (
  id uuid primary key default gen_random_uuid(),
  package_version_id uuid not null references public.package_versions(id) on delete restrict,
  provider_product_id text not null,
  provider_price_id text not null unique,
  currency text not null check (currency ~ '^[a-z]{3}$'),
  interval text not null check (interval in ('month', 'year')),
  component text not null default 'base' check (component in ('base', 'additional_editing_seat')),
  unit_amount_minor bigint not null check (unit_amount_minor >= 0),
  tax_behavior text not null default 'unspecified' check (tax_behavior in ('inclusive', 'exclusive', 'unspecified')),
  active boolean not null default false,
  provider_livemode boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  verified_by uuid references public.staff_members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(package_version_id, currency, interval, component),
  check (not active or verified_at is not null)
);

create index billing_catalogue_prices_package_idx on public.billing_catalogue_prices(package_version_id, active);

create table public.billing_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  package_version_id uuid not null references public.package_versions(id) on delete restrict,
  currency text not null,
  interval text not null,
  editing_seats integer not null default 1 check (editing_seats > 0),
  idempotency_key text not null unique,
  provider_session_id text unique,
  state text not null default 'pending' check (state in ('pending', 'created', 'completed', 'expired', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.billing_subscriptions (
  provider_subscription_id text primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider_customer_id text not null,
  package_version_id uuid references public.package_versions(id) on delete restrict,
  status text not null,
  currency text,
  interval text,
  quantity integer not null default 1,
  unit_amount_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancelled_at timestamptz,
  ended_at timestamptz,
  provider_created_at timestamptz,
  livemode boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  last_event_created_at timestamptz,
  updated_at timestamptz not null default now()
);
create index billing_subscriptions_account_idx on public.billing_subscriptions(account_id, status);

create table public.billing_invoices (
  provider_invoice_id text primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider_subscription_id text,
  number text,
  status text,
  currency text not null,
  subtotal_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  amount_paid_minor bigint not null default 0,
  amount_remaining_minor bigint not null default 0,
  hosted_invoice_url text,
  invoice_pdf text,
  period_start timestamptz,
  period_end timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  provider_created_at timestamptz,
  livemode boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index billing_invoices_account_idx on public.billing_invoices(account_id, provider_created_at desc);

create table public.billing_payments (
  provider_payment_intent_id text primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider_invoice_id text,
  status text not null,
  currency text not null,
  amount_minor bigint not null default 0,
  amount_received_minor bigint not null default 0,
  payment_method_summary jsonb not null default '{}'::jsonb,
  failure_code text,
  failure_message text,
  provider_created_at timestamptz,
  livemode boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index billing_payments_account_idx on public.billing_payments(account_id, provider_created_at desc);

create table public.billing_refunds (
  provider_refund_id text primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider_payment_intent_id text,
  status text,
  currency text not null,
  amount_minor bigint not null default 0,
  reason text,
  provider_created_at timestamptz,
  livemode boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.billing_disputes (
  provider_dispute_id text primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider_payment_intent_id text,
  status text not null,
  currency text not null,
  amount_minor bigint not null default 0,
  reason text,
  evidence_due_at timestamptz,
  provider_created_at timestamptz,
  livemode boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.billing_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  mode text not null check (mode in ('scheduled', 'manual', 'webhook_repair')),
  state text not null default 'running' check (state in ('running', 'completed', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  counts jsonb not null default '{}'::jsonb,
  differences jsonb not null default '[]'::jsonb,
  error text,
  requested_by uuid references public.staff_members(user_id) on delete set null
);

create table public.billing_daily_finance (
  day date not null,
  currency text not null,
  livemode boolean not null default false,
  mrr_minor bigint not null default 0,
  arr_minor bigint not null default 0,
  invoiced_minor bigint not null default 0,
  cash_collected_minor bigint not null default 0,
  refunds_minor bigint not null default 0,
  credits_minor bigint not null default 0,
  failed_payments integer not null default 0,
  active_subscriptions integer not null default 0,
  trialing_subscriptions integer not null default 0,
  past_due_subscriptions integer not null default 0,
  churned_subscriptions integer not null default 0,
  complimentary_accounts integer not null default 0,
  calculated_at timestamptz not null default now(),
  primary key(day, currency, livemode)
);

alter table public.billing_events add column if not exists account_id uuid references public.accounts(id) on delete set null;
alter table public.billing_events add column if not exists livemode boolean;
alter table public.billing_events add column if not exists next_attempt_at timestamptz;
alter table public.billing_events add column if not exists last_attempt_at timestamptz;
create index if not exists billing_events_retry_idx on public.billing_events(processing_state, next_attempt_at, received_at);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'billing_configuration','billing_catalogue_prices','billing_checkout_attempts','billing_subscriptions',
    'billing_invoices','billing_payments','billing_refunds','billing_disputes','billing_reconciliation_runs','billing_daily_finance'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
  end loop;
end $$;

comment on table public.billing_catalogue_prices is 'Verified Stripe price mapping. Rows remain inactive until amounts, currency, interval and environment are confirmed.';
comment on table public.billing_subscriptions is 'Server-owned Stripe subscription projection; never grants entitlements without a verified package price mapping.';
comment on table public.billing_daily_finance is 'Currency-separated historical finance aggregates. No implicit FX conversion is permitted.';
