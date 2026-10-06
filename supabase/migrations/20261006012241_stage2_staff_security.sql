create type public.staff_role as enum ('owner', 'support', 'finance', 'engineering');
create type public.staff_status as enum ('active', 'suspended');
create type public.delegation_mode as enum ('read', 'write');

create table public.staff_members (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role public.staff_role not null,
  status public.staff_status not null default 'active',
  display_name text,
  invited_by uuid references public.staff_members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(trim(email))),
  role public.staff_role not null,
  invited_by uuid references public.staff_members(user_id) on delete set null,
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index staff_invitations_pending_email_idx
  on public.staff_invitations(email)
  where accepted_at is null and revoked_at is null;

create table public.delegation_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references public.staff_members(user_id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  represented_user_id uuid references auth.users(id) on delete set null,
  represented_role text not null check (represented_role in ('owner', 'member', 'viewer', 'billing_manager')),
  mode public.delegation_mode not null default 'read',
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '60 minutes')
);

create index delegation_sessions_staff_active_idx
  on public.delegation_sessions(staff_user_id, expires_at desc)
  where revoked_at is null;

create table public.admin_activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_staff_id uuid references public.staff_members(user_id) on delete set null,
  represented_user_id uuid references auth.users(id) on delete set null,
  delegation_session_id uuid references public.delegation_sessions(id) on delete set null,
  action text not null,
  outcome text not null check (outcome in ('success', 'denied', 'failed', 'previewed')),
  target_type text,
  target_id text,
  account_id uuid references public.accounts(id) on delete set null,
  reason text,
  previous_values jsonb,
  new_values jsonb,
  metadata jsonb not null default '{}'::jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index admin_activity_time_idx on public.admin_activity_log(created_at desc);
create index admin_activity_actor_idx on public.admin_activity_log(actor_staff_id, created_at desc);
create index admin_activity_account_idx on public.admin_activity_log(account_id, created_at desc);

create or replace function private.protect_last_staff_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role <> 'owner' or old.status <> 'active' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' and new.role = 'owner' and new.status = 'active' then
    return new;
  end if;

  if not exists (
    select 1
    from public.staff_members candidate
    where candidate.role = 'owner'
      and candidate.status = 'active'
      and candidate.user_id <> old.user_id
  ) then
    raise exception 'last_platform_owner_is_protected';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger protect_last_staff_owner
before update or delete on public.staff_members
for each row execute function private.protect_last_staff_owner();

revoke all on function private.protect_last_staff_owner() from public, anon, authenticated;

alter table public.staff_members enable row level security;
alter table public.staff_invitations enable row level security;
alter table public.delegation_sessions enable row level security;
alter table public.admin_activity_log enable row level security;

revoke all on public.staff_members, public.staff_invitations,
  public.delegation_sessions, public.admin_activity_log
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on public.staff_members,
  public.staff_invitations, public.delegation_sessions to service_role;
grant select, insert on public.admin_activity_log to service_role;

do $$
declare
  platform_owner_id uuid;
  secondary_owner_id uuid;
begin
  select id into platform_owner_id
  from auth.users
  where lower(email) = 'admin@claritude.io'
    and email_confirmed_at is not null
  order by created_at
  limit 1;

  if platform_owner_id is null then
    raise exception 'verified platform owner admin@claritude.io was not found';
  end if;

  insert into public.staff_members(user_id, role, status, display_name)
  values(platform_owner_id, 'owner', 'active', 'Claritude Admin')
  on conflict (user_id) do update
  set role = 'owner', status = 'active', updated_at = now();

  select id into secondary_owner_id
  from auth.users
  where lower(email) = 'adam.jordan@websi.com'
    and email_confirmed_at is not null
  order by created_at
  limit 1;

  if secondary_owner_id is not null then
    insert into public.staff_members(user_id, role, status, display_name, invited_by)
    values(secondary_owner_id, 'owner', 'active', 'Adam Jordan', platform_owner_id)
    on conflict (user_id) do update
    set role = 'owner', status = 'active', updated_at = now();
  else
    insert into public.staff_invitations(email, role, invited_by, reason)
    values(
      'adam.jordan@websi.com',
      'owner',
      platform_owner_id,
      'Initial Stage 2 platform Owner authorised by the product owner'
    )
    on conflict (email) where accepted_at is null and revoked_at is null do nothing;
  end if;
end
$$;

drop table if exists public.superadmin_access;

comment on table public.staff_members is
  'Identity-bound Claritude staff roles, separate from customer account memberships.';
comment on table public.staff_invitations is
  'Pending staff grants; a confirmed matching Auth identity must explicitly accept and bind the invitation.';
comment on table public.delegation_sessions is
  'Short-lived, scoped staff customer sessions. Read-only by default; write mode requires a reason and permission.';
comment on table public.admin_activity_log is
  'Append-only administrative audit trail. Secrets and unnecessary sensitive payloads must never be stored.';
