create type public.account_access_state as enum ('active', 'frozen', 'blocked', 'pending_deletion');
create type public.resource_access_state as enum ('active', 'locked', 'paused');
create type public.usage_reservation_state as enum ('reserved', 'consumed', 'released', 'restored');
create type public.admin_job_state as enum ('queued', 'running', 'completed', 'failed', 'cancelled', 'expired');

alter table public.accounts
  add column access_state public.account_access_state not null default 'active',
  add column access_state_reason text,
  add column access_state_changed_at timestamptz,
  add column tags text[] not null default '{}',
  add column scheduled_deletion_at timestamptz,
  add column deletion_approved_at timestamptz,
  add column deletion_approved_by uuid references public.staff_members(user_id) on delete set null;

alter table public.properties
  add column account_id uuid references public.accounts(id) on delete cascade,
  add column resource_identity text,
  add column access_state public.resource_access_state not null default 'active';

alter table public.uptime_monitors drop constraint if exists uptime_monitors_last_status_check;
alter table public.uptime_monitors add constraint uptime_monitors_last_status_check
  check (last_status in ('pending','online','suspected_down','offline','monitoring_unavailable','delayed','paused'));

update public.properties property
set account_id = workspace.account_id,
    resource_identity = lower(trim(trailing '/' from property.url))
from public.workspaces workspace
where workspace.id = property.workspace_id;

alter table public.properties
  alter column account_id set not null,
  alter column resource_identity set not null;

create unique index properties_account_resource_identity_idx
  on public.properties(account_id, resource_identity);

create or replace function private.sync_property_account_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_account_id uuid;
begin
  select account_id into target_account_id from public.workspaces where id = new.workspace_id;
  if target_account_id is null then raise exception 'workspace_not_found'; end if;
  if new.account_id is not null and new.account_id <> target_account_id then
    raise exception 'property_account_must_match_workspace';
  end if;
  new.account_id := target_account_id;
  new.resource_identity := lower(trim(trailing '/' from new.url));
  return new;
end
$$;

create trigger sync_property_account_identity
before insert or update of workspace_id, url, account_id on public.properties
for each row execute function private.sync_property_account_identity();

create table public.account_internal_notes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_by uuid references public.staff_members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.account_billing_memberships (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_view boolean not null default true,
  can_manage boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

create table public.account_service_controls (
  account_id uuid not null references public.accounts(id) on delete cascade,
  service text not null check (service in ('audits', 'analytics', 'uptime', 'reports', 'email')),
  paused boolean not null default false,
  reason text,
  changed_by uuid references public.staff_members(user_id) on delete set null,
  changed_at timestamptz not null default now(),
  primary key (account_id, service)
);

create table public.account_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete restrict,
  to_user_id uuid not null references auth.users(id) on delete restrict,
  state text not null default 'pending' check (state in ('pending', 'verified', 'completed', 'cancelled', 'expired')),
  verification_reference_hash text,
  reason text not null,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_by uuid references public.staff_members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_user_id <> to_user_id)
);

create table public.customer_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  subject text not null,
  body text not null,
  channel text not null check (channel in ('in_app', 'email')),
  status text not null default 'draft' check (status in ('draft', 'queued', 'sent', 'failed', 'cancelled')),
  created_by uuid references public.staff_members(user_id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  check (account_id is not null or user_id is not null or property_id is not null)
);

create table public.package_versions (
  id uuid primary key default gen_random_uuid(),
  package_key text not null,
  version integer not null check (version > 0),
  display_name text not null,
  state text not null default 'draft' check (state in ('draft', 'published', 'retired')),
  effective_at timestamptz,
  pricing jsonb not null default '{}'::jsonb,
  allowances jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  retention jsonb not null default '{}'::jsonb,
  hard_ceilings jsonb not null default '{}'::jsonb,
  unresolved_values text[] not null default '{}',
  created_by uuid references public.staff_members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  unique (package_key, version)
);

