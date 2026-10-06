-- Stage 3 follow-up: isolate test/live billing, persist complete recurring
-- subscription state and retain activity/balance finance facts separately.
alter table public.accounts
  add column billing_environment text not null default 'live'
    check (billing_environment in ('test', 'live')),
  add column is_test_account boolean not null default false,
  add column test_notification_recipients text[] not null default '{}';

alter table public.accounts add constraint accounts_test_environment_check
  check ((is_test_account and billing_environment = 'test') or (not is_test_account and billing_environment = 'live'));
create index accounts_billing_environment_idx on public.accounts(billing_environment, created_at desc);

create table public.billing_environment_configurations (
  environment text primary key check (environment in ('test', 'live')),
  checkout_enabled boolean not null default false,
  tax_enabled boolean not null default false,
  tax_reviewed_at timestamptz,
  tax_reviewed_by uuid references public.staff_members(user_id) on delete set null,
  portal_configuration_id text,
  webhook_configured boolean not null default false,
  sandbox_acceptance_completed_at timestamptz,
  sandbox_acceptance_completed_by uuid references public.staff_members(user_id) on delete set null,
  sandbox_acceptance_evidence jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_members(user_id) on delete set null,
  check (not tax_enabled or tax_reviewed_at is not null),
  check (environment = 'test' or checkout_enabled = false or sandbox_acceptance_completed_at is not null)
);

insert into public.billing_environment_configurations(environment, checkout_enabled, tax_enabled, tax_reviewed_at, tax_reviewed_by, portal_configuration_id, updated_at, updated_by)
select case when mode = 'sandbox' then 'test' else 'live' end,
  case when mode = 'sandbox' then checkout_enabled else false end,
  tax_enabled, tax_reviewed_at, tax_reviewed_by, portal_configuration_id, updated_at, updated_by
from public.billing_configuration
on conflict (environment) do nothing;
insert into public.billing_environment_configurations(environment) values ('test'), ('live') on conflict do nothing;

alter table public.billing_catalogue_prices add column billing_environment text;
update public.billing_catalogue_prices set billing_environment = case when provider_livemode then 'live' else 'test' end where billing_environment is null;
alter table public.billing_catalogue_prices alter column billing_environment set not null;
alter table public.billing_catalogue_prices add constraint billing_catalogue_prices_environment_check check (billing_environment in ('test', 'live'));
alter table public.billing_catalogue_prices drop constraint if exists billing_catalogue_prices_provider_price_id_key;
alter table public.billing_catalogue_prices drop constraint if exists billing_catalogue_prices_package_version_id_currency_interval_component_key;
alter table public.billing_catalogue_prices add constraint billing_catalogue_prices_environment_provider_key unique (billing_environment, provider_price_id);
alter table public.billing_catalogue_prices add constraint billing_catalogue_prices_environment_catalogue_key unique (billing_environment, package_version_id, currency, interval, component);

alter table public.billing_checkout_attempts add column billing_environment text;
update public.billing_checkout_attempts attempt set billing_environment = account.billing_environment from public.accounts account where account.id = attempt.account_id and attempt.billing_environment is null;
alter table public.billing_checkout_attempts alter column billing_environment set not null;
alter table public.billing_checkout_attempts add constraint billing_checkout_attempts_environment_check check (billing_environment in ('test', 'live'));
alter table public.billing_checkout_attempts drop constraint if exists billing_checkout_attempts_idempotency_key_key;
alter table public.billing_checkout_attempts drop constraint if exists billing_checkout_attempts_provider_session_id_key;
alter table public.billing_checkout_attempts add constraint billing_checkout_attempts_environment_idempotency_key unique (billing_environment, idempotency_key);
alter table public.billing_checkout_attempts add constraint billing_checkout_attempts_environment_provider_session_key unique (billing_environment, provider_session_id);
with ranked as (
  select id, row_number() over (partition by account_id, billing_environment order by updated_at desc, created_at desc, id desc) as rank
  from public.billing_checkout_attempts
  where state in ('pending', 'created')
)
update public.billing_checkout_attempts attempt set state = 'failed', error = 'superseded_during_environment_isolation_migration', updated_at = now()
from ranked where ranked.id = attempt.id and ranked.rank > 1;
create unique index billing_checkout_attempts_one_active_idx on public.billing_checkout_attempts(account_id, billing_environment) where state in ('pending', 'created');

