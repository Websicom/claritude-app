-- Stage 2 platform administration access. The Worker is the only consumer of
-- this table; tenant users cannot discover or modify the allowlist through the
-- Data API. A null user_id reserves access for a confirmed future account and
-- is bound to that account on its first authenticated SuperAdmin request.
create table public.superadmin_access (
  email text primary key check (email = lower(trim(email))),
  user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  bound_at timestamptz
);

alter table public.superadmin_access enable row level security;
revoke all on public.superadmin_access from public, anon, authenticated;
grant select, update on public.superadmin_access to service_role;

insert into public.superadmin_access (email, user_id, bound_at)
values
  (
    'admin@claritude.io',
    (select id from auth.users where lower(email) = 'admin@claritude.io' limit 1),
    case when exists(select 1 from auth.users where lower(email) = 'admin@claritude.io') then now() end
  ),
  (
    'adam.jordan@websi.com',
    (select id from auth.users where lower(email) = 'adam.jordan@websi.com' limit 1),
    case when exists(select 1 from auth.users where lower(email) = 'adam.jordan@websi.com') then now() end
  )
on conflict (email) do update
set user_id = coalesce(excluded.user_id, public.superadmin_access.user_id),
    bound_at = coalesce(public.superadmin_access.bound_at, excluded.bound_at);

comment on table public.superadmin_access is
  'Server-only allowlist for Claritude SuperAdmin access. Pending email grants bind to the first confirmed matching auth user.';