create table public.account_package_assignments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  package_version_id uuid not null references public.package_versions(id) on delete restrict,
  price_grandfathered boolean not null default false,
  allowances_grandfathered boolean not null default false,
  complimentary boolean not null default false,
  billing_state text not null default 'unconfigured' check (billing_state in ('unconfigured', 'trialing', 'active', 'past_due', 'unpaid', 'cancelled', 'complimentary')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid references public.staff_members(user_id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index account_package_assignments_current_idx on public.account_package_assignments(account_id) where ends_at is null;

create table public.account_entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  key text not null,
  value jsonb not null,
  reason text not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid references public.staff_members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at)
);
create index account_entitlement_overrides_effective_idx on public.account_entitlement_overrides(account_id, key, starts_at, expires_at);

create table public.package_change_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  from_package_version_id uuid references public.package_versions(id) on delete restrict,
  to_package_version_id uuid not null references public.package_versions(id) on delete restrict,
  scope text not null check (scope in ('new_signups', 'selected_accounts', 'existing_accounts')),
  state text not null default 'preview' check (state in ('preview', 'awaiting_payment', 'scheduled', 'applied', 'failed', 'cancelled')),
  effective_at timestamptz,
  preview jsonb not null default '{}'::jsonb,
  selection jsonb not null default '{}'::jsonb,
  reason text not null,
  created_by uuid references public.staff_members(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.resource_locks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  resource_type text not null check (resource_type in ('property', 'workspace', 'editing_membership')),
  resource_id uuid not null,
  reason text not null,
  effective_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_id, resource_type, resource_id, effective_at)
);

create table public.account_usage_periods (
  account_id uuid not null references public.accounts(id) on delete cascade,
  metric text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  consumed bigint not null default 0 check (consumed >= 0),
  reserved bigint not null default 0 check (reserved >= 0),
  restored bigint not null default 0 check (restored >= 0),
  updated_at timestamptz not null default now(),
  primary key (account_id, metric, period_start),
  check (period_end > period_start)
);

create table public.audit_credit_reservations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  request_run_id uuid not null,
  audit_run_id uuid references public.audit_runs(id) on delete set null,
  idempotency_key text not null,
  page_count integer not null check (page_count > 0 and page_count <= 1000),
  state public.usage_reservation_state not null default 'reserved',
  period_start timestamptz not null,
  period_end timestamptz not null,
  infrastructure_attempts integer not null default 0,
  restoration_reason text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, idempotency_key)
);

create or replace function public.reserve_audit_credits_internal(
  p_account_id uuid,
  p_property_id uuid,
  p_idempotency_key text,
  p_request_run_id uuid,
  p_page_count integer,
  p_weekly_limit integer default null
) returns public.audit_credit_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  week_start timestamptz := date_trunc('week', now() at time zone 'UTC') at time zone 'UTC';
  week_end timestamptz := week_start + interval '7 days';
  usage_row public.account_usage_periods;
  reservation public.audit_credit_reservations;
begin
  if p_page_count < 1 or p_page_count > 1000 then raise exception 'invalid_page_count'; end if;
  -- Serialise identical submissions before inspecting the reservation. This
  -- prevents two requests from both observing an unclaimed key and starting
  -- separate audit runs while still allowing unrelated accounts to proceed.
  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text || ':' || p_idempotency_key, 0));
  select * into reservation from public.audit_credit_reservations
    where account_id = p_account_id and idempotency_key = p_idempotency_key;
  if found then return reservation; end if;
  insert into public.account_usage_periods(account_id, metric, period_start, period_end)
    values (p_account_id, 'page_audit_credit', week_start, week_end)
    on conflict do nothing;
  select * into usage_row from public.account_usage_periods
    where account_id = p_account_id and metric = 'page_audit_credit' and period_start = week_start
    for update;
  if p_weekly_limit is not null and greatest(0, usage_row.consumed - usage_row.restored) + usage_row.reserved + p_page_count > p_weekly_limit then
    raise exception 'weekly_audit_credit_limit_reached';
  end if;
  insert into public.audit_credit_reservations(account_id, property_id, request_run_id, idempotency_key, page_count, period_start, period_end, expires_at)
    values (p_account_id, p_property_id, p_request_run_id, p_idempotency_key, p_page_count, week_start, week_end, now() + interval '15 minutes')
    returning * into reservation;
  update public.account_usage_periods set reserved = reserved + p_page_count, updated_at = now()
    where account_id = p_account_id and metric = 'page_audit_credit' and period_start = week_start;
  return reservation;