alter table public.billing_customers add column id uuid default gen_random_uuid();
alter table public.billing_customers add column billing_environment text;
update public.billing_customers customer set billing_environment = account.billing_environment from public.accounts account where account.id = customer.account_id and customer.billing_environment is null;
alter table public.billing_customers alter column id set not null;
alter table public.billing_customers alter column billing_environment set not null;
alter table public.billing_customers drop constraint if exists billing_customers_pkey;
alter table public.billing_customers drop constraint if exists billing_customers_provider_customer_id_key;
alter table public.billing_customers add primary key (id);
alter table public.billing_customers add constraint billing_customers_environment_check check (billing_environment in ('test', 'live'));
alter table public.billing_customers add constraint billing_customers_account_environment_key unique (account_id, billing_environment);
alter table public.billing_customers add constraint billing_customers_provider_environment_key unique (provider_customer_id, billing_environment);

alter table public.billing_events add column billing_environment text;
update public.billing_events set billing_environment = case when livemode then 'live' else 'test' end where billing_environment is null;
alter table public.billing_events alter column billing_environment set not null;
alter table public.billing_events drop constraint if exists billing_events_provider_event_id_key;
alter table public.billing_events add constraint billing_events_environment_check check (billing_environment in ('test', 'live'));
alter table public.billing_events add constraint billing_events_environment_provider_key unique (billing_environment, provider_event_id);

alter table public.billing_subscriptions add column id uuid default gen_random_uuid();
alter table public.billing_subscriptions add column billing_environment text;
alter table public.billing_subscriptions add column mrr_minor bigint not null default 0;
alter table public.billing_subscriptions add column recurring_discount_minor bigint not null default 0;
alter table public.billing_subscriptions add column included_editing_seats integer;
alter table public.billing_subscriptions add column billable_additional_seats integer not null default 0;
update public.billing_subscriptions set billing_environment = case when livemode then 'live' else 'test' end where billing_environment is null;
alter table public.billing_subscriptions alter column id set not null;
alter table public.billing_subscriptions alter column billing_environment set not null;
alter table public.billing_subscriptions drop constraint if exists billing_subscriptions_pkey;
alter table public.billing_subscriptions add primary key (id);
alter table public.billing_subscriptions add constraint billing_subscriptions_environment_check check (billing_environment in ('test', 'live'));
alter table public.billing_subscriptions add constraint billing_subscriptions_environment_provider_key unique (billing_environment, provider_subscription_id);

create table public.billing_subscription_items (
  id uuid primary key default gen_random_uuid(),
  billing_environment text not null check (billing_environment in ('test', 'live')),
  provider_subscription_id text not null,
  provider_subscription_item_id text not null,
  provider_price_id text not null,
  package_version_id uuid references public.package_versions(id) on delete restrict,
  component text not null check (component in ('base', 'additional_editing_seat', 'unmapped')),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  interval text not null check (interval in ('month', 'year')),
  quantity integer not null check (quantity > 0),
  unit_amount_minor bigint not null check (unit_amount_minor >= 0),
  monthly_gross_minor bigint not null default 0,
  monthly_discount_minor bigint not null default 0,
  monthly_net_minor bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (billing_environment, provider_subscription_item_id),
  foreign key (billing_environment, provider_subscription_id) references public.billing_subscriptions(billing_environment, provider_subscription_id) on delete cascade
);
create index billing_subscription_items_subscription_idx on public.billing_subscription_items(billing_environment, provider_subscription_id);

