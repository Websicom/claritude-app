-- One-shot, auditable request for the explicitly authorised Stripe sandbox
-- catalogue fixtures. The raw bearer token is never stored or committed.
create table if not exists public.sandbox_acceptance_fixture_runs (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'requested' check (state in ('requested', 'processing', 'completed', 'failed', 'expired')),
  request jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  expires_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sandbox_acceptance_fixture_runs enable row level security;
revoke all on public.sandbox_acceptance_fixture_runs from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.sandbox_acceptance_fixture_runs to service_role;

comment on table public.sandbox_acceptance_fixture_runs is
  'Short-lived, one-shot operational requests for isolated Stripe sandbox acceptance fixtures. Never used for live catalogue or checkout.';

insert into public.sandbox_acceptance_fixture_runs(token_hash, request, expires_at)
values (
  'e08034eae448691cd9c404700b870a74ce9cba58124cc49a59fedb26b64c6db5',
  jsonb_build_object(
    'label', 'Sandbox fixture — no real payments',
    'authorisedAt', '2026-10-07T00:00:00Z',
    'taxEnabled', false,
    'additionalSeatsEnabled', false,
    'currencies', jsonb_build_array('gbp', 'eur', 'usd'),
    'packages', jsonb_build_object(
      'essentials', jsonb_build_object('monthMinor', 100, 'yearMinor', 1000),
      'scale', jsonb_build_object('monthMinor', 200, 'yearMinor', 2000),
      'pro', jsonb_build_object('monthMinor', 300, 'yearMinor', 3000)
    )
  ),
  now() + interval '2 hours'
)
on conflict (token_hash) do nothing;