end
$$;

create or replace function public.transition_audit_credit_reservation_internal(
  p_reservation_id uuid,
  p_target public.usage_reservation_state,
  p_reason text default null
) returns public.audit_credit_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation public.audit_credit_reservations;
begin
  select * into reservation from public.audit_credit_reservations where id = p_reservation_id for update;
  if not found then raise exception 'reservation_not_found'; end if;
  if reservation.state = p_target then return reservation; end if;
  if reservation.state = 'reserved' and p_target in ('consumed', 'released') then
    update public.account_usage_periods
      set reserved = reserved - reservation.page_count,
          consumed = consumed + case when p_target = 'consumed' then reservation.page_count else 0 end,
          updated_at = now()
      where account_id = reservation.account_id and metric = 'page_audit_credit' and period_start = reservation.period_start;
  elsif reservation.state = 'consumed' and p_target = 'restored' and reservation.restoration_reason is null then
    update public.account_usage_periods set restored = restored + reservation.page_count, updated_at = now()
      where account_id = reservation.account_id and metric = 'page_audit_credit' and period_start = reservation.period_start;
  else
    raise exception 'invalid_reservation_transition';
  end if;
  update public.audit_credit_reservations
    set state = p_target, restoration_reason = case when p_target = 'restored' then p_reason else restoration_reason end, updated_at = now()
    where id = reservation.id returning * into reservation;
  return reservation;
end
$$;

