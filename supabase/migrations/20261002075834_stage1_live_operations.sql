-- Stage 1 live-operation repairs. This migration is additive and preserves all
-- existing account, property, monitoring, analytics and audit records.

begin;

alter table public.profiles
  add column if not exists notification_preferences jsonb not null default
    '{"monitor_incidents":true,"recoveries":true,"tracking_problems":true,"audit_issues":true,"billing_subscription":true,"account_security":true}'::jsonb,
  add column if not exists alerts_snoozed_until timestamptz;

alter table public.properties
  add column if not exists settings jsonb not null default
    '{"timezone":"Europe/London","reporting_currency":"GBP","analytics_cookies":"disabled","visitor_profiles":"anonymous","sensitive_query_parameters":["token","email","session"],"ip_address_handling":"discard_after_geolocation","report_branding":{"agency_name":"","accent_colour":"#111111","footer_note":""}}'::jsonb;

alter table public.uptime_checks
  add column if not exists suppressed_by_maintenance boolean not null default false;

alter table public.audit_runs
  add column if not exists created_by uuid references auth.users on delete set null;

alter table public.report_schedules
  add column if not exists last_run_at timestamptz,
  add column if not exists last_error text,
  add column if not exists last_delivery_count integer not null default 0;

alter table public.notifications
  add column if not exists property_id uuid references public.properties on delete cascade,
  add column if not exists category text not null default 'account',
  add column if not exists dedupe_key text;

create unique index if not exists notifications_dedupe_idx
  on public.notifications(dedupe_key);

create table if not exists public.property_audit_pages (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  path text not null check (path like '/%'),
  created_by uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  unique(property_id, path)
);

create table if not exists public.property_memberships (
  property_id uuid not null references public.properties on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role public.member_role not null default 'viewer',
  invited_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  primary key(property_id, user_id)
);

create index if not exists property_memberships_user_idx
  on public.property_memberships(user_id, property_id);
create index if not exists property_audit_pages_property_idx
  on public.property_audit_pages(property_id, created_at);

alter table public.property_audit_pages enable row level security;
alter table public.property_memberships enable row level security;

revoke all on public.property_audit_pages, public.property_memberships from anon, authenticated;
grant select, insert, update, delete on public.property_audit_pages, public.property_memberships to authenticated;

create or replace function private.can_access_property(p_property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.properties p
    join public.workspace_memberships m on m.workspace_id = p.workspace_id
    where p.id = p_property and m.user_id = (select auth.uid())
  ) or exists(
    select 1
    from public.property_memberships m
    where m.property_id = p_property and m.user_id = (select auth.uid())
  )
$$;

create or replace function private.can_manage_property(p_property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.properties p
    join public.workspace_memberships m on m.workspace_id = p.workspace_id
    where p.id = p_property
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'member')
  )
$$;

revoke all on function private.can_manage_property(uuid) from public, anon, authenticated;
grant execute on function private.can_manage_property(uuid) to authenticated;

drop policy if exists property_member_select on public.properties;
create policy property_member_select on public.properties
  for select to authenticated
  using ((select private.can_access_property(id)));

drop policy if exists workspace_property_viewer_select on public.workspaces;
create policy workspace_property_viewer_select on public.workspaces
  for select to authenticated
  using (
    (select private.is_workspace_member(id)) or exists(
      select 1
      from public.properties p
      join public.property_memberships pm on pm.property_id = p.id
      where p.workspace_id = workspaces.id
        and pm.user_id = (select auth.uid())
    )
  );

drop policy if exists workspace_manage_update on public.workspaces;
create policy workspace_manage_update on public.workspaces
  for update to authenticated
  using ((select private.can_manage_workspace(id)))
  with check ((select private.can_manage_workspace(id)));

drop policy if exists property_membership_select on public.property_memberships;
create policy property_membership_select on public.property_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid()) or
    (select private.can_manage_property(property_id))
  );

drop policy if exists property_membership_manage on public.property_memberships;
create policy property_membership_manage on public.property_memberships
  for all to authenticated
  using ((select private.can_manage_property(property_id)))
  with check ((select private.can_manage_property(property_id)));

drop policy if exists property_audit_pages_select on public.property_audit_pages;
create policy property_audit_pages_select on public.property_audit_pages
  for select to authenticated
  using ((select private.can_access_property(property_id)));

drop policy if exists property_audit_pages_manage on public.property_audit_pages;
create policy property_audit_pages_manage on public.property_audit_pages
  for all to authenticated
  using ((select private.can_manage_property(property_id)))
  with check ((select private.can_manage_property(property_id)));

drop policy if exists recipients_member_all on public.alert_recipients;
create policy recipients_member_select on public.alert_recipients
  for select to authenticated
  using ((select private.can_access_property(property_id)));
create policy recipients_manage on public.alert_recipients
  for all to authenticated
  using ((select private.can_manage_property(property_id)))
  with check ((select private.can_manage_property(property_id)));

drop policy if exists event_definition_all on public.event_definitions;
create policy event_definition_select on public.event_definitions
  for select to authenticated
  using ((select private.can_access_property(property_id)));
create policy event_definition_manage on public.event_definitions
  for all to authenticated
  using ((select private.can_manage_property(property_id)))
  with check ((select private.can_manage_property(property_id)));

drop policy if exists saved_report_member_all on public.saved_reports;
create policy saved_report_select on public.saved_reports
  for select to authenticated
  using ((select private.can_access_property(property_id)));
create policy saved_report_manage on public.saved_reports
  for all to authenticated
  using ((select private.can_manage_property(property_id)))
  with check ((select private.can_manage_property(property_id)));

drop policy if exists schedule_member_all on public.report_schedules;
create policy schedule_select on public.report_schedules
  for select to authenticated
  using ((select private.can_access_property(property_id)));
create policy schedule_manage on public.report_schedules
  for all to authenticated
  using ((select private.can_manage_property(property_id)))
  with check ((select private.can_manage_property(property_id)));

drop policy if exists audit_run_insert on public.audit_runs;
create policy audit_run_insert on public.audit_runs
  for insert to authenticated
  with check ((select private.can_manage_property(property_id)));

create or replace function public.create_workspace(p_account_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  wid uuid;
begin
  if uid is null then raise exception 'authentication required'; end if;
  if nullif(trim(p_name), '') is null or char_length(trim(p_name)) > 100 then
    raise exception 'valid workspace name required';
  end if;
  if not exists(
    select 1 from public.account_memberships
    where account_id = p_account_id and user_id = uid and role in ('owner', 'member')
  ) then raise exception 'workspace access denied'; end if;
  insert into public.workspaces(account_id, name)
  values (p_account_id, trim(p_name)) returning id into wid;
  insert into public.workspace_memberships(workspace_id, user_id, role)
  values (wid, uid, 'owner');
  insert into public.activity_log(account_id, actor_id, action, metadata)
  values (p_account_id, uid, 'workspace.created', jsonb_build_object('workspace_id', wid));
  return jsonb_build_object('workspaceId', wid);
end;
$$;

revoke all on function public.create_workspace(uuid, text) from public, anon;
grant execute on function public.create_workspace(uuid, text) to authenticated;

insert into private.app_migrations(version, name, checksum)
values ('20261002075834', 'stage1_live_operations', 'self')
on conflict(version) do nothing;

commit;
