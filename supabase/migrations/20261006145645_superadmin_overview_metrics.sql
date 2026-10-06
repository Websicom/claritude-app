-- Environment-isolated daily snapshots for the SuperAdmin command centre.
-- Historical series are never backfilled with invented values: the API derives
-- event activity from source records and stores current-state snapshots from the
-- day this migration is deployed onward.
create table public.superadmin_overview_daily_snapshots (
  billing_environment text not null check (billing_environment in ('test', 'live')),
  day date not null,
  accounts jsonb not null default '{}'::jsonb,
  properties jsonb not null default '{}'::jsonb,
  workload jsonb not null default '{}'::jsonb,
  infrastructure jsonb not null default '{}'::jsonb,
  measured_at timestamptz not null default now(),
  source text not null default 'application_measured'
    check (source in ('application_measured', 'postgres_reported')),
  primary key (billing_environment, day)
);

create index superadmin_overview_snapshots_day_idx
  on public.superadmin_overview_daily_snapshots(day desc, billing_environment);

alter table public.superadmin_overview_daily_snapshots enable row level security;
revoke all on public.superadmin_overview_daily_snapshots from public, anon, authenticated;
grant all on public.superadmin_overview_daily_snapshots to service_role;

comment on table public.superadmin_overview_daily_snapshots is
  'Measured daily SuperAdmin overview snapshots, isolated by billing environment. No synthetic historical backfill.';