create table public.billing_subscription_discounts (
  id uuid primary key default gen_random_uuid(),
  billing_environment text not null check (billing_environment in ('test', 'live')),
  provider_subscription_id text not null,
  provider_discount_id text not null,
  provider_coupon_id text,
  duration text,
  duration_in_months integer,
  percent_off numeric,
  amount_off_minor bigint,
  currency text,
  starts_at timestamptz,
  ends_at timestamptz,
  recurring_for_mrr boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (billing_environment, provider_discount_id),
  foreign key (billing_environment, provider_subscription_id) references public.billing_subscriptions(billing_environment, provider_subscription_id) on delete cascade
);

do $$
declare table_name text;
declare pk_name text;
begin
  foreach table_name in array array['billing_invoices','billing_payments','billing_refunds','billing_disputes'] loop
    execute format('alter table public.%I add column id uuid default gen_random_uuid()', table_name);
    execute format('alter table public.%I add column billing_environment text', table_name);
    execute format('update public.%I set billing_environment = case when livemode then ''live'' else ''test'' end where billing_environment is null', table_name);
    execute format('alter table public.%I alter column id set not null', table_name);
    execute format('alter table public.%I alter column billing_environment set not null', table_name);
    select conname into pk_name from pg_constraint where conrelid = format('public.%I', table_name)::regclass and contype = 'p';
    if pk_name is not null then execute format('alter table public.%I drop constraint %I', table_name, pk_name); end if;
    execute format('alter table public.%I add primary key (id)', table_name);
    execute format('alter table public.%I add constraint %I check (billing_environment in (''test'', ''live''))', table_name, table_name || '_environment_check');
  end loop;
end $$;
alter table public.billing_invoices add constraint billing_invoices_environment_provider_key unique (billing_environment, provider_invoice_id);
alter table public.billing_payments add constraint billing_payments_environment_provider_key unique (billing_environment, provider_payment_intent_id);
alter table public.billing_refunds add constraint billing_refunds_environment_provider_key unique (billing_environment, provider_refund_id);
alter table public.billing_disputes add constraint billing_disputes_environment_provider_key unique (billing_environment, provider_dispute_id);

alter table public.billing_payments
  add column fee_minor bigint not null default 0,
  add column net_minor bigint not null default 0,
  add column provider_balance_transaction_id text,
  add column available_on date;

alter table public.billing_reconciliation_runs add column billing_environment text;
update public.billing_reconciliation_runs run set billing_environment = coalesce((select account.billing_environment from public.accounts account where account.id = run.account_id), 'live') where billing_environment is null;
alter table public.billing_reconciliation_runs alter column billing_environment set not null;
alter table public.billing_reconciliation_runs add constraint billing_reconciliation_runs_environment_check check (billing_environment in ('test', 'live'));

alter table public.billing_daily_finance add column billing_environment text;
update public.billing_daily_finance set billing_environment = case when livemode then 'live' else 'test' end where billing_environment is null;
alter table public.billing_daily_finance alter column billing_environment set not null;
alter table public.billing_daily_finance drop constraint if exists billing_daily_finance_pkey;
alter table public.billing_daily_finance add primary key(day, currency, billing_environment);
alter table public.billing_daily_finance add constraint billing_daily_finance_environment_check check (billing_environment in ('test', 'live'));
alter table public.billing_daily_finance
  add column collections_day_minor bigint not null default 0,
  add column refunds_succeeded_day_minor bigint not null default 0,
  add column refunds_pending_day_minor bigint not null default 0,
  add column fees_day_minor bigint not null default 0,
  add column net_balance_day_minor bigint not null default 0,
  add column available_balance_minor bigint not null default 0,
  add column pending_balance_minor bigint not null default 0,
  add column new_subscriptions integer not null default 0,
  add column cancellations integer not null default 0,
  add column recovered_payments integer not null default 0,
  add column payouts_day_minor bigint not null default 0,
  add column package_revenue jsonb not null default '{}'::jsonb,
  add column billing_interval_mix jsonb not null default '{}'::jsonb;

create table public.billing_payouts (
  id uuid primary key default gen_random_uuid(),
  billing_environment text not null check (billing_environment in ('test', 'live')),
  provider_payout_id text not null,
  status text not null,
  currency text not null check (currency ~ '^[a-z]{3}$'),
  amount_minor bigint not null,
  arrival_at timestamptz,
  provider_created_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  last_event_created_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (billing_environment, provider_payout_id)
);

