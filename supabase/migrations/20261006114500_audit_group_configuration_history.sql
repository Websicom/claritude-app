-- Adds versioned SuperAdmin history for customer-facing audit group configuration.
-- Executable checks remain repository-owned; this stores configuration snapshots only.

create table public.audit_group_history (
  id uuid primary key default gen_random_uuid(),
  group_id text not null references public.audit_user_facing_groups(id) on delete cascade,
  snapshot jsonb not null,
  reason text not null,
  changed_by uuid references public.staff_members(user_id) on delete set null,
  changed_at timestamptz not null default now()
);

create index audit_group_history_group_changed_idx
  on public.audit_group_history(group_id, changed_at desc);

alter table public.audit_group_history enable row level security;
revoke all on public.audit_group_history from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.audit_group_history to service_role;

comment on table public.audit_group_history is 'Immutable snapshots used for reviewed audit presentation-group configuration rollback.';
