alter table public.promotion_rules
  add column internal_name text,
  add column description text,
  add column operation_key uuid,
  add column provider_sync_state text not null default 'draft'
    check (provider_sync_state in ('draft', 'synced', 'failed', 'disabled')),
  add column provider_sync_error text,
  add column provider_times_redeemed integer not null default 0 check (provider_times_redeemed >= 0),
  add column synced_at timestamptz,
  add column updated_at timestamptz not null default now();

create unique index promotion_rules_environment_operation_key_idx
  on public.promotion_rules(billing_environment, operation_key)
  where operation_key is not null;

comment on column public.promotion_rules.operation_key is
  'Stable client operation identifier used with Stripe idempotency keys.';
comment on column public.promotion_rules.provider_sync_state is
  'A rule is checkout-ready only when its immutable Stripe coupon and promotion-code objects were created successfully.';