create table public.account_inactivity (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  free_since timestamptz,
  last_meaningful_activity_at timestamptz,
  state text not null default 'active' check (state in ('active', 'warning_60', 'warning_90', 'frozen', 'deletion_eligible', 'review_hold', 'exempt')),
  exempt_until timestamptz,
  grace_until timestamptz,
  analytics_review_required boolean not null default false,
  notice_delivery_failed boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.account_inactivity_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  event text not null,
  effective_state text not null,
  notice_delivery_id uuid references public.notification_deliveries(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  description text not null,
  source text not null default 'application',
  updated_by uuid references public.staff_members(user_id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings(key, value, description) values
  ('inactivity_policy', '{"warningDays":[60,90],"freezeDay":100,"deletionEligibleDay":121,"automaticDeletionEnabled":false}'::jsonb, 'Free-account inactivity lifecycle; irreversible automatic deletion is disabled.'),
  ('safety_limits', '{"platformAuditStartsPerDay":200,"concurrentAudits":5,"auditWallTimeSeconds":600,"httpResponseBytes":5000000,"linksPerAudit":5000,"resourcesPerAudit":5000,"redirects":5,"queueRetries":3,"analyticsPayloadBytes":262144,"analyticsEventsPerPropertyPerDay":50000,"exportsPerAccountPerDay":10}'::jsonb, 'Initial application ceilings derived from current Worker limits and bounded queue architecture; review against measured production demand.'),
  ('outbound_automation', '{"campaignsEnabled":false,"inactivityNoticesEnabled":false,"weeklyDigestEnabled":false,"safeTestRecipients":[]}'::jsonb, 'New outbound automations remain disabled until recipient and policy review.'),
  ('retention_policy', '{"adminLogsDays":730,"usageLedgerDays":2555,"exportsDays":7,"evidenceDays":90,"analyticsRawDays":90,"uptimeChecksDays":365,"auditResultsDays":730}'::jsonb, 'Default retention controls; cleanup remains preview-only until reviewed.'),
  ('provider_capabilities', '{"stripe":"unconfigured","stripeTax":"unconfigured","cloudflareTelemetry":"unavailable","supabaseBackups":"unverified"}'::jsonb, 'Provider capabilities discovered from current configuration.')
on conflict (key) do nothing;

create table public.emergency_controls (
  key text primary key check (key in ('new_audits', 'scheduled_audits', 'browser_collection', 'uptime_checks', 'uptime_notifications', 'analytics_ingestion', 'reports', 'campaigns')),
  paused boolean not null default false,
  reason text,
  changed_by uuid references public.staff_members(user_id) on delete set null,
  changed_at timestamptz not null default now()
);
insert into public.emergency_controls(key) values
  ('new_audits'), ('scheduled_audits'), ('browser_collection'), ('uptime_checks'),
  ('uptime_notifications'), ('analytics_ingestion'), ('reports'), ('campaigns')
on conflict do nothing;

create table public.operational_events (
  id bigint generated always as identity primary key,
  service text not null,
  metric text not null,
  value numeric not null,
  unit text not null,
  source text not null check (source in ('application_measured', 'provider_reported', 'estimated')),
  account_id uuid references public.accounts(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);
create index operational_events_metric_time_idx on public.operational_events(metric, observed_at desc);

create table public.processing_daily_counters (
  day date not null,
  metric text not null,
  value integer not null default 0 check (value >= 0),
  updated_at timestamptz not null default now(),
  primary key (day, metric)
);

create table public.processing_leases (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  job_id uuid not null,
  account_id uuid references public.accounts(id) on delete set null,
  state text not null default 'reserved' check (state in ('reserved', 'running', 'released', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_type, job_id)
);
create index processing_leases_active_idx on public.processing_leases(job_type, expires_at) where state in ('reserved', 'running');

alter table public.audit_runs
  add column credit_reservation_id uuid references public.audit_credit_reservations(id) on delete set null,
  add column platform_lease_id uuid references public.processing_leases(id) on delete set null;

create or replace function public.acquire_audit_processing_slot_internal(
  p_job_id uuid,
  p_account_id uuid,
  p_daily_limit integer,
  p_concurrent_limit integer,
  p_lease_minutes integer default 12
) returns public.processing_leases
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_day date := (now() at time zone 'UTC')::date;
  current_count integer;
  active_count integer;
  lease public.processing_leases;
begin
  if p_daily_limit < 1 or p_concurrent_limit < 1 or p_lease_minutes < 1 or p_lease_minutes > 30 then
    raise exception 'invalid_processing_limit';
  end if;
  select * into lease from public.processing_leases where job_type = 'audit' and job_id = p_job_id;
  if found then return lease; end if;
  insert into public.processing_daily_counters(day, metric) values (current_day, 'audit_starts') on conflict do nothing;
  select value into current_count from public.processing_daily_counters where day = current_day and metric = 'audit_starts' for update;
  update public.processing_leases set state = 'expired', updated_at = now()
    where job_type = 'audit' and state in ('reserved', 'running') and expires_at <= now();
  select count(*) into active_count from public.processing_leases
    where job_type = 'audit' and state in ('reserved', 'running') and expires_at > now();
  if current_count >= p_daily_limit then raise exception 'platform_daily_audit_limit_reached'; end if;
  if active_count >= p_concurrent_limit then raise exception 'platform_concurrent_audit_limit_reached'; end if;
  insert into public.processing_leases(job_type, job_id, account_id, expires_at)
    values ('audit', p_job_id, p_account_id, now() + make_interval(mins => p_lease_minutes)) returning * into lease;
  update public.processing_daily_counters set value = value + 1, updated_at = now()
    where day = current_day and metric = 'audit_starts';
  return lease;
end
$$;

create or replace function public.release_processing_slot_internal(p_lease_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.processing_leases set state = 'released', updated_at = now() where id = p_lease_id and state in ('reserved', 'running');
$$;

create table public.platform_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  state text not null check (state in ('investigating', 'identified', 'monitoring', 'resolved')),
  affected_services text[] not null default '{}',
  customer_notifications_suppressed boolean not null default false,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_by uuid references public.staff_members(user_id) on delete set null
);

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  version integer not null,
  subject text not null,
  html_body text not null,
  variables text[] not null default '{}',
  state text not null default 'draft' check (state in ('draft', 'active', 'retired')),
  created_by uuid references public.staff_members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  unique (template_key, version)
);

create table public.email_automations (
  key text primary key,
  template_key text not null,
  enabled boolean not null default false,
  essential boolean not null default false,
  policy jsonb not null default '{}'::jsonb,
  updated_by uuid references public.staff_members(user_id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  template_id uuid references public.email_templates(id) on delete restrict,
  segment jsonb not null,
  recipient_preview_count integer,
  state text not null default 'draft' check (state in ('draft', 'scheduled', 'sending', 'completed', 'cancelled', 'failed')),
  scheduled_at timestamptz,
  created_by uuid references public.staff_members(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  metric text not null,
  operator text not null check (operator in ('gt', 'gte', 'lt', 'lte')),
  threshold numeric not null,
  observation_minutes integer not null check (observation_minutes between 1 and 10080),
  minimum_samples integer not null default 1 check (minimum_samples > 0),
  cooldown_minutes integer not null default 60 check (cooldown_minutes between 1 and 43200),
  enabled boolean not null default false,
  created_by uuid references public.staff_members(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.platform_alerts (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.alert_rules(id) on delete set null,
  title text not null,
  details jsonb not null default '{}'::jsonb,
  state text not null default 'active' check (state in ('active', 'acknowledged', 'snoozed', 'resolved')),
  acknowledged_by uuid references public.staff_members(user_id) on delete set null,
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.saved_admin_views (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references public.staff_members(user_id) on delete cascade,
  page text not null,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (staff_user_id, page, name)
);

create table public.admin_export_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.staff_members(user_id) on delete cascade,
  scope text not null,
  filters jsonb not null default '{}'::jsonb,
  format text not null check (format in ('csv', 'json')),
  state public.admin_job_state not null default 'queued',
  progress integer not null default 0 check (progress between 0 and 100),
  object_key text,
  row_count bigint,
  error text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  state text not null default 'preview' check (state in ('preview', 'review_hold', 'approved', 'scheduled', 'completed', 'cancelled')),
  dry_run jsonb not null default '{}'::jsonb,
  reason text not null,
  requested_by uuid references public.staff_members(user_id) on delete set null,
  approved_by uuid references public.staff_members(user_id) on delete set null,
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('admin-exports', 'admin-exports', false, 52428800, array['text/csv', 'application/json'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table public.billing_customers (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  provider_customer_id text unique,
  provider text not null default 'stripe',
  currency text,
  sync_state text not null default 'unconfigured' check (sync_state in ('unconfigured', 'pending', 'synced', 'error')),
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  event_type text not null,
  provider_created_at timestamptz not null,
  payload jsonb not null,
  processing_state text not null default 'pending' check (processing_state in ('pending', 'processed', 'ignored', 'failed')),
  attempts integer not null default 0,
  error text,
  processed_at timestamptz,
  received_at timestamptz not null default now()
);

create table public.promotion_rules (
  id uuid primary key default gen_random_uuid(),
  provider_coupon_id text,
  provider_promotion_code_id text,
  code text unique,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  percentage numeric check (percentage > 0 and percentage <= 100),
  fixed_amount_minor bigint check (fixed_amount_minor > 0),
  currency text,
  duration_type text not null check (duration_type in ('once', 'billing_periods', 'forever')),
  duration_count integer,
  eligible_packages text[] not null default '{}',
  eligible_intervals text[] not null default '{}',
  new_customers_only boolean not null default false,
  applies_to_additional_seats boolean not null default false,
  stacking_allowed boolean not null default false,
  redemption_limit integer,
  expires_at timestamptz,
  enabled boolean not null default false,
  created_by uuid references public.staff_members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  check ((discount_type = 'percentage' and percentage is not null and fixed_amount_minor is null) or
         (discount_type = 'fixed' and fixed_amount_minor is not null and percentage is null)),
  check (discount_type = 'percentage' or currency is not null)
);

insert into public.package_versions(package_key, version, display_name, state, effective_at, allowances, features, retention, hard_ceilings, unresolved_values)
values
  ('free', 1, 'Free', 'published', now(), '{"customEventsPerProperty":2}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{"propertiesPerAccount":25}'::jsonb, array['auditCreditsPerWeek','editingSeats','propertyViewers','uptimeIntervalMinutes','retention']),
  ('essentials', 1, 'Essentials', 'published', now(), '{"customEventsPerProperty":5}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{"propertiesPerAccount":25}'::jsonb, array['price','auditCreditsPerWeek','editingSeats','propertyViewers','uptimeIntervalMinutes','retention']),
  ('scale', 1, 'Scale', 'published', now(), '{"customEventsPerProperty":20}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{"propertiesPerAccount":25}'::jsonb, array['price','auditCreditsPerWeek','editingSeats','propertyViewers','uptimeIntervalMinutes','retention']),
  ('pro_early_access', 1, 'Pro early access', 'published', now(), '{"customEventsPerProperty":null}'::jsonb, '{"complimentaryEarlyAccess":true}'::jsonb, '{}'::jsonb, '{"propertiesPerAccount":25}'::jsonb, array['futurePrice','auditCreditsPerWeek','editingSeats','propertyViewers','uptimeIntervalMinutes','retention'])
on conflict (package_key, version) do nothing;

insert into public.account_package_assignments(account_id, package_version_id, price_grandfathered, allowances_grandfathered, complimentary, billing_state, starts_at)
select account.id, package.id, account.entitlement = 'pro_early_access', true,
  account.entitlement = 'pro_early_access',
  case when account.entitlement = 'pro_early_access' then 'complimentary' else 'unconfigured' end,
  account.entitlement_started_at
from public.accounts account
join public.package_versions package on package.package_key = account.entitlement and package.version = 1
where not exists (select 1 from public.account_package_assignments assignment where assignment.account_id = account.id and assignment.ends_at is null);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'account_internal_notes','account_billing_memberships','account_service_controls','account_ownership_transfers',
    'customer_messages','package_versions','account_package_assignments','account_entitlement_overrides','package_change_requests',
    'resource_locks','account_usage_periods','audit_credit_reservations','account_inactivity','account_inactivity_events',
    'platform_settings','emergency_controls','operational_events','processing_daily_counters','processing_leases','platform_incidents','email_templates','email_automations',
    'email_campaigns','alert_rules','platform_alerts','saved_admin_views','admin_export_jobs','deletion_requests',
    'billing_customers','billing_events','promotion_rules'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
  end loop;
end
$$;

revoke all on function private.sync_property_account_identity() from public, anon, authenticated;
revoke all on function public.reserve_audit_credits_internal(uuid, uuid, text, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.transition_audit_credit_reservation_internal(uuid, public.usage_reservation_state, text) from public, anon, authenticated;
revoke all on function public.acquire_audit_processing_slot_internal(uuid, uuid, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.release_processing_slot_internal(uuid) from public, anon, authenticated;
grant execute on function public.reserve_audit_credits_internal(uuid, uuid, text, uuid, integer, integer) to service_role;
grant execute on function public.transition_audit_credit_reservation_internal(uuid, public.usage_reservation_state, text) to service_role;
grant execute on function public.acquire_audit_processing_slot_internal(uuid, uuid, integer, integer, integer) to service_role;
grant execute on function public.release_processing_slot_internal(uuid) to service_role;
grant usage, select on all sequences in schema public to service_role;

comment on table public.package_versions is 'Versioned entitlements. Null/missing commercial values remain unresolved rather than inferred.';
comment on table public.audit_credit_reservations is 'Idempotent account-level page-audit credit reservations; survives originating resource deletion.';
comment on table public.account_inactivity is 'Account-scoped meaningful activity lifecycle. Automatic irreversible deletion is disabled in platform_settings.';
comment on table public.billing_events is 'Server-only immutable Stripe event inbox. Raw payloads must be access-restricted and retention-controlled.';