create table public.billing_financial_operations (
  id uuid primary key default gen_random_uuid(),
  billing_environment text not null check (billing_environment in ('test', 'live')),
  operation_key uuid not null,
  operation_type text not null check (operation_type in ('checkout', 'refund', 'subscription_change', 'invoice_adjustment')),
  account_id uuid not null references public.accounts(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  provider_reference text,
  state text not null default 'pending' check (state in ('pending', 'completed', 'failed')),
  request jsonb not null default '{}'::jsonb,
  response jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (billing_environment, operation_type, operation_key)
);

create table public.billing_scheduled_changes (
  id uuid primary key default gen_random_uuid(),
  billing_environment text not null check (billing_environment in ('test', 'live')),
  operation_key uuid not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider_subscription_id text not null,
  effective_at timestamptz not null,
  state text not null default 'scheduled' check (state in ('scheduled', 'processing', 'completed', 'failed', 'cancelled')),
  requested_change jsonb not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  provider_response jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (billing_environment, operation_key)
);
create index billing_scheduled_changes_due_idx on public.billing_scheduled_changes(state, effective_at);

alter table public.promotion_rules add column billing_environment text not null default 'live' check (billing_environment in ('test', 'live'));
alter table public.promotion_rules drop constraint if exists promotion_rules_code_key;
alter table public.promotion_rules add constraint promotion_rules_environment_code_key unique (billing_environment, code);

do $$
declare table_name text;
begin
  foreach table_name in array array['billing_environment_configurations','billing_subscription_items','billing_subscription_discounts','billing_payouts','billing_financial_operations','billing_scheduled_changes'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
  end loop;
end $$;

comment on column public.accounts.billing_environment is 'Authoritative billing environment. Test accounts can use only test Stripe resources; ordinary accounts can use only live resources.';
comment on table public.billing_financial_operations is 'Stable server-side financial operation ledger used to prevent duplicate provider mutations under retries and concurrent requests.';
comment on table public.billing_subscription_items is 'Every recurring Stripe subscription item projected separately, including base packages and billable additional seats.';
comment on column public.billing_daily_finance.collections_day_minor is 'Successful collections whose provider creation date is this day; not a cumulative balance or accounting revenue.';

create or replace function public.create_superadmin_test_account(p_name text, p_owner uuid, p_test_recipients text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid;
  workspace_id uuid;
  package_version_id uuid;
begin
  if p_owner is null or not exists(select 1 from auth.users where id = p_owner) then raise exception 'owner user is required'; end if;
  if length(trim(p_name)) < 2 or length(trim(p_name)) > 100 then raise exception 'valid account name is required'; end if;
  if coalesce(array_length(p_test_recipients, 1), 0) = 0 then raise exception 'at least one designated test recipient is required'; end if;
  if exists(select 1 from unnest(p_test_recipients) recipient where recipient !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid test recipient'; end if;
  select id into package_version_id from public.package_versions where package_key = 'free' and state = 'published' order by version desc limit 1;
  if package_version_id is null then raise exception 'published free package is required'; end if;
  insert into public.accounts(name, entitlement, billing_environment, is_test_account, test_notification_recipients)
    values(trim(p_name), 'free', 'test', true, p_test_recipients) returning id into account_id;
  insert into public.account_memberships(account_id, user_id, role) values(account_id, p_owner, 'owner');
  insert into public.workspaces(account_id, name) values(account_id, trim(p_name) || ' workspace') returning id into workspace_id;
  insert into public.workspace_memberships(workspace_id, user_id, role) values(workspace_id, p_owner, 'owner');
  insert into public.account_package_assignments(account_id, package_version_id, billing_state, complimentary)
    values(account_id, package_version_id, 'unconfigured', false);
  return jsonb_build_object('accountId', account_id, 'workspaceId', workspace_id, 'billingEnvironment', 'test');
end $$;
revoke all on function public.create_superadmin_test_account(text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.create_superadmin_test_account(text, uuid, text[]) to service_role;
