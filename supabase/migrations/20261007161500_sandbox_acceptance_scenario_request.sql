create table if not exists public.sandbox_acceptance_scenario_runs (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'requested' check (state in ('requested', 'processing', 'completed', 'failed', 'expired')),
  result jsonb not null default '{}'::jsonb,
  error text,
  expires_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sandbox_acceptance_scenario_runs enable row level security;
revoke all on public.sandbox_acceptance_scenario_runs from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.sandbox_acceptance_scenario_runs to service_role;

comment on table public.sandbox_acceptance_scenario_runs is
  'Short-lived one-shot requests for real Stripe sandbox acceptance scenarios. Never creates or mutates live Stripe resources.';

insert into public.sandbox_acceptance_scenario_runs(token_hash, expires_at)
values ('21c5c9eb28575f671e8be6c7cd936fd4619be227becd3300c305be50bcd40fc4', now() + interval '4 hours')
on conflict (token_hash) do nothing;
