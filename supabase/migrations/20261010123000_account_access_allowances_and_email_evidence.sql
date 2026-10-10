begin;

update public.package_versions
set
  allowances = coalesce(allowances, '{}'::jsonb) || jsonb_build_object(
    'propertyViewersPerProperty', case
      when package_key in ('pro', 'pro_early_access') then 5
      when package_key = 'scale' then 3
      when package_key = 'essentials' then 2
      else 1
    end,
    'analyticsEventsPerMonth', case
      when package_key in ('pro', 'pro_early_access') then 25000000
      when package_key = 'scale' then 5000000
      when package_key = 'essentials' then 500000
      else 20000
    end
  ),
  unresolved_values = array_remove(
    array_remove(coalesce(unresolved_values, '{}'::text[]), 'propertyViewers'),
    'analyticsEvents'
  )
where package_key in ('free', 'essentials', 'scale', 'pro', 'pro_early_access')
  and state = 'published';

create table if not exists public.email_provider_events (
  id text primary key,
  provider text not null check (provider in ('resend')),
  event_type text not null,
  provider_email_id text,
  recipient text,
  provider_created_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists email_provider_events_email_idx
  on public.email_provider_events(provider_email_id, created_at desc);

create index if not exists email_provider_events_recipient_idx
  on public.email_provider_events(recipient, created_at desc);

alter table public.email_provider_events enable row level security;

comment on table public.email_provider_events is
  'Idempotent, signature-verified provider webhook evidence retained for SuperAdmin delivery reconciliation.';

comment on column public.email_provider_events.id is
  'Provider webhook event identifier (Svix id for Resend), used as the idempotency key.';

commit;
