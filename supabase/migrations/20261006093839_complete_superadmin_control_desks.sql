-- Completes the SuperAdmin control desks without enabling customer campaigns or
-- irreversible deletion. Existing operational records are preserved.

create table public.platform_setting_history (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null,
  previous_value jsonb,
  new_value jsonb not null,
  reason text not null,
  changed_by uuid references public.staff_members(user_id) on delete set null,
  changed_at timestamptz not null default now()
);

insert into public.platform_settings(key, value, description) values
  ('email_settings', '{"senderName":"Claritude","replyTo":"","enabledCategories":["registration","confirmation","password_reset","uptime_down","uptime_recovered","report","billing"],"suppressionHandling":"enforce","hourlySendLimit":1000}'::jsonb, 'Platform sender identity, eligible categories, suppression enforcement and sending ceiling.'),
  ('alert_digest', '{"enabled":false,"recipients":[],"schedule":"0 9 * * 1","timezone":"Europe/London","includedMetrics":["active_alerts","evaluator_health"]}'::jsonb, 'Weekly operational alert digest configuration. Preview does not send.'),
  ('staff_sessions', '{"defaultMinutes":30,"maximumMinutes":60,"writeModeAllowed":true,"requireReason":true}'::jsonb, 'Limits and safeguards for scoped customer sessions.')
on conflict (key) do nothing;

alter table public.email_templates
  add column if not exists description text,
  add column if not exists text_body text,
  add column if not exists provider_managed boolean not null default false,
  add column if not exists sending_path text,
  add column if not exists published_at timestamptz,
  add column if not exists supersedes_id uuid references public.email_templates(id) on delete set null;

alter table public.email_automations
  add column if not exists trigger_key text,
  add column if not exists delay_minutes integer not null default 0 check (delay_minutes between 0 and 525600),
  add column if not exists eligibility jsonb not null default '{}'::jsonb,
  add column if not exists sent_count bigint not null default 0,
  add column if not exists skipped_count bigint not null default 0,
  add column if not exists failed_count bigint not null default 0,
  add column if not exists last_executed_at timestamptz;

alter table public.email_campaigns
  add column if not exists subject text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists duplicated_from uuid references public.email_campaigns(id) on delete set null,
  add column if not exists result jsonb not null default '{}'::jsonb;

alter table public.notification_deliveries
  add column if not exists provider text,
  add column if not exists provider_status text,
  add column if not exists is_test boolean,
  add column if not exists account_id uuid references public.accounts(id) on delete set null,
  add column if not exists property_id uuid references public.properties(id) on delete set null,
  add column if not exists template_id uuid references public.email_templates(id) on delete set null,
  add column if not exists automation_key text references public.email_automations(key) on delete set null,
  add column if not exists campaign_id uuid references public.email_campaigns(id) on delete set null;

create table public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  recipient text not null,
  category text not null,
  reason text not null,
  source text not null default 'platform',
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  unique(recipient, category)
);

alter table public.alert_rules
  add column if not exists scope jsonb not null default '{}'::jsonb,
  add column if not exists last_evaluated_at timestamptz,
  add column if not exists evaluation_state text not null default 'not_started' check (evaluation_state in ('not_started','healthy','failing','telemetry_unavailable')),
  add column if not exists evaluation_error text;

create table public.platform_alert_history (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.platform_alerts(id) on delete cascade,
  event text not null check (event in ('created','acknowledged','snoozed','resolved','reopened')),
  reason text,
  actor_staff_id uuid references public.staff_members(user_id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.email_templates(template_key, version, subject, html_body, text_body, variables, state, description, provider_managed, sending_path, published_at)
values
  ('uptime_down', 1, '{{propertyName}} is offline', '<p>{{propertyName}} appears to be offline.</p><p>{{propertyUrl}}</p>', '{{propertyName}} appears to be offline. {{propertyUrl}}', array['propertyName','propertyUrl'], 'active', 'Transactional incident notification.', false, 'Worker uptime notification queue', now()),
  ('uptime_recovered', 1, '{{propertyName}} has recovered', '<p>{{propertyName}} is responding again.</p><p>{{propertyUrl}}</p>', '{{propertyName}} is responding again. {{propertyUrl}}', array['propertyName','propertyUrl'], 'active', 'Transactional recovery notification.', false, 'Worker uptime notification queue', now()),
  ('scheduled_report', 1, 'Your Claritude report is ready', '<p>Your report for {{propertyName}} is ready.</p>', 'Your report for {{propertyName}} is ready.', array['propertyName','reportUrl'], 'active', 'Scheduled report notification.', false, 'Worker report schedule queue', now()),
  ('auth_confirmation', 1, 'Confirm your Claritude account', '<p>Managed in Supabase Auth.</p>', 'Managed in Supabase Auth.', array['confirmationUrl'], 'active', 'Provider-managed authentication template; edit and proof remain in Supabase Auth.', true, 'Supabase Auth', now()),
  ('auth_password_reset', 1, 'Reset your Claritude password', '<p>Managed in Supabase Auth.</p>', 'Managed in Supabase Auth.', array['resetUrl'], 'active', 'Provider-managed authentication template; edit and proof remain in Supabase Auth.', true, 'Supabase Auth', now())
on conflict (template_key, version) do nothing;

insert into public.email_automations(key, template_key, enabled, essential, policy, trigger_key, delay_minutes, eligibility)
values
  ('uptime_down', 'uptime_down', true, true, '{"retrySafe":true}'::jsonb, 'incident.opened', 0, '{"requiresRecipient":true,"honourSuppressions":true}'::jsonb),
  ('uptime_recovered', 'uptime_recovered', true, true, '{"retrySafe":true}'::jsonb, 'incident.resolved', 0, '{"requiresRecipient":true,"honourSuppressions":true}'::jsonb),
  ('scheduled_report', 'scheduled_report', true, true, '{"retrySafe":true}'::jsonb, 'report.completed', 0, '{"requiresRecipient":true,"honourSuppressions":true}'::jsonb),
  ('inactivity_notice', 'inactivity_notice', false, false, '{"retrySafe":true}'::jsonb, 'account.inactivity_threshold', 0, '{"requiresOutboundAutomation":true}'::jsonb),
  ('weekly_digest', 'weekly_digest', false, false, '{"retrySafe":true}'::jsonb, 'schedule.weekly', 0, '{"requiresDigestRecipients":true}'::jsonb)
on conflict (key) do nothing;

alter table public.platform_setting_history enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.platform_alert_history enable row level security;
revoke all on public.platform_setting_history, public.email_suppressions, public.platform_alert_history from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.platform_setting_history, public.email_suppressions, public.platform_alert_history to service_role;

comment on table public.platform_setting_history is 'Immutable snapshots of privileged platform setting changes.';
comment on column public.notification_deliveries.is_test is 'Null means historical classification is unknown; never infer it from the recipient or provider id.';
